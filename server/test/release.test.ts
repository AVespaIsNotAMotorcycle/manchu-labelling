import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, test } from "node:test";

import { abkaiToManchu } from "@manchu-labelling/script";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose, { Types } from "mongoose";

import { connectDatabase } from "../src/db.ts";
import { WordImage, WordInstance } from "../src/models/crops.ts";
import { Annotation, KnownLabel } from "../src/models/labels.ts";
import { Release } from "../src/models/releases.ts";
import { Page, Volume } from "../src/models/sources.ts";
import { User } from "../src/models/users.ts";
import { annotatorId, exportRelease } from "../src/release.ts";
import { setVolume } from "../src/scripts/set-volume.ts";

const SECRET = "a-test-secret-that-is-long-enough-to-use";
let database: MongoMemoryServer;
let storage: string;
let work: string;
let page: Types.ObjectId;
let wordCount = 0;

before(async () => {
  database = await MongoMemoryServer.create();
  await connectDatabase(database.getUri());
  storage = await mkdtemp(join(tmpdir(), "release-storage-"));
});

after(async () => {
  await mongoose.disconnect();
  await database.stop();
  await rm(storage, { recursive: true });
});

beforeEach(async () => {
  await mongoose.connection.db?.dropDatabase();
  await mongoose.connection.syncIndexes();
  work = await mkdtemp(join(tmpdir(), "release-out-"));
  const volume = await Volume.create({
    sourceId: "URN-3:FHCL:1",
    title: "A manuscript",
    manifestUrl: "https://example.com/manifest",
    production: "manuscript",
    script: "regular",
    split: "train",
    rights: {
      status: "cleared",
      statement: "Public domain",
      attribution: "A library",
      permanentLink: "https://example.com/1",
      license: "PDM-1.0",
    },
  });
  page = (
    await Page.create({
      volume: volume._id,
      index: 3,
      canvasId: "canvas",
      imageServiceUrl: "https://example.com/image",
      imageKey: `${new Types.ObjectId()}.jpg`,
      width: 100,
      height: 200,
    })
  )._id;
});

async function word(options: { heldBack?: boolean } = {}) {
  wordCount += 1;
  const key = `${String(wordCount).padStart(8, "0")}-0000-4000-8000-000000000000.jpg`;
  await writeFile(join(storage, key), `crop ${wordCount}`);
  const instance = new Types.ObjectId();
  const crop = await WordImage.create({
    run: new Types.ObjectId(),
    page,
    instance,
    box: { x: 1, y: 2, width: 3, height: 4 },
    side: "left",
    column: wordCount,
    word: 0,
    columnType: "manchu",
    imageKey: key,
  });
  await WordInstance.create({ _id: instance, page, canonicalCrop: crop._id, heldBack: options.heldBack ?? false });
  return { crop: crop._id, instance };
}

const manju = { category: "manchu" as const, transcription: { abkai: "manju", manchu: abkaiToManchu("manju").text } };

async function label(wordImage: Types.ObjectId, user: Types.ObjectId, extra: object = manju) {
  await Annotation.create({ wordImage, user, converterVersion: 1, ...extra });
}

const run = (version = "0.1.0", extra: object = {}) =>
  exportRelease({ version, outDir: join(work, version), storageDirectory: storage, secret: SECRET, ...extra });

const readLines = async (version: string, file: string) =>
  (await readFile(join(work, version, file), "utf8"))
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));

test("annotator IDs are keyed and stable", () => {
  const user = new Types.ObjectId();
  assert.equal(annotatorId(SECRET, user), annotatorId(SECRET, String(user)));
  assert.notEqual(annotatorId(SECRET, user), annotatorId(`${SECRET}x`, user));
  assert.match(annotatorId(SECRET, user), /^a[0-9a-f]{16}$/);
});

test("a release needs cleared volumes with splits, and does not mix in noncommercial ones", async () => {
  await assert.rejects(run("1"), /look like 1.0.0/);
  await assert.rejects(exportRelease({ version: "0.1.0", outDir: join(work, "x"), storageDirectory: storage, secret: "short" }), /secret/);
  await Volume.updateMany({}, { $unset: { split: "" } });
  await assert.rejects(run(), /need a split first: URN-3:FHCL:1/);
  await Volume.updateMany({}, { split: "test" });
  await Volume.create({
    sourceId: "PPN1",
    title: "Another",
    manifestUrl: "https://example.com/m2",
    production: "manuscript",
    script: "regular",
    split: "train",
    rights: { status: "cleared", statement: "s", attribution: "a", permanentLink: "l", license: "CC-BY-NC-SA-4.0" },
  });
  await assert.rejects(run(), /separate package/);
  await Volume.updateMany({}, { "rights.status": "unreviewed" });
  await assert.rejects(run(), /No volumes/);
});

test("exports settled words and every label, and leaves out checks, held-back, and unlabelled words", async () => {
  const [first, second, third] = [new Types.ObjectId(), new Types.ObjectId(), new Types.ObjectId()];
  await User.create({ _id: first, email: "first@example.com", passwordHash: "x", creditName: "Ada" });
  await User.create({ _id: second, email: "second@example.com", passwordHash: "x" });
  const agreed = await word();
  await label(agreed.crop, first, { category: "manchu", transcription: { abkai: "manjv", manchu: abkaiToManchu("manjv").text } });
  await label(agreed.crop, first);
  await label(agreed.crop, second);
  const single = await word();
  await label(single.crop, third, { category: "illegible" });
  const held = await word({ heldBack: true });
  await label(held.crop, first);
  const check = await word();
  await KnownLabel.create({ wordImage: check.crop, category: "chinese", origin: "test" });
  await label(check.crop, second, { category: "chinese" });
  const retired = await word({ heldBack: true });
  await KnownLabel.create({ wordImage: retired.crop, category: "chinese", origin: "test", state: "retired" });
  await word();

  const counts = await run();
  assert.deepEqual(counts.excluded, { activeChecks: 1, heldBack: 1, unlabelled: 1 });
  assert.equal(counts.words, 3);
  assert.deepEqual(counts.statuses, { agreed: 1, single: 1, known: 1 });

  const words = await readLines("0.1.0", "words.jsonl");
  const byId = new Map(words.map((row) => [row.id, row]));
  const agreedRow = byId.get(String(agreed.instance));
  assert.equal(agreedRow.final.status, "agreed");
  assert.equal(agreedRow.final.abkai, "manju");
  assert.equal(agreedRow.final.mollendorff, "manju");
  assert.equal(agreedRow.split, "train");
  assert.equal(agreedRow.page.index, 3);
  assert.equal(agreedRow.rights.license, "PDM-1.0");
  assert.equal(agreedRow.labels, 3);
  assert.equal(byId.get(String(retired.instance)).final.status, "known");
  assert.equal(byId.get(String(single.instance)).final.category, "illegible");

  const labels = await readLines("0.1.0", "labels.jsonl");
  assert.equal(labels.length, 4);
  const ofFirst = labels.filter(({ annotator }) => annotator === annotatorId(SECRET, first));
  assert.deepEqual(ofFirst.map(({ latest }) => latest), [false, true]);
  assert.ok(labels.every(({ counted }) => counted));

  const images = await readdir(join(work, "0.1.0", "images"));
  assert.equal(images.length, 3);
  assert.equal(await readFile(join(work, "0.1.0", agreedRow.file_name), "utf8"), "crop 1");

  // Nothing published names a user.
  for (const file of ["words.jsonl", "labels.jsonl", "volumes.jsonl", "README.md", "CONTRIBUTORS.md"]) {
    const contents = await readFile(join(work, "0.1.0", file), "utf8");
    for (const user of [first, second, third]) assert.doesNotMatch(contents, new RegExp(String(user)));
    assert.doesNotMatch(contents, /@example\.com/);
  }
  assert.match(await readFile(join(work, "0.1.0", "CONTRIBUTORS.md"), "utf8"), /- Ada\n/);
  const card = await readFile(join(work, "0.1.0", "README.md"), "utf8");
  assert.match(card, /# Manchu Word Images, version 0\.1\.0/);
  assert.match(card, /\| `agreed` \| 1 \|/);
  const sums = await readFile(join(work, "0.1.0", "SHA256SUMS"), "utf8");
  assert.match(sums, /[0-9a-f]{64} {2}words\.jsonl/);
  assert.equal(sums.trim().split("\n").length, 9);

  const release = await Release.findOne({ version: "0.1.0" }).orFail();
  assert.equal(release.volumes[0]?.split, "train");
  await assert.rejects(run(), /already exists/);
  await assert.rejects(setVolume("URN-3:FHCL:1", { split: "test" }), /cannot change/);
  await setVolume("URN-3:FHCL:1", { split: "train", license: "PDM-1.0" });
});

test("labels from users who were not trusted are published but do not count", async () => {
  const careless = new Types.ObjectId();
  const target = await word();
  // Ten failed checks before the label make the user untrusted.
  for (let index = 0; index < 10; index += 1) {
    const check = await word();
    await KnownLabel.create({ wordImage: check.crop, category: "chinese", origin: "test", activatedAt: new Date(2020, 0, 1) });
    await Annotation.create({ wordImage: check.crop, user: careless, converterVersion: 1, category: "illegible", createdAt: new Date(2026, 0, 1, 0, index) });
  }
  await Annotation.create({ wordImage: target.crop, user: careless, converterVersion: 1, ...manju, createdAt: new Date(2026, 0, 2) });
  const counts = await run();
  assert.deepEqual(counts.statuses, { unsettled: 1 });
  const [row] = await readLines("0.1.0", "labels.jsonl");
  assert.equal(row.counted, false);
});

test("rights statements given as HTML become plain text in the data card", async () => {
  const { plain } = await import("../src/data-card.ts");
  assert.equal(
    plain("Provided under these terms: <a href=https://example.com/terms>https://example.com/terms</a>"),
    "Provided under these terms: https://example.com/terms",
  );
  assert.equal(plain('See <a href="https://e.com">the terms</a>.<br/>'), "See the terms (https://e.com).");
});

import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, test } from "node:test";

import { abkaiToManchu } from "@manchu-labelling/script";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose, { Types } from "mongoose";

import { createApp } from "../src/app.ts";
import { checkResults, passesCheck, summarizeChecks } from "../src/checks.ts";
import { connectDatabase } from "../src/db.ts";
import { CropReview, WordImage, WordInstance } from "../src/models/crops.ts";
import { Annotation, Assignment, KnownLabel } from "../src/models/labels.ts";
import { Page, Volume } from "../src/models/sources.ts";
import { Qualification, TrainingAttempt, TrainingItem } from "../src/models/training.ts";
import { User } from "../src/models/users.ts";
import { hashPassword } from "../src/passwords.ts";
import { checkRate, pickNextImage } from "../src/queue.ts";
import { importKnownLabels } from "../src/scripts/import-known-labels.ts";
import { splitRealTraining } from "../src/scripts/split-real-training.ts";

const PASSWORD = "Correct horse battery 1";
const CROP_KEY = "11111111-1111-4111-8111-111111111111.jpg";
const PAGE_KEY = "22222222-2222-4222-8222-222222222222.jpg";

let database: MongoMemoryServer;
let server: Server;
let base: string;
let storage: string;
let passwordHash: string;
let imageId: Types.ObjectId;

/** Holds a session cookie, like a browser. */
class Client {
  cookie = "";

  async request(path: string, options: { method?: string; body?: unknown } = {}) {
    const response = await fetch(`${base}${path}`, {
      method: options.method ?? "GET",
      headers: { "Content-Type": "application/json", cookie: this.cookie },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const cookie = response.headers.get("set-cookie");
    if (cookie) this.cookie = cookie.split(";")[0] as string;
    return response;
  }

  login(email: string, password = PASSWORD) {
    return this.request("/api/auth/login", { method: "POST", body: { email, password } });
  }
}

async function makeUser(email: string, overrides: object = {}) {
  return User.create({
    email,
    passwordHash,
    labelsLicenseAcceptedAt: new Date(),
    ...overrides,
  });
}

async function loggedIn(email: string, overrides: object = {}, qualified = true) {
  const user = await makeUser(email, overrides);
  if (qualified) await Qualification.create({ user: user._id, scriptClass: "regular" });
  const client = new Client();
  assert.equal((await client.login(email)).status, 200);
  return client;
}

async function makeWord(
  key: string,
  page: Types.ObjectId,
  position: { side?: "left" | "right"; column?: number; word?: number } = {},
) {
  const instance = new Types.ObjectId();
  const image = await WordImage.create({
    run: new Types.ObjectId(),
    page,
    instance,
    box: { x: 1, y: 2, width: 3, height: 4 },
    side: position.side ?? "left",
    column: position.column ?? 0,
    word: position.word ?? 0,
    columnType: "manchu",
    imageKey: key,
  });
  await WordInstance.create({ _id: instance, page, canonicalCrop: image._id });
  return image;
}

before(async () => {
  database = await MongoMemoryServer.create();
  await connectDatabase(database.getUri());
  passwordHash = await hashPassword(PASSWORD);
  storage = await mkdtemp(join(tmpdir(), "manchu-storage-"));
  await writeFile(join(storage, CROP_KEY), "crop");
  server = createApp({
    sessionSecret: "test",
    secureCookies: false,
    storageDirectory: storage,
    loginAttempts: 1000,
  }).listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  server.close();
  await mongoose.disconnect();
  await database.stop();
  await rm(storage, { recursive: true });
});

beforeEach(async () => {
  await mongoose.connection.db?.dropDatabase();
  await mongoose.connection.syncIndexes();
  const volume = await Volume.create({
    sourceId: "test",
    title: "Test",
    manifestUrl: "https://example.com/manifest",
    production: "manuscript",
    script: "regular",
    rights: { statement: "s", attribution: "a", permanentLink: "https://example.com" },
  });
  const page = await Page.create({
    volume: volume._id,
    index: 1,
    canvasId: "canvas",
    imageServiceUrl: "https://example.com/image",
    imageKey: PAGE_KEY,
    width: 100,
    height: 200,
  });
  imageId = (await makeWord(CROP_KEY, page._id))._id;
});

test("reports health without logging in", async () => {
  const response = await new Client().request("/api/health");
  assert.deepEqual(await response.json(), { status: "ok" });
});

test("there is no way to register", async () => {
  const body = { email: "new@example.com", password: PASSWORD };
  for (const path of ["/api/auth/register", "/api/auth/signup", "/api/users"]) {
    const response = await new Client().request(path, { method: "POST", body });
    assert.equal(response.status, 404);
  }
  assert.equal(await User.countDocuments(), 0);
});

test("logs in, reports the user, and logs out", async () => {
  await makeUser("person@example.com");
  const client = new Client();
  assert.equal((await client.request("/api/auth/me")).status, 401);

  const login = await client.login("Person@Example.com");
  assert.equal(login.status, 200);
  const body = await login.json();
  assert.equal(body.email, "person@example.com");
  assert.equal("passwordHash" in body, false);

  assert.equal((await client.request("/api/auth/me")).status, 200);
  await client.request("/api/auth/logout", { method: "POST" });
  assert.equal((await client.request("/api/auth/me")).status, 401);
});

test("gives the same response for a wrong password and an unknown email", async () => {
  await makeUser("person@example.com");
  const wrongPassword = await new Client().login("person@example.com", "wrong");
  const unknownEmail = await new Client().login("nobody@example.com");
  assert.equal(wrongPassword.status, 401);
  assert.deepEqual(await wrongPassword.json(), await unknownEmail.json());
});

test("blocks repeated login attempts", async (context) => {
  const limited = createApp({
    sessionSecret: "test",
    secureCookies: false,
    storageDirectory: storage,
    loginAttempts: 2,
  }).listen(0);
  context.after(() => limited.close());
  await new Promise((resolve) => limited.once("listening", resolve));
  const url = `http://localhost:${(limited.address() as AddressInfo).port}/api/auth/login`;
  const attempt = () =>
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "person@example.com", password: "wrong" }),
    });

  assert.equal((await attempt()).status, 401);
  assert.equal((await attempt()).status, 401);
  assert.equal((await attempt()).status, 429);
});

test("labelling needs training", async () => {
  const client = await loggedIn("person@example.com", {}, false);
  assert.equal((await client.request("/api/labelling/next")).status, 403);
});

test("users only see the script classes they qualified for", async () => {
  const user = await makeUser("person@example.com");
  await Qualification.create({ user: user._id, scriptClass: "running" });
  const client = new Client();
  await client.login("person@example.com");
  assert.deepEqual(await (await client.request("/api/labelling/next")).json(), { image: null });
});

test("labelling needs a login and an accepted license", async () => {
  assert.equal((await new Client().request("/api/labelling/next")).status, 401);

  const client = await loggedIn("person@example.com", { labelsLicenseAcceptedAt: undefined });
  assert.equal((await client.request("/api/labelling/next")).status, 403);
  await client.request("/api/auth/accept-license", { method: "POST" });
  assert.equal((await client.request("/api/labelling/next")).status, 200);
});

test("hands out an image and keeps giving it until it is labelled", async () => {
  const client = await loggedIn("person@example.com");
  const first = await (await client.request("/api/labelling/next")).json();
  const second = await (await client.request("/api/labelling/next")).json();
  assert.equal(first.image.id, String(imageId));
  assert.equal(second.image.id, first.image.id);
  assert.equal(await Assignment.countDocuments(), 1);

  const posted = await client.request(`/api/labelling/${imageId}`, {
    method: "POST",
    body: { category: "manchu", transcription: "manju" },
  });
  assert.equal(posted.status, 201);
  const annotation = await Annotation.findOne().orFail();
  assert.equal(annotation.transcription?.manchu, "ᠮᠠᠨᠵᡠ");
  assert.equal(annotation.confidence?.transcription, "confident");

  assert.deepEqual(await (await client.request("/api/labelling/next")).json(), { image: null });
});

test("rejects invalid labels and a second submission", async () => {
  const client = await loggedIn("person@example.com");
  await client.request("/api/labelling/next");
  const post = (body: object) =>
    client.request(`/api/labelling/${imageId}`, { method: "POST", body });

  for (const body of [
    { category: "unknown" },
    { category: "manchu" },
    { category: "manchu", transcription: "man1ju" },
    { category: "manchu", transcription: "manju", script: "unknown" },
    { category: "manchu", transcription: "manju", confidence: { transcription: "maybe" } },
  ]) {
    assert.equal((await post(body)).status, 400);
  }
  assert.equal((await post({ category: "bad_crop" })).status, 201);
  assert.equal((await post({ category: "bad_crop" })).status, 409);
});

test("a client cannot supply its own Manchu text", async () => {
  const client = await loggedIn("person@example.com");
  await client.request("/api/labelling/next");
  await client.request(`/api/labelling/${imageId}`, {
    method: "POST",
    body: { category: "manchu", transcription: "be", manchu: "ᡳ" },
  });
  assert.equal((await Annotation.findOne().orFail()).transcription?.manchu, "ᠪᡝ");
});

test("users can only see the context of images assigned to them", async () => {
  const client = await loggedIn("person@example.com");
  assert.equal((await client.request(`/api/labelling/${imageId}/context`)).status, 404);
  await client.request("/api/labelling/next");
  const context = await (await client.request(`/api/labelling/${imageId}/context`)).json();
  assert.deepEqual(context.box, { x: 1, y: 2, width: 3, height: 4 });
  assert.equal(context.width, 100);
});

test("hands out words imported before the retired field existed", async () => {
  await WordInstance.collection.updateMany({}, { $unset: { retired: "" } });
  const client = await loggedIn("person@example.com");
  const { image } = await (await client.request("/api/labelling/next")).json();
  assert.equal(image.id, String(imageId));
});

test("a labelled image leaves the queue after two users", async () => {
  await Annotation.insertMany(
    ["a", "b"].map(() => ({
      wordImage: imageId,
      user: new Types.ObjectId(),
      category: "bad_crop",
      converterVersion: 1,
    })),
  );
  const client = await loggedIn("person@example.com");
  assert.deepEqual(await (await client.request("/api/labelling/next")).json(), { image: null });
});

test("words under review are not handed out", async () => {
  const image = await WordImage.findById(imageId).orFail();
  await CropReview.create({ reason: "same_word", instances: [image.instance], crops: [imageId] });
  const client = await loggedIn("person@example.com");
  assert.deepEqual(await (await client.request("/api/labelling/next")).json(), { image: null });
});

test("the response is identical for an image with a known label", async () => {
  const without = await loggedIn("first@example.com");
  const before = await (await without.request("/api/labelling/next")).text();
  const contextBefore = await (await without.request(`/api/labelling/${imageId}/context`)).text();

  // The same crop, now a hidden check, handed to another user as the queue would.
  await KnownLabel.create({ wordImage: imageId, category: "manchu", manchu: "ᠮᠠᠨᠵᡠ", origin: "test" });
  const withLabel = await loggedIn("second@example.com");
  const user = await User.findOne({ email: "second@example.com" }).orFail();
  await Assignment.create({ user: user._id, wordImage: imageId });
  assert.equal(await (await withLabel.request("/api/labelling/next")).text(), before);
  const contextAfter = await (await withLabel.request(`/api/labelling/${imageId}/context`)).text();
  assert.equal(contextAfter, contextBefore);
});

/** Adds an ordinary crop and a hidden check on the test page, and returns their ids. */
async function makeCheck() {
  const image = await WordImage.findById(imageId).orFail();
  const check = await makeWord("33333333-3333-4333-8333-333333333333.jpg", image.page, { word: 1 });
  await KnownLabel.create({ wordImage: check._id, category: "manchu", manchu: "ᠮᠠᠨᠵᡠ", origin: "test" });
  return check._id;
}

const always = () => 0;
const never = () => 0.99;

test("mixes in each hidden check once, at the check rate", async () => {
  const check = await makeCheck();
  const user = (await makeUser("person@example.com"))._id;
  assert.equal(String(await pickNextImage(user, ["regular"], never)), String(imageId));
  assert.equal(String(await pickNextImage(user, ["regular"], always)), String(check));

  await Assignment.create({ user, wordImage: check });
  assert.equal(String(await pickNextImage(user, ["regular"], always)), String(imageId));
});

test("hidden checks are only given while ordinary images remain", async () => {
  await makeCheck();
  const user = (await makeUser("person@example.com"))._id;
  await Assignment.create({ user, wordImage: imageId, submittedAt: new Date() });
  assert.equal(await pickNextImage(user, ["regular"], always), null);
});

test("retired checks are not given, and known images never go to the ordinary queue", async () => {
  const check = await makeCheck();
  await KnownLabel.updateOne({ wordImage: check }, { state: "retired" });
  const user = (await makeUser("person@example.com"))._id;
  for (const random of [always, never]) {
    assert.equal(String(await pickNextImage(user, ["regular"], random)), String(imageId));
  }
});

test("checks are more frequent for a user's first 100 images", () => {
  assert.equal(checkRate(0), 0.2);
  assert.equal(checkRate(99), 0.2);
  assert.equal(checkRate(100), 0.08);
});

test("grades each user's latest label on a check, and counts failures in a row", async () => {
  const check = await makeCheck();
  const [first, second] = [new Types.ObjectId(), new Types.ObjectId()];
  const label = (user: Types.ObjectId, abkai: string, minutes: number) => ({
    wordImage: check,
    user,
    category: "manchu",
    transcription: { abkai, manchu: abkaiToManchu(abkai).text },
    converterVersion: 1,
    createdAt: new Date(2026, 0, 1, 0, minutes),
  });
  // The first user corrects a wrong label. The second user misses a letter.
  await Annotation.insertMany([label(first, "manjv", 0), label(first, "manju", 1), label(second, "manj", 2)]);

  const results = await checkResults();
  assert.deepEqual(
    results.map(({ user, passed, scriptClass }) => [String(user), passed, scriptClass]),
    [
      [String(first), true, "regular"],
      [String(second), false, "regular"],
    ],
  );
  assert.equal(summarizeChecks(results).get(`${second}:regular`)?.failedInARow, 1);
});

test("a check passes only on an exact match", () => {
  const answer = { category: "manchu", manchu: "ᠮᠠᠨᠵᡠ" };
  assert.equal(passesCheck(answer, { category: "manchu", transcription: { manchu: "ᠮᠠᠨᠵᡠ" } }), true);
  assert.equal(passesCheck(answer, { category: "manchu", transcription: { manchu: "ᠮᠠᠨᠵ?" } }), false);
  assert.equal(passesCheck(answer, { category: "bad_crop" }), false);
  assert.equal(passesCheck({ category: "chinese" }, { category: "chinese" }), true);
});

test("imports known answers by crop name, checking every line first", async () => {
  const image = await WordImage.findById(imageId).orFail();
  await makeWord("44444444-4444-4444-8444-444444444444.jpg", image.page, {
    side: "right",
    column: 2,
    word: 3,
  });
  const lines = [
    { crop: "0001_left_00_00", category: "manchu", abkai: "manju" },
    { crop: "0001_right_02_03.jpg", category: "chinese" },
  ];
  for (const bad of [
    [{ crop: "0001_left_00_00", category: "manchu", abkai: "man?ju" }],
    [{ crop: "0001_left_00_00", category: "manchu" }],
    [{ crop: "0001_left_00_00", category: "chinese", abkai: "manju" }],
    [{ crop: "0001_left_09_09", category: "chinese" }],
    [{ crop: "0002_left_00_00", category: "chinese" }],
    [lines[0], lines[0]],
  ]) {
    await assert.rejects(importKnownLabels("test", "tester", bad as typeof lines));
  }
  assert.equal(await KnownLabel.countDocuments(), 0);

  assert.equal(await importKnownLabels("test", "tester", lines), 2);
  const known = await KnownLabel.findOne({ wordImage: imageId }).orFail();
  assert.equal(known.manchu, "ᠮᠠᠨᠵᡠ");
  assert.equal(known.origin, "tester");
  await assert.rejects(importKnownLabels("test", "tester", [lines[1] as (typeof lines)[number]]));
});

/**
 * Makes quiz images for each phase, like the real bank: Manchu synthetic and printed words, and Chinese
 * manuscript crops.
 */
async function makeBank(perPhase: number, phases = ["synthetic", "printed", "manuscript"]) {
  await TrainingItem.insertMany(
    phases.flatMap((kind, phase) =>
      Array.from({ length: perPhase }, (_, index) => ({
        scriptClass: "regular",
        kind,
        ...(kind === "manuscript"
          ? { category: "chinese" }
          : { category: "manchu", abkai: "manju", manchu: "ᠮᠠᠨᠵᡠ" }),
        imageKey: `00000000-0000-4000-8000-${String(phase * 1000 + index).padStart(12, "0")}.png`,
        source: "test",
      })),
    ),
  );
}

const answerQuiz = (client: Client, body: object) =>
  client.request("/api/training/regular/answer", { method: "POST", body });

test("a quiz image hides its answer until the user answers", async () => {
  await makeBank(3);
  const client = await loggedIn("person@example.com", {}, false);
  const next = await (await client.request("/api/training/regular/next")).text();
  assert.doesNotMatch(next, /manju|ᠮᠠᠨᠵᡠ|manchu|category/);

  const result = await (await answerQuiz(client, { category: "manchu", transcription: "manju" })).json();
  assert.equal(result.correct, true);
  assert.equal(result.answer.abkai, "manju");
  assert.equal(result.answer.mollendorff, "manju");
});

test("a reload gives the same quiz image, and it cannot be answered twice", async () => {
  await makeBank(3);
  const client = await loggedIn("person@example.com", {}, false);
  const next = () => client.request("/api/training/regular/next").then((r) => r.json());
  const first = await next();
  assert.equal((await next()).item.id, first.item.id);

  const body = { category: "bad_crop" };
  assert.equal((await answerQuiz(client, body)).status, 200);
  assert.equal((await answerQuiz(client, body)).status, 409);
});

test("marks the wrong word and the wrong category as incorrect", async () => {
  await makeBank(3);
  const client = await loggedIn("person@example.com", {}, false);
  for (const body of [{ category: "manchu", transcription: "manjv" }, { category: "chinese" }]) {
    await client.request("/api/training/regular/next");
    assert.equal((await (await answerQuiz(client, body)).json()).correct, false);
  }
});

test("rejects quiz answers that are not valid", async () => {
  await makeBank(1);
  const client = await loggedIn("person@example.com", {}, false);
  await client.request("/api/training/regular/next");
  for (const body of [{}, { category: "manchu" }, { category: "manchu", transcription: "1" }]) {
    assert.equal((await answerQuiz(client, body)).status, 400);
  }
  assert.equal((await client.request("/api/training/unknown/next")).status, 404);
});

const MANCHU = { category: "manchu", transcription: "manju" };
const CHINESE = { category: "chinese" };
const WRONG = { category: "bad_crop" };

/** Answers the waiting image in the quiz or in practice, and returns the result. */
async function answerNext(client: Client, body: object, path = "") {
  await client.request(`/api/training/regular${path}/next`);
  const response = await client.request(`/api/training/regular${path}/answer`, { method: "POST", body });
  return response.json();
}

async function passPhase(client: Client, body: object) {
  let progress;
  for (let count = 0; count < 8; count += 1) ({ progress } = await answerNext(client, body));
  return progress;
}

test("eight in a row in each phase, in order, qualify a user", async () => {
  await makeBank(20);
  const client = await loggedIn("person@example.com", {}, false);
  for (let count = 1; count <= 8; count += 1) {
    const { progress } = await answerNext(client, MANCHU);
    assert.equal(progress.phases[0].needed, 8 - count);
    assert.equal(progress.phases[0].passed, count === 8);
  }
  assert.equal((await passPhase(client, MANCHU)).phases[1].passed, true);
  for (let count = 1; count <= 8; count += 1) {
    const { progress } = await answerNext(client, CHINESE);
    assert.equal(progress.qualified, count === 8);
  }
  const kinds = (await TrainingAttempt.find().sort({ createdAt: 1, _id: 1 })).map(({ kind }) => kind);
  assert.deepEqual(kinds, [
    ...Array(8).fill("synthetic"),
    ...Array(8).fill("printed"),
    ...Array(8).fill("manuscript"),
  ]);
  assert.equal((await client.request("/api/labelling/next")).status, 200);
});

test("a wrong answer restarts its own phase but not earlier ones", async () => {
  await makeBank(30);
  const client = await loggedIn("person@example.com", {}, false);
  await passPhase(client, MANCHU);
  for (let count = 0; count < 7; count += 1) await answerNext(client, MANCHU);
  const { progress } = await answerNext(client, WRONG);
  assert.equal(progress.phases[0].passed, true);
  assert.equal(progress.phases[1].needed, 8);
  assert.equal((await passPhase(client, MANCHU)).phases[1].passed, true);
});

test("a phase without images is passed automatically", async () => {
  await makeBank(20, ["synthetic", "printed"]);
  const client = await loggedIn("person@example.com", {}, false);
  await passPhase(client, MANCHU);
  const progress = await passPhase(client, MANCHU);
  assert.equal(progress.phases[2].passed, true);
  assert.equal(progress.qualified, true);
});

test("practice opens after the synthetic phase and does not affect progress", async () => {
  await makeBank(20);
  const client = await loggedIn("person@example.com", {}, false);
  assert.equal((await client.request("/api/training/regular/practice/next")).status, 409);
  await passPhase(client, MANCHU);
  await answerNext(client, MANCHU);

  const { progress } = await answerNext(client, WRONG, "/practice");
  assert.equal(progress.phases[0].passed, true);
  assert.equal(progress.phases[1].needed, 7);
  const last = await TrainingAttempt.findOne().sort({ createdAt: -1, _id: -1 });
  assert.equal(last?.kind, "synthetic");
});

test("practice cannot be used to skip a quiz image", async () => {
  await makeBank(20);
  const client = await loggedIn("person@example.com", {}, false);
  await passPhase(client, MANCHU);
  const next = (path = "") => client.request(`/api/training/regular${path}/next`).then((r) => r.json());
  const waiting = (await next()).item.id;
  await answerNext(client, MANCHU, "/practice");
  assert.equal((await next()).item.id, waiting);
});

test("the image never repeats until the bank runs out", async () => {
  await makeBank(5);
  const client = await loggedIn("person@example.com", {}, false);
  const seen = new Set();
  for (let count = 0; count < 5; count += 1) {
    const { item } = await (await client.request("/api/training/regular/next")).json();
    seen.add(item.id);
    await answerQuiz(client, WRONG);
  }
  assert.equal(seen.size, 5);
  const { item } = await (await client.request("/api/training/regular/next")).json();
  assert.ok(item);
});

test("moves quiz images from before phases into printed and manuscript", async () => {
  const items = TrainingItem.collection;
  const base = { scriptClass: "regular", source: "test", active: true };
  await items.insertMany([
    { ...base, kind: "real", category: "manchu", abkai: "manju", imageKey: "a.png" },
    { ...base, kind: "real", category: "chinese", imageKey: "b.png" },
    { ...base, kind: "synthetic", category: "manchu", abkai: "manju", imageKey: "c.png" },
  ]);
  assert.deepEqual(await splitRealTraining(), { printed: 1, manuscript: 1 });
  const kinds = (await items.find().sort({ imageKey: 1 }).toArray()).map(({ kind }) => kind);
  assert.deepEqual(kinds, ["printed", "manuscript", "synthetic"]);
  assert.deepEqual(await splitRealTraining(), { printed: 0, manuscript: 0 });
});

test("reports which classes have quizzes", async () => {
  await makeBank(1);
  const client = await loggedIn("person@example.com", {}, false);
  const status = await (await client.request("/api/training/status")).json();
  assert.equal(status.classes[0].scriptClass, "regular");
  assert.deepEqual(status.qualified, []);
});

test("images need a login and a well-formed key", async () => {
  assert.equal((await new Client().request(`/api/images/${CROP_KEY}`)).status, 401);
  const client = await loggedIn("person@example.com");
  assert.equal((await client.request(`/api/images/${CROP_KEY}`)).status, 200);
  assert.equal((await client.request("/api/images/..%2Fsecret.jpg")).status, 404);
});

test("only admins can read and rule on crop reviews", async () => {
  const image = await WordImage.findById(imageId).orFail();
  const review = await CropReview.create({
    reason: "same_word",
    instances: [image.instance],
    crops: [imageId],
  });
  const labeler = await loggedIn("labeler@example.com");
  assert.equal((await labeler.request("/api/admin/crop-reviews")).status, 403);

  const admin = await loggedIn("admin@example.com", { role: "admin" });
  const list = await (await admin.request("/api/admin/crop-reviews")).json();
  assert.equal(list.reviews.length, 1);
  assert.equal(list.reviews[0].crops[0].imageUrl, `/api/images/${CROP_KEY}`);

  const ruled = await admin.request(`/api/admin/crop-reviews/${review._id}/ruling`, {
    method: "POST",
    body: { chosenCrop: String(imageId) },
  });
  assert.equal(ruled.status, 204);
  const again = await admin.request(`/api/admin/crop-reviews/${review._id}/ruling`, {
    method: "POST",
    body: { chosenCrop: String(imageId) },
  });
  assert.equal(again.status, 409);
});

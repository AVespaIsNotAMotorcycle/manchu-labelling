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
import { clock } from "../src/consensus.ts";
import { connectDatabase } from "../src/db.ts";
import { CropReview, WordImage, WordInstance } from "../src/models/crops.ts";
import { Annotation, Assignment, HeldBackReview, KnownLabel } from "../src/models/labels.ts";
import { Page, Volume } from "../src/models/sources.ts";
import {
  Qualification,
  QuizReset as QuizResetModel,
  TrainingAttempt,
  TrainingItem,
} from "../src/models/training.ts";
import { User } from "../src/models/users.ts";
import { hashPassword } from "../src/passwords.ts";
import { checkRate, pickNextImage } from "../src/queue.ts";
import { agreedAnswer } from "../src/held-back.ts";
import { holdBackUnchosen } from "../src/scripts/hold-back.ts";
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
  // Labels made in a test are an hour old as far as settling is concerned, unless a test says otherwise.
  clock.now = () => Date.now() + 2 * 60 * 60_000;
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

test("there is no way to register without an invite", async () => {
  const body = { email: "new@example.com", password: PASSWORD };
  for (const path of ["/api/auth/signup", "/api/users"]) {
    assert.equal((await new Client().request(path, { method: "POST", body })).status, 404);
  }
  for (const invite of [undefined, "", "made-up"]) {
    const response = await new Client().request("/api/auth/register", { method: "POST", body: { ...body, invite } });
    assert.equal(response.status, 400);
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

/** Gives an image submitted labels from new users. */
async function labelBy(image: Types.ObjectId, count: number, label: object = { category: "chinese" }) {
  const before = await Annotation.countDocuments({ wordImage: image });
  for (let index = before; index < before + count; index += 1) {
    const user = (await makeUser(`labeler${index}-${new Types.ObjectId()}@example.com`))._id;
    await Assignment.create({ user, wordImage: image, submittedAt: new Date() });
    await Annotation.create({ wordImage: image, user, converterVersion: 1, ...label });
  }
}

test("an ordinary image leaves the queue after 2 labels, a held-back one after 3", async () => {
  const user = (await makeUser("person@example.com"))._id;
  await labelBy(imageId, 2);
  assert.equal(await pickNextImage(user, ["regular"], never), null);

  const image = await WordImage.findById(imageId).orFail();
  await WordInstance.updateOne({ _id: image.instance }, { heldBack: true });
  assert.equal(String(await pickNextImage(user, ["regular"], never)), String(imageId));
  await labelBy(imageId, 1);
  assert.equal(await pickNextImage(user, ["regular"], never), null);
});

test("holds back words that have no choice yet, and leaves earlier choices alone", async () => {
  const image = await WordImage.findById(imageId).orFail();
  const other = await makeWord("66666666-6666-4666-8666-666666666666.jpg", image.page, { word: 1 });
  await WordInstance.updateOne({ _id: other.instance }, { heldBack: false });
  assert.deepEqual(await holdBackUnchosen(always), { chosen: 1, heldBack: 1 });
  assert.equal((await WordInstance.findById(image.instance).orFail()).heldBack, true);
  assert.equal((await WordInstance.findById(other.instance).orFail()).heldBack, false);
  assert.deepEqual(await holdBackUnchosen(always), { chosen: 0, heldBack: 0 });
});

test("the response is identical for a held-back image", async () => {
  const client = await loggedIn("first@example.com");
  const before = await (await client.request("/api/labelling/next")).text();
  const image = await WordImage.findById(imageId).orFail();
  await WordInstance.updateOne({ _id: image.instance }, { heldBack: true });
  const other = await loggedIn("second@example.com");
  const user = await User.findOne({ email: "second@example.com" }).orFail();
  await Assignment.create({ user: user._id, wordImage: imageId });
  assert.equal(await (await other.request("/api/labelling/next")).text(), before);
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
    createdAt: new Date(Date.now() + minutes * 60_000),
  });
  // The first user corrects a wrong label. The second user misses a letter.
  await Annotation.insertMany([label(first, "manjv", 1), label(first, "manju", 2), label(second, "manj", 3)]);

  const results = await checkResults();
  assert.deepEqual(
    results.map(({ user, passed, scriptClass, accuracy }) => [String(user), passed, scriptClass, accuracy]),
    [
      [String(first), true, "regular", 1],
      [String(second), false, "regular", 0.8],
    ],
  );
  assert.equal(summarizeChecks(results).get(`${second}:regular`)?.failedInARow, 1);
});

test("only grades labels made after an image became a check, and not on withdrawn checks", async () => {
  const check = await makeCheck();
  const label = (minutes: number) => ({
    wordImage: check,
    user: new Types.ObjectId(),
    category: "chinese",
    converterVersion: 1,
    createdAt: new Date(Date.now() + minutes * 60_000),
  });
  await Annotation.insertMany([label(-10), label(10)]);
  assert.equal((await checkResults()).length, 1);

  await KnownLabel.updateOne({ wordImage: check }, { state: "withdrawn" });
  assert.equal((await checkResults()).length, 0);
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

const resetQuiz = (client: Client) => client.request("/api/training/regular/reset", { method: "POST" });

test("a reset restarts every phase and suspends labelling until the user passes again", async () => {
  await makeBank(40);
  const client = await loggedIn("person@example.com", {}, false);
  await passPhase(client, MANCHU);
  await passPhase(client, MANCHU);
  assert.equal((await passPhase(client, CHINESE)).qualified, true);

  const response = await resetQuiz(client);
  assert.equal(response.status, 200);
  const { progress } = await response.json();
  assert.equal(progress.qualified, false);
  assert.equal(progress.answered, 0);
  assert.deepEqual(progress.phases.map(({ passed }: { passed: boolean }) => passed), [false, false, false]);
  assert.equal((await client.request("/api/labelling/next")).status, 403);
  assert.equal((await client.request("/api/training/regular/practice/next")).status, 409);
  assert.deepEqual((await (await client.request("/api/training/status")).json()).qualified, []);

  // Earlier answers stay on record.
  assert.equal(await TrainingAttempt.countDocuments(), 24);
  await passPhase(client, MANCHU);
  await passPhase(client, MANCHU);
  assert.equal((await passPhase(client, CHINESE)).qualified, true);
  assert.equal((await client.request("/api/labelling/next")).status, 200);
});

test("a qualified user can reset, and there is nothing to reset before the first answer", async () => {
  await makeBank(3);
  const fresh = await loggedIn("fresh@example.com", {}, false);
  assert.equal((await resetQuiz(fresh)).status, 409);
  assert.equal((await fresh.request("/api/training/unknown/reset", { method: "POST" })).status, 404);

  const qualified = await loggedIn("person@example.com");
  assert.equal((await resetQuiz(qualified)).status, 200);
  assert.equal((await qualified.request("/api/labelling/next")).status, 403);
  assert.equal((await resetQuiz(qualified)).status, 409);
});

/** Makes hidden checks whose answer is manju, and labels each one for the user, a minute apart. */
async function labelChecks(user: Types.ObjectId, readings: string[], start = 1) {
  const image = await WordImage.findById(imageId).orFail();
  const checks = [];
  for (const [index, abkai] of readings.entries()) {
    const number = start + index;
    const key = `44444444-4444-4444-8444-${String(number).padStart(12, "0")}.jpg`;
    const check = await makeWord(key, image.page, { word: 100 + number });
    await KnownLabel.create({ wordImage: check._id, category: "manchu", manchu: "ᠮᠠᠨᠵᡠ", origin: "test" });
    await Annotation.create({
      wordImage: check._id,
      user,
      category: "manchu",
      transcription: { abkai, manchu: abkaiToManchu(abkai).text },
      converterVersion: 1,
      createdAt: new Date(Date.now() + number * 60_000),
    });
    checks.push(check._id);
  }
  return checks;
}

test("5 failed checks in a row cost qualification until the quiz is passed again", async () => {
  await makeBank(40);
  const client = await loggedIn("person@example.com");
  const user = (await User.findOne({ email: "person@example.com" }).orFail())._id;
  // A quiz answer given before the loss does not count afterwards.
  await answerNext(client, MANCHU);
  await labelChecks(user, ["manju", "manjv", "manjv", "manjv", "manjv"]);
  assert.equal((await client.request("/api/labelling/next")).status, 200);

  await labelChecks(user, ["manjv"], 6);
  assert.equal((await client.request("/api/labelling/next")).status, 403);
  const { progress } = await (await client.request("/api/training/regular/next")).json();
  assert.equal(progress.qualified, false);
  assert.equal(progress.lostToChecks, true);
  assert.equal(progress.answered, 0);
});

test("overturning a failed check restores qualification lost to it", async () => {
  const client = await loggedIn("person@example.com");
  const user = (await User.findOne({ email: "person@example.com" }).orFail())._id;
  const [first] = await labelChecks(user, ["manjv", "manjv", "manjv", "manjv", "manjv"]);
  assert.equal((await client.request("/api/labelling/next")).status, 403);
  await KnownLabel.updateOne({ wordImage: first }, { state: "withdrawn" });
  assert.equal((await client.request("/api/labelling/next")).status, 200);
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

const manju = { category: "manchu", transcription: { abkai: "manju", manchu: abkaiToManchu("manju").text } };

test("a held-back answer needs 3 labelers who agree exactly and are sure", () => {
  const user = new Types.ObjectId();
  const label = { user, ...manju } as Parameters<typeof agreedAnswer>[0][number];
  assert.equal(agreedAnswer([label, label]), null);
  assert.deepEqual(agreedAnswer([label, label, label])?.manchu, manju.transcription.manchu);
  const other = { ...label, transcription: { manchu: abkaiToManchu("manja").text } };
  assert.equal(agreedAnswer([label, label, other]), null);
  const unsure = { ...label, confidence: { transcription: "unconfident" } };
  assert.equal(agreedAnswer([label, label, unsure]), null);
  const unreadable = { ...label, transcription: { manchu: abkaiToManchu("man?u").text } };
  assert.equal(agreedAnswer([unreadable, unreadable, unreadable]), null);
  const chinese = { user, category: "chinese" as const };
  assert.deepEqual(agreedAnswer([chinese, chinese, chinese])?.category, "chinese");
});

test("an admin confirms agreed held-back answers, which become hidden checks", async () => {
  const image = await WordImage.findById(imageId).orFail();
  await WordInstance.updateOne({ _id: image.instance }, { heldBack: true });
  const labeler = await loggedIn("labeler@example.com");
  assert.equal((await labeler.request("/api/review/held-back")).status, 403);

  const admin = await loggedIn("admin@example.com", { role: "admin" });
  await labelBy(imageId, 2, manju);
  assert.deepEqual((await (await admin.request("/api/review/held-back")).json()).items, []);
  await labelBy(imageId, 1, manju);
  const [item] = (await (await admin.request("/api/review/held-back")).json()).items;
  assert.equal(item.id, String(imageId));
  assert.equal(item.abkai, "manju");
  assert.equal(item.labelers, 3);
  assert.equal(item.context.box.height, 4);

  const decide = (body: object) =>
    admin.request(`/api/review/held-back/${imageId}`, { method: "POST", body });
  assert.equal((await decide({ decision: "maybe", category: "manchu" })).status, 400);
  // A labeler corrected their label after the admin loaded the page.
  assert.equal((await decide({ decision: "yes", category: "chinese" })).status, 409);
  assert.equal(await KnownLabel.countDocuments(), 0);

  assert.equal((await decide({ decision: "yes", category: "manchu", manchu: item.manchu })).status, 204);
  const known = await KnownLabel.findOne({ wordImage: imageId }).orFail();
  assert.equal(known.manchu, manju.transcription.manchu);
  assert.equal(known.state, "active");
  assert.match(known.origin, /3 labelers agreed/);
  assert.equal((await HeldBackReview.findOne({ wordImage: imageId }).orFail()).labelers.length, 3);
  assert.deepEqual((await (await admin.request("/api/review/held-back")).json()).items, []);
  assert.equal((await decide({ decision: "yes", category: "manchu", manchu: item.manchu })).status, 409);
});

test("an admin can turn down an agreed answer, and it is not offered again", async () => {
  const image = await WordImage.findById(imageId).orFail();
  await WordInstance.updateOne({ _id: image.instance }, { heldBack: true });
  await labelBy(imageId, 3, manju);
  const admin = await loggedIn("admin@example.com", { role: "admin" });
  const response = await admin.request(`/api/review/held-back/${imageId}`, {
    method: "POST",
    body: { decision: "no", category: "manchu", manchu: manju.transcription.manchu },
  });
  assert.equal(response.status, 204);
  assert.equal(await KnownLabel.countDocuments(), 0);
  assert.deepEqual((await (await admin.request("/api/review/held-back")).json()).items, []);
});

test("ordinary images never go to held-back review", async () => {
  await labelBy(imageId, 3, manju);
  const admin = await loggedIn("admin@example.com", { role: "admin" });
  assert.deepEqual((await (await admin.request("/api/review/held-back")).json()).items, []);
});

/** Ordinary labels by a user on made-up images, starting some minutes from now. */
async function labelOthers(user: Types.ObjectId, count: number, fromMinute: number) {
  await Annotation.insertMany(
    Array.from({ length: count }, (_, index) => ({
      wordImage: new Types.ObjectId(),
      user,
      category: "chinese",
      converterVersion: 1,
      createdAt: new Date(Date.now() + (fromMinute + index) * 60_000),
    })),
  );
}

async function userId(email: string) {
  return (await User.findOne({ email }).orFail())._id;
}

test("past checks and accuracy only show after 25 more labels", async () => {
  const client = await loggedIn("person@example.com");
  const user = await userId("person@example.com");
  const [check] = await labelChecks(user, ["manj"]);
  await labelOthers(user, 24, 10);
  const before = await (await client.request("/api/profile")).json();
  assert.deepEqual(before.checks, []);
  assert.deepEqual(before.accuracy, []);

  await labelOthers(user, 1, 40);
  const after = await (await client.request("/api/profile")).json();
  assert.equal(after.checks.length, 1);
  assert.equal(after.checks[0].id, String(check));
  assert.equal(after.checks[0].passed, false);
  assert.equal(after.checks[0].label.abkai, "manj");
  assert.equal(after.checks[0].answer.abkai, "manju");
  assert.deepEqual(after.accuracy, [{ scriptClass: "regular", answered: 1, passed: 0, accuracy: 0.8 }]);
});

test("a reviewer can correct a disputed check, which regrades it", async () => {
  const client = await loggedIn("person@example.com");
  const reviewer = await loggedIn("reviewer@example.com", { role: "reviewer" });
  const user = await userId("person@example.com");
  const [check, hidden] = await labelChecks(user, ["manj", "manj"]);
  await labelOthers(user, 25, 1.5);
  // Only the first check has 25 labels after it.
  const dispute = (id: unknown, body: object = {}) =>
    client.request("/api/profile/disputes", {
      method: "POST",
      body: { kind: "check", id, category: "manchu", transcription: "manj", note: "No u", ...body },
    });
  assert.equal((await dispute(hidden)).status, 409);
  assert.equal((await dispute(check, { category: "nonsense" })).status, 400);
  assert.equal((await dispute(check)).status, 201);
  assert.equal((await dispute(check)).status, 409);

  assert.equal((await client.request("/api/review/disputes")).status, 403);
  const [item] = (await (await reviewer.request("/api/review/disputes")).json()).items;
  assert.equal(item.proposed.abkai, "manj");
  assert.equal(item.answer.abkai, "manju");
  assert.deepEqual(item.graded, { total: 1, passed: 0 });

  const resolve = (body: object) => reviewer.request(`/api/review/disputes/${item.id}`, { method: "POST", body });
  assert.equal((await resolve({ outcome: "corrected" })).status, 400);
  assert.equal((await resolve({ outcome: "corrected", category: "manchu", transcription: "manj" })).status, 204);
  assert.equal((await resolve({ outcome: "upheld" })).status, 409);

  const known = await KnownLabel.findOne({ wordImage: check }).orFail();
  assert.equal(known.manchu, abkaiToManchu("manj").text);
  assert.equal(known.history?.[0]?.manchu, "ᠮᠠᠨᠵᡠ");
  const profile = await (await client.request("/api/profile")).json();
  assert.equal(profile.checks[0].passed, true);
  assert.equal(profile.checks[0].dispute, "corrected");
  assert.equal(profile.disputes[0].outcome, "corrected");
});

test("a withdrawn check stops grading, and nobody resolves their own dispute", async () => {
  const reviewer = await loggedIn("reviewer@example.com", { role: "reviewer" });
  const user = await userId("reviewer@example.com");
  const [check] = await labelChecks(user, ["manj"]);
  await labelOthers(user, 25, 5);
  const body = { kind: "check", id: check, category: "illegible" };
  assert.equal((await reviewer.request("/api/profile/disputes", { method: "POST", body })).status, 201);
  const [item] = (await (await reviewer.request("/api/review/disputes")).json()).items;
  const resolve = (client: Client) =>
    client.request(`/api/review/disputes/${item.id}`, { method: "POST", body: { outcome: "withdrawn" } });
  assert.equal((await resolve(reviewer)).status, 409);

  const admin = await loggedIn("admin@example.com", { role: "admin" });
  assert.equal((await resolve(admin)).status, 204);
  assert.equal((await KnownLabel.findOne({ wordImage: check }).orFail()).state, "withdrawn");
  assert.deepEqual((await (await reviewer.request("/api/profile")).json()).checks, []);
});

test("a disputed quiz image can be withdrawn but not corrected", async () => {
  await makeBank(3);
  const client = await loggedIn("person@example.com", {}, false);
  const { item } = await (await client.request("/api/training/regular/next")).json();
  const body = { kind: "quiz", id: item.id, category: "manchu", transcription: "manjv" };
  assert.equal((await client.request("/api/profile/disputes", { method: "POST", body })).status, 409);
  await answerQuiz(client, WRONG);
  assert.equal((await client.request("/api/profile/disputes", { method: "POST", body })).status, 201);

  const admin = await loggedIn("admin@example.com", { role: "admin" });
  const [dispute] = (await (await admin.request("/api/review/disputes")).json()).items;
  assert.equal(dispute.kind, "quiz");
  const resolve = (outcome: string) =>
    admin.request(`/api/review/disputes/${dispute.id}`, {
      method: "POST",
      body: { outcome, category: "manchu", transcription: "manjv" },
    });
  assert.equal((await resolve("corrected")).status, 409);
  assert.equal((await resolve("withdrawn")).status, 204);
  assert.equal((await TrainingItem.findById(item.id).orFail()).active, false);
});

test("a reviewer can undo a held-back yes, which withdraws the check, or a no, which reopens it", async () => {
  const image = await WordImage.findById(imageId).orFail();
  await WordInstance.updateOne({ _id: image.instance }, { heldBack: true });
  const reviewer = await loggedIn("reviewer@example.com", { role: "reviewer" });
  await labelBy(imageId, 3, manju);
  const decide = (body: object) => reviewer.request(`/api/review/held-back/${imageId}`, { method: "POST", body });
  const undo = () => reviewer.request(`/api/review/held-back/${imageId}/undo`, { method: "POST" });
  const waiting = async () => (await (await reviewer.request("/api/review/held-back")).json()).items.length;
  const { manchu } = manju.transcription;

  assert.equal((await undo()).status, 409);
  assert.equal((await decide({ decision: "no", category: "manchu", manchu })).status, 204);
  assert.equal(await waiting(), 0);
  const [decision] = (await (await reviewer.request("/api/review/held-back-decisions")).json()).items;
  assert.equal(decision.decision, "no");

  assert.equal((await undo()).status, 204);
  assert.equal(await waiting(), 1);
  assert.equal((await undo()).status, 409);

  assert.equal((await decide({ decision: "yes", category: "manchu", manchu })).status, 204);
  assert.equal((await KnownLabel.findOne({ wordImage: imageId }).orFail()).state, "active");
  assert.equal((await undo()).status, 204);
  assert.equal((await KnownLabel.findOne({ wordImage: imageId }).orFail()).state, "withdrawn");
  // A withdrawn answer is not offered for review again.
  assert.equal(await waiting(), 0);
  assert.deepEqual((await (await reviewer.request("/api/review/held-back-decisions")).json()).items, []);
});

test("a disagreement gets a third label, then goes to a reviewer who gives the final answer", async () => {
  const user = (await makeUser("person@example.com"))._id;
  const manjv = { category: "manchu", transcription: { abkai: "manjv", manchu: abkaiToManchu("manjv").text } };
  await labelBy(imageId, 1, manju);
  await labelBy(imageId, 1, manjv);
  assert.equal(String(await pickNextImage(user, ["regular"], never)), String(imageId));
  await labelBy(imageId, 1, { category: "illegible" });
  assert.equal(await pickNextImage(user, ["regular"], never), null);

  const reviewer = await loggedIn("reviewer@example.com", { role: "reviewer" });
  const labeler = await loggedIn("labeler@example.com");
  assert.equal((await labeler.request("/api/review/labels")).status, 403);
  const [item] = (await (await reviewer.request("/api/review/labels")).json()).items;
  assert.equal(item.id, String(imageId));
  assert.deepEqual(
    item.readings.map(({ category, abkai, count }: { category: string; abkai?: string; count: number }) => [
      category,
      abkai,
      count,
    ]),
    [
      ["manchu", "manju", 1],
      ["manchu", "manjv", 1],
      ["illegible", undefined, 1],
    ],
  );
  assert.equal(item.context.box.width, 3);

  const decide = (body: object) => reviewer.request(`/api/review/labels/${imageId}`, { method: "POST", body });
  assert.equal((await decide({ category: "manchu" })).status, 400);
  assert.equal((await decide({ category: "manchu", transcription: "manju" })).status, 204);
  assert.equal((await decide({ category: "manchu", transcription: "manju" })).status, 409);
  assert.deepEqual((await (await reviewer.request("/api/review/labels")).json()).items, []);
});

test("reviewers do not review images they labelled, or hidden checks", async () => {
  const reviewer = await loggedIn("reviewer@example.com", { role: "reviewer" });
  const reviewerId = await userId("reviewer@example.com");
  await Annotation.create({ wordImage: imageId, user: reviewerId, converterVersion: 1, category: "illegible" });
  await labelBy(imageId, 1, manju);
  await labelBy(imageId, 1, { category: "bad_crop" });
  const items = async () => (await (await reviewer.request("/api/review/labels")).json()).items;
  assert.deepEqual(await items(), []);

  const check = await makeCheck();
  await labelBy(check, 1, { category: "illegible" });
  await labelBy(check, 1, { category: "bad_crop" });
  await labelBy(check, 1, { category: "non_text" });
  assert.deepEqual(await items(), []);
});

test("a held-back agreement only counts labelers who were trusted at the time", async () => {
  const image = await WordImage.findById(imageId).orFail();
  await WordInstance.updateOne({ _id: image.instance }, { heldBack: true });
  const reviewer = await loggedIn("reviewer@example.com", { role: "reviewer" });
  await labelBy(imageId, 2, manju);
  const careless = (await makeUser("careless@example.com"))._id;
  await labelChecks(careless, Array(10).fill("manjv"));
  await Annotation.create({
    wordImage: imageId,
    user: careless,
    converterVersion: 1,
    category: "manchu",
    transcription: manju.transcription,
    createdAt: new Date(Date.now() + 60 * 60_000),
  });
  assert.deepEqual((await (await reviewer.request("/api/review/held-back")).json()).items, []);
  await labelBy(imageId, 1, manju);
  assert.equal((await (await reviewer.request("/api/review/held-back")).json()).items.length, 1);
});

test("users opt in to being credited by name, and can opt out", async () => {
  const client = await loggedIn("person@example.com");
  const put = (name: unknown) => client.request("/api/profile/credit", { method: "PUT", body: { name } });
  assert.equal((await (await client.request("/api/profile")).json()).creditName, null);
  assert.equal((await put("x".repeat(101))).status, 400);
  assert.equal((await put("<b>")).status, 400);
  assert.deepEqual(await (await put("  Ada Lovelace ")).json(), { creditName: "Ada Lovelace" });
  assert.equal((await (await client.request("/api/profile")).json()).creditName, "Ada Lovelace");
  assert.deepEqual(await (await put(null)).json(), { creditName: null });
  assert.equal((await User.findOne({ email: "person@example.com" }).lean())?.creditName, undefined);
});

test("refuses changes from other sites and bodies that are not JSON, and sets security headers", async () => {
  const client = await loggedIn("person@example.com");
  const post = (headers: Record<string, string>, body = "{}") =>
    fetch(`${base}/api/auth/accept-license`, { method: "POST", headers: { cookie: client.cookie, ...headers }, body });
  assert.equal((await post({ "Content-Type": "application/json", Origin: "https://evil.example" })).status, 403);
  assert.equal((await post({ "Content-Type": "application/json", "Sec-Fetch-Site": "cross-site" })).status, 403);
  assert.equal((await post({ "Content-Type": "text/plain" })).status, 415);
  assert.equal((await post({ "Content-Type": "application/json", Origin: base, "Sec-Fetch-Site": "same-origin" })).status, 200);

  const response = await client.request("/api/health");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.match(response.headers.get("content-security-policy") ?? "", /frame-ancestors 'none'/);
});

test("turns away logins when too many passwords are being checked at once", async () => {
  const { verifyPassword, HashingBusyError } = await import("../src/passwords.ts");
  const results = await Promise.allSettled(Array.from({ length: 25 }, () => verifyPassword("x", passwordHash)));
  const busy = results.filter((result) => result.status === "rejected");
  assert.equal(busy.length, 3);
  assert.ok(busy.every((result) => (result as PromiseRejectedResult).reason instanceof HashingBusyError));
});

test("login limits are kept in MongoDB, and also count failures per account from any address", async (context) => {
  const limited = createApp({
    sessionSecret: "test",
    secureCookies: false,
    storageDirectory: storage,
    loginAttempts: 1000,
    accountAttempts: 2,
    persistentRateLimits: true,
  }).listen(0);
  context.after(() => limited.close());
  await new Promise((resolve) => limited.once("listening", resolve));
  const url = `http://localhost:${(limited.address() as AddressInfo).port}/api/auth/login`;
  const attempt = (email: string, password = "wrong") =>
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
  await makeUser("person@example.com");
  context.mock.method(console, "warn", () => {});

  assert.equal((await attempt("person@example.com", PASSWORD)).status, 200);
  assert.equal((await attempt("Person@example.com ")).status, 401);
  assert.equal((await attempt("person@example.com")).status, 401);
  assert.equal((await attempt("person@example.com", PASSWORD)).status, 429);
  assert.equal((await attempt("other@example.com")).status, 401);

  const { RateLimit } = await import("../src/rate-limit.ts");
  const record = await RateLimit.findById("login-account:account:person@example.com").lean();
  assert.equal(record?.hits, 3);
  assert.ok(record && record.resetAt > new Date());
  const warnings = (console.warn as unknown as { mock: { calls: { arguments: string[] }[] } }).mock.calls;
  assert.match(warnings[0]?.arguments[0] ?? "", /"event":"login-account.limited"/);
});

test("a rate limit window starts again once it ends", async () => {
  const { MongoRateLimitStore } = await import("../src/rate-limit.ts");
  const store = new MongoRateLimitStore("test");
  store.init({ windowMs: 50 } as never);
  assert.equal((await store.increment("key")).totalHits, 1);
  assert.equal((await store.increment("key")).totalHits, 2);
  await store.decrement("key");
  assert.equal((await store.get("key"))?.totalHits, 1);
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(await store.get("key"), undefined);
  assert.equal((await store.increment("key")).totalHits, 1);
  await store.resetKey("key");
  assert.equal(await store.get("key"), undefined);
});

test("an open image from a class the user can no longer label waits until they requalify", async () => {
  const client = await loggedIn("person@example.com");
  const user = await userId("person@example.com");
  const first = (await (await client.request("/api/labelling/next")).json()).image.id;
  const page = (await WordImage.findById(imageId).orFail()).page;
  const running = await Volume.create({
    sourceId: "running",
    title: "Running",
    manifestUrl: "https://example.com/r",
    production: "manuscript",
    script: "running",
    rights: { statement: "s", attribution: "a", permanentLink: "https://example.com/r" },
  });
  const runningPage = await Page.create({ ...(await Page.findById(page).orFail()).toObject(), _id: undefined, volume: running._id, imageKey: "55555555-5555-4555-8555-555555555555.jpg" });
  const other = await makeWord("66666666-6666-4666-8666-666666666666.jpg", runningPage._id);
  await Qualification.create({ user, scriptClass: "running" });
  // The user loses the regular class but keeps running.
  await QuizResetModel.create({ user, scriptClass: "regular" });
  const next = await (await client.request("/api/labelling/next")).json();
  assert.equal(next.image.id, String(other._id));
  assert.notEqual(next.image.id, first);
});

test("correcting a check to another category clears its letters", async () => {
  const client = await loggedIn("person@example.com");
  const reviewer = await loggedIn("reviewer@example.com", { role: "reviewer" });
  const user = await userId("person@example.com");
  const [check] = await labelChecks(user, ["manj"]);
  await labelOthers(user, 25, 5);
  await client.request("/api/profile/disputes", { method: "POST", body: { kind: "check", id: check, category: "bad_crop" } });
  const [item] = (await (await reviewer.request("/api/review/disputes")).json()).items;
  const body = { outcome: "corrected", category: "bad_crop" };
  assert.equal((await reviewer.request(`/api/review/disputes/${item.id}`, { method: "POST", body })).status, 204);
  const known = await KnownLabel.findOne({ wordImage: check }).lean();
  assert.equal(known?.category, "bad_crop");
  assert.equal(known?.manchu, undefined);
  assert.equal(known?.history?.[0]?.category, "manchu");
});

test("the next image can be handed out early, and becomes the current one after a save", async () => {
  const client = await loggedIn("person@example.com");
  const page = (await WordImage.findById(imageId).orFail()).page;
  await makeWord("77777777-7777-4777-8777-777777777771.jpg", page, { word: 1 });
  await makeWord("77777777-7777-4777-8777-777777777772.jpg", page, { word: 2 });
  const get = async (path: string) => (await (await client.request(`/api/labelling/${path}`)).json()).image;

  assert.equal(await get("upcoming"), null);
  const current = await get("next");
  const upcoming = await get("upcoming");
  assert.notEqual(upcoming.id, current.id);
  assert.equal((await get("upcoming")).id, upcoming.id);
  assert.equal((await get("next")).id, current.id);
  assert.equal(await Assignment.countDocuments({ submittedAt: null }), 2);

  const save = await client.request(`/api/labelling/${current.id}`, { method: "POST", body: { category: "chinese" } });
  assert.equal(save.status, 201);
  assert.equal((await get("next")).id, upcoming.id);
  assert.notEqual((await get("upcoming")).id, upcoming.id);
});

test("admins see unpublished labelled images with every label, but not checks or released words", async () => {
  const admin = await loggedIn("admin@example.com", { role: "admin" });
  const labeler = await loggedIn("labeler@example.com");
  assert.equal((await labeler.request("/api/admin/labelled")).status, 403);
  await labelBy(imageId, 2, manju);
  const check = await makeCheck();
  await labelBy(check, 1, { category: "illegible" });
  const page = (await WordImage.findById(imageId).orFail()).page;
  const released = await makeWord("88888888-8888-4888-8888-888888888888.jpg", page, { word: 5 });
  await labelBy(released._id, 1, { category: "chinese" });
  const { ReleasedWord } = await import("../src/models/releases.ts");
  await ReleasedWord.create({ version: "0.1.0", instance: released.instance });

  const body = await (await admin.request("/api/admin/labelled")).json();
  assert.equal(body.total, 1);
  assert.deepEqual(body.counts, { agreed: 1 });
  const [item] = body.items;
  assert.equal(item.id, String(imageId));
  assert.equal(item.status, "agreed");
  assert.equal(item.answer.abkai, "manju");
  assert.equal(item.labels.length, 2);
  assert.match(item.labels[0].labeler, /@example\.com$/);
  assert.equal(item.labels[0].trusted, true);
  assert.equal(item.context.box.width, 3);

  assert.deepEqual((await (await admin.request("/api/admin/labelled?status=single")).json()).items, []);
  assert.equal((await admin.request("/api/admin/labelled?status=nonsense")).status, 400);
});

test("reviewers and held-back confirmation wait 30 minutes after the last label", async () => {
  clock.now = () => Date.now();
  const reviewer = await loggedIn("reviewer@example.com", { role: "reviewer" });
  await labelBy(imageId, 1, manju);
  await labelBy(imageId, 1, { category: "illegible" });
  await labelBy(imageId, 1, { category: "bad_crop" });
  const items = async (path: string) => (await (await reviewer.request(`/api/review/${path}`)).json()).items;
  assert.deepEqual(await items("labels"), []);
  const decide = await reviewer.request(`/api/review/labels/${imageId}`, { method: "POST", body: { category: "illegible" } });
  assert.equal(decide.status, 409);
  clock.now = () => Date.now() + 31 * 60_000;
  assert.equal((await items("labels")).length, 1);

  const image = await WordImage.findById(imageId).orFail();
  const page = image.page;
  const held = await makeWord("99999999-9999-4999-8999-999999999999.jpg", page, { word: 9 });
  await WordInstance.updateOne({ _id: held.instance }, { heldBack: true });
  clock.now = () => Date.now();
  await labelBy(held._id, 3, manju);
  assert.deepEqual(await items("held-back"), []);
  clock.now = () => Date.now() + 31 * 60_000;
  assert.equal((await items("held-back")).length, 1);
});

test("a labeler can change only their last answer, within 30 minutes, keeping the old one", async () => {
  const client = await loggedIn("person@example.com");
  const page = (await WordImage.findById(imageId).orFail()).page;
  await makeWord("12121212-1212-4121-8121-121212121212.jpg", page, { word: 3 });
  assert.deepEqual(await (await client.request("/api/labelling/last")).json(), { last: null });

  const first = (await (await client.request("/api/labelling/next")).json()).image.id;
  await client.request(`/api/labelling/${first}`, { method: "POST", body: { category: "manchu", transcription: "manjv" } });
  const second = (await (await client.request("/api/labelling/next")).json()).image.id;
  await client.request(`/api/labelling/${second}`, { method: "POST", body: { category: "chinese" } });

  const { last } = await (await client.request("/api/labelling/last")).json();
  assert.equal(last.image.id, second);
  assert.equal(last.label.category, "chinese");
  const change = (id: string, body: object) => client.request(`/api/labelling/${id}/change`, { method: "POST", body });
  assert.equal((await change(first, { category: "manchu", transcription: "manju" })).status, 409);
  assert.equal((await change(second, { category: "manchu" })).status, 400);
  assert.equal((await change(second, { category: "manchu", transcription: "manju" })).status, 201);

  const labels = await Annotation.find({ wordImage: second }).sort({ createdAt: 1, _id: 1 }).lean();
  assert.equal(labels.length, 2);
  assert.equal(String(labels[1]?.supersedes), String(labels[0]?._id));
  assert.equal(labels[1]?.transcription?.abkai, "manju");

  // After 30 minutes, the answer is final.
  await Annotation.collection.updateMany({}, { $set: { createdAt: new Date(Date.now() - 31 * 60_000) } });
  assert.deepEqual(await (await client.request("/api/labelling/last")).json(), { last: null });
  assert.equal((await change(second, { category: "illegible" })).status, 409);
});

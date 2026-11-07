import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, test } from "node:test";

import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose, { Types } from "mongoose";

import { createApp } from "../src/app.ts";
import { connectDatabase } from "../src/db.ts";
import { CropReview, WordImage, WordInstance } from "../src/models/crops.ts";
import { Annotation, Assignment, KnownLabel } from "../src/models/labels.ts";
import { Page, Volume } from "../src/models/sources.ts";
import { User } from "../src/models/users.ts";
import { hashPassword } from "../src/passwords.ts";

const PASSWORD = "correct horse battery";
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

async function loggedIn(email: string, overrides: object = {}) {
  await makeUser(email, overrides);
  const client = new Client();
  assert.equal((await client.login(email)).status, 200);
  return client;
}

async function makeWord(key: string, page: Types.ObjectId) {
  const instance = new Types.ObjectId();
  const image = await WordImage.create({
    run: new Types.ObjectId(),
    page,
    instance,
    box: { x: 1, y: 2, width: 3, height: 4 },
    side: "left",
    column: 0,
    word: 0,
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
  await KnownLabel.create({ wordImage: imageId, category: "manchu", origin: "test" });
  const withLabel = await loggedIn("second@example.com");
  assert.equal(await (await withLabel.request("/api/labelling/next")).text(), before);
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

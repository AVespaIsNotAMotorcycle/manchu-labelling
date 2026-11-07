import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

import { abkaiToManchu, CONVERTER_VERSION } from "@manchu-labelling/script";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose, { Types } from "mongoose";

import { connectDatabase } from "../src/db.ts";
import { compareCrops } from "../src/instances.ts";
import { Annotation, Assignment, KnownLabel } from "../src/models/labels.ts";
import { WordImage } from "../src/models/crops.ts";

let database: MongoMemoryServer;

before(async () => {
  database = await MongoMemoryServer.create();
  await connectDatabase(database.getUri());
  await mongoose.connection.syncIndexes();
});

after(async () => {
  await mongoose.disconnect();
  await database.stop();
});

beforeEach(async () => {
  await mongoose.connection.db?.dropDatabase();
  await mongoose.connection.syncIndexes();
});

function manchuLabel(abkai = "manju") {
  return {
    wordImage: new Types.ObjectId(),
    user: new Types.ObjectId(),
    category: "manchu" as const,
    transcription: { abkai, manchu: abkaiToManchu(abkai).text },
    converterVersion: CONVERTER_VERSION,
  };
}

function crop(imageKey: string) {
  return {
    run: new Types.ObjectId(),
    page: new Types.ObjectId(),
    instance: new Types.ObjectId(),
    box: { x: 0, y: 0, width: 10, height: 30 },
    side: "left" as const,
    column: 0,
    word: 0,
    columnType: "manchu" as const,
    imageKey,
  };
}

test("accepts a Manchu label and defaults confidence to confident", async () => {
  const annotation = await Annotation.create(manchuLabel());
  assert.equal(annotation.confidence?.transcription, "confident");
});

test("requires a transcription on Manchu labels only", async () => {
  const { transcription: _transcription, ...label } = manchuLabel();
  await assert.rejects(Annotation.create(label), /needs a transcription/);
  await Annotation.create({ ...label, category: "bad_crop" as const });
});

test("rejects variation selectors and mismatched text", async () => {
  const label = manchuLabel("i");
  await assert.rejects(
    Annotation.create({ ...label, transcription: { abkai: "i", manchu: "ᡳ᠋" } }),
    /does not match/,
  );
  await assert.rejects(
    Annotation.create({ ...label, transcription: { abkai: "be", manchu: "ᡳ" } }),
    /does not match/,
  );
});

test("annotations cannot be changed or deleted", async () => {
  const annotation = await Annotation.create(manchuLabel());
  annotation.category = "bad_crop";
  await assert.rejects(annotation.save(), /append-only/);
  await assert.rejects(Annotation.updateOne({}, { category: "chinese" }), /append-only/);
  await assert.rejects(Annotation.findOneAndDelete({}), /append-only/);
  await assert.rejects(Annotation.deleteMany({}), /append-only/);
  await assert.rejects(annotation.deleteOne(), /append-only/);
  await assert.rejects(
    Annotation.bulkWrite([{ deleteMany: { filter: {} } }]),
    /append-only/,
  );
  assert.equal(await Annotation.countDocuments(), 1);
});

test("a correction is a new annotation pointing to the old one", async () => {
  const original = await Annotation.create(manchuLabel("be"));
  await Annotation.create({ ...manchuLabel("de"), supersedes: original._id });
  assert.equal(await Annotation.countDocuments(), 2);
});

test("crops cannot be changed", async () => {
  await WordImage.create(crop("key-1"));
  await assert.rejects(WordImage.updateOne({}, { word: 3 }), /append-only/);
});

test("records shared with labelers have no field marking a check", () => {
  for (const model of [Annotation, Assignment, WordImage]) {
    const fields = Object.keys(model.schema.paths).join(" ");
    assert.doesNotMatch(fields, /known|check|gold/i);
  }
});

test("each image has at most one known label", async () => {
  const wordImage = new Types.ObjectId();
  await KnownLabel.create({ wordImage, category: "bad_crop", origin: "test" });
  await assert.rejects(KnownLabel.create({ wordImage, category: "chinese", origin: "test" }));
});

test("compares crops from different runs", () => {
  const word = { x: 100, y: 100, width: 50, height: 200 };
  assert.equal(compareCrops(word, { x: 102, y: 105, width: 50, height: 195 }), "same");
  assert.equal(compareCrops(word, { x: 100, y: 500, width: 50, height: 200 }), "separate");

  const mergedTwoWords = { x: 100, y: 100, width: 50, height: 420 };
  assert.equal(compareCrops(word, mergedTwoWords), "conflict");
});

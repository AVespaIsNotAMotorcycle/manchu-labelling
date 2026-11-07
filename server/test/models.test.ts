import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

import { abkaiToManchu, CONVERTER_VERSION } from "@manchu-labelling/script";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose, { Types } from "mongoose";

import { connectDatabase } from "../src/db.ts";
import { compareCrops, matchCrop } from "../src/instances.ts";
import { releasableInstances, ruleOnReview } from "../src/crop-reviews.ts";
import { Annotation, Assignment, KnownLabel } from "../src/models/labels.ts";
import { CropReview, WordImage, WordInstance } from "../src/models/crops.ts";

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

test("a crop matching a word has no conflict, even inside a neighbour", () => {
  const hook = { x: 100, y: 100, width: 20, height: 20 };
  const neighbour = {
    _id: "a",
    box: { x: 90, y: 90, width: 60, height: 200 },
    instance: "neighbour",
  };
  const sameWord = { _id: "b", box: { x: 100, y: 100, width: 20, height: 21 }, instance: "hook" };

  assert.deepEqual(matchCrop(hook, [neighbour, sameWord]), { same: [sameWord], conflicts: [] });
  assert.deepEqual(matchCrop(hook, [neighbour]), { same: [], conflicts: [neighbour] });
  assert.deepEqual(matchCrop(hook, []), { same: [], conflicts: [] });
});

async function instanceWithCrop(key: string) {
  const crops = await WordImage.create(crop(key));
  const instance = await WordInstance.create({
    _id: crops.instance,
    page: crops.page,
    canonicalCrop: crops._id,
  });
  return { crop: crops, instance };
}

test("words with an open review cannot be released", async () => {
  const clean = await instanceWithCrop("clean");
  const disputed = await instanceWithCrop("disputed");
  const second = await WordImage.create(crop("second"));
  await CropReview.create({
    reason: "same_word",
    instances: [disputed.instance._id],
    crops: [disputed.crop._id, second._id],
  });

  const released = await releasableInstances();
  assert.deepEqual(
    released.map(({ _id }) => String(_id)),
    [String(clean.instance._id)],
  );
});

test("a ruling on one word picks the chosen crop and releases the word", async () => {
  const word = await instanceWithCrop("first");
  const second = await WordImage.create({ ...crop("second"), instance: word.instance._id });
  const review = await CropReview.create({
    reason: "same_word",
    instances: [word.instance._id],
    crops: [word.crop._id, second._id],
  });
  const admin = new Types.ObjectId();

  await ruleOnReview(review._id, second._id, admin);

  const updated = await WordInstance.findById(word.instance._id);
  assert.equal(String(updated?.canonicalCrop), String(second._id));
  assert.equal((await releasableInstances()).length, 1);
  const closed = await CropReview.findById(review._id);
  assert.equal(closed?.status, "resolved");
  assert.equal(String(closed?.decidedBy), String(admin));
});

test("a ruling on a conflict retires the losing word and closes its other reviews", async () => {
  const merged = await instanceWithCrop("merged");
  const partOne = await instanceWithCrop("part-one");
  const partTwo = await instanceWithCrop("part-two");
  const open = (part: typeof partOne) =>
    CropReview.create({
      reason: "conflict",
      instances: [merged.instance._id, part.instance._id],
      crops: [merged.crop._id, part.crop._id],
    });
  const first = await open(partOne);
  const second = await open(partTwo);

  await ruleOnReview(first._id, partOne.crop._id, new Types.ObjectId());

  assert.equal((await WordInstance.findById(merged.instance._id))?.retired, true);
  assert.equal((await CropReview.findById(second._id))?.status, "resolved");
  const released = (await releasableInstances()).map(({ _id }) => String(_id)).sort();
  assert.deepEqual(released, [String(partOne.instance._id), String(partTwo.instance._id)].sort());
});

test("a ruling leaves the chosen word's other conflicts open", async () => {
  const word = await instanceWithCrop("word");
  const firstRival = await instanceWithCrop("first-rival");
  const secondRival = await instanceWithCrop("second-rival");
  const open = (rival: typeof word) =>
    CropReview.create({
      reason: "conflict",
      instances: [word.instance._id, rival.instance._id],
      crops: [word.crop._id, rival.crop._id],
    });
  const first = await open(firstRival);
  const second = await open(secondRival);

  await ruleOnReview(first._id, word.crop._id, new Types.ObjectId());

  assert.equal((await CropReview.findById(second._id))?.status, "open");
  assert.deepEqual(await releasableInstances(), []);
});

test("a ruling must choose a crop under review", async () => {
  const word = await instanceWithCrop("first");
  const review = await CropReview.create({
    reason: "same_word",
    instances: [word.instance._id],
    crops: [word.crop._id],
  });
  await assert.rejects(
    ruleOnReview(review._id, new Types.ObjectId(), new Types.ObjectId()),
    /not part of this review/,
  );
});

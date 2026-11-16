import assert from "node:assert/strict";
import { test } from "node:test";

import { Types } from "mongoose";

import type { CheckResult } from "../src/checks.ts";
import { characterAccuracy, editDistance, TrustIndex } from "../src/trust.ts";

test("edit distance counts code points", () => {
  assert.equal(editDistance("ᠮᠠᠨᠵᡠ", "ᠮᠠᠨᠵᡠ"), 0);
  assert.equal(editDistance("ᠮᠠᠨᠵᡠ", "ᠮᠠᠨᠵ"), 1);
  assert.equal(editDistance("ᠮᠠᠨᠵᡠ", "ᠮᡝᠨᠵᡠᠨ"), 2);
  assert.equal(editDistance("", "abc"), 3);
});

test("character accuracy is 0 for a wrong category and never below 0", () => {
  const answer = { category: "manchu", manchu: "ᠮᠠᠨᠵᡠ" };
  assert.equal(characterAccuracy(answer, { category: "chinese" }), 0);
  assert.equal(characterAccuracy(answer, { category: "manchu", transcription: { manchu: "ᠮᠠᠨᠵ" } }), 0.8);
  const long = { category: "manchu", transcription: { manchu: "ᠠᠠᠠᠠᠠᠠᠠᠠᠠᠠᠠᠠᠠᠠ" } };
  assert.equal(characterAccuracy(answer, long), 0);
  assert.equal(characterAccuracy({ category: "chinese" }, { category: "chinese" }), 1);
});

const user = new Types.ObjectId();
const results = (accuracies: number[]): CheckResult[] =>
  accuracies.map((accuracy, index) => ({
    user,
    wordImage: new Types.ObjectId(),
    scriptClass: "regular",
    passed: accuracy === 1,
    accuracy,
    at: new Date(2026, 0, 1, 0, index),
    label: new Types.ObjectId(),
  }));
const later = new Date(2027, 0, 1);

test("users are trusted until they have 10 graded checks", () => {
  const index = new TrustIndex(results(Array(9).fill(0)));
  assert.equal(index.accuracy(user, "regular", later), null);
  assert.equal(index.isTrusted(user, "regular", later), true);
  assert.equal(new TrustIndex(results(Array(10).fill(0))).isTrusted(user, "regular", later), false);
});

test("trust uses the latest 30 checks before the label, with a 95% threshold", () => {
  // 20 bad checks, then 30 perfect ones. Only the latest 30 count.
  const index = new TrustIndex(results([...Array(20).fill(0), ...Array(30).fill(1)]));
  assert.equal(index.isTrusted(user, "regular", later), true);
  // Before the 21st check, the window is all bad.
  assert.equal(index.isTrusted(user, "regular", new Date(2026, 0, 1, 0, 20)), false);
  assert.equal(new TrustIndex(results(Array(30).fill(0.95))).isTrusted(user, "regular", later), true);
  assert.equal(new TrustIndex(results(Array(30).fill(0.94))).isTrusted(user, "regular", later), false);
});

test("trust is separate for each script class", () => {
  const index = new TrustIndex(results(Array(10).fill(0)));
  assert.equal(index.isTrusted(user, "running", later), true);
});

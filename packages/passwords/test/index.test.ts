import assert from "node:assert/strict";
import { test } from "node:test";

import { passwordProblems } from "../src/index.ts";

test("accepts a password that meets every rule", () => {
  assert.deepEqual(passwordProblems("Correct-horse-7"), []);
});

test("names each rule that a password breaks", () => {
  assert.deepEqual(passwordProblems("Short-7a"), ["at least 12 characters"]);
  assert.deepEqual(passwordProblems("correct-horse-7"), ["an upper-case letter"]);
  assert.deepEqual(passwordProblems("CORRECT-HORSE-7"), ["a lower-case letter"]);
  assert.deepEqual(passwordProblems("Correct-horse-"), ["a number"]);
  assert.deepEqual(passwordProblems("Correcthorse77"), ["a symbol"]);
});

test("lists every problem with an empty password", () => {
  assert.equal(passwordProblems("").length, 5);
});

test("counts characters rather than UTF-16 units", () => {
  assert.deepEqual(passwordProblems("Aa1-😀😀😀😀"), ["at least 12 characters"]);
});

import assert from "node:assert/strict";
import { test } from "node:test";

import { datasetWordToAbkai } from "../src/scripts/import-training.ts";
import { MIN_REAL_IN_WINDOW, summarizeWindow, WINDOW_SIZE } from "../src/training.ts";

const answers = (real: number, synthetic: number, correct = true) => [
  ...Array.from({ length: real }, () => ({ correct, kind: "real" })),
  ...Array.from({ length: synthetic }, () => ({ correct, kind: "synthetic" })),
];

test("a window passes when every answer is correct and enough are real", () => {
  assert.equal(summarizeWindow(answers(MIN_REAL_IN_WINDOW, 10)).passes, true);
});

test("a window needs its full length", () => {
  assert.equal(summarizeWindow(answers(10, 9)).passes, false);
});

test("a window needs enough real images", () => {
  assert.equal(summarizeWindow(answers(MIN_REAL_IN_WINDOW - 1, 11)).passes, false);
});

test("a window fails on one wrong answer", () => {
  const recent = answers(10, 10);
  recent[5] = { correct: false, kind: "real" };
  assert.equal(summarizeWindow(recent).passes, false);
});

test("only the most recent answers count", () => {
  const recent = [...answers(10, 10), { correct: false, kind: "real" }];
  assert.equal(recent.length, WINDOW_SIZE + 1);
  assert.equal(summarizeWindow(recent).passes, true);
});

test("converts the dataset's spelling to Abkai", () => {
  assert.equal(datasetWordToAbkai("cooha"), "qooha");
  assert.equal(datasetWordToAbkai("xun"), "xun");
  assert.equal(datasetWordToAbkai("dzengdzi"), "zengzi");
  assert.equal(datasetWordToAbkai("ts'ai"), "cai");
  assert.equal(datasetWordToAbkai("c'y"), "qy'");
  assert.equal(datasetWordToAbkai("sy"), "sy'");
  assert.equal(datasetWordToAbkai("syan"), "syan");
  assert.equal(datasetWordToAbkai("g'ao"), "g'ao");
  assert.equal(datasetWordToAbkai("jurgan"), "jurgan");
});

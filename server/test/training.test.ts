import assert from "node:assert/strict";
import { test } from "node:test";

import { datasetWordToAbkai } from "../src/scripts/import-training.ts";
import { REAL_STREAK, summarizeAnswers, SYNTHETIC_STREAK } from "../src/training.ts";

/** Answers of one kind, oldest first. */
const answers = (kind: string, count: number, correct = true) =>
  Array.from({ length: count }, () => ({ correct, kind }));
const passFirstStage = () => answers("synthetic", SYNTHETIC_STREAK);

test("generated images in a row pass the first stage", () => {
  const before = summarizeAnswers(answers("synthetic", SYNTHETIC_STREAK - 1), true);
  assert.equal(before.synthetic.passed, false);
  assert.equal(before.synthetic.needed, 1);
  assert.equal(summarizeAnswers(passFirstStage(), true).synthetic.passed, true);
});

test("a wrong generated image restarts the first stage", () => {
  const summary = summarizeAnswers(
    [...answers("synthetic", 9), ...answers("synthetic", 1, false), ...answers("synthetic", 3)],
    true,
  );
  assert.equal(summary.synthetic.passed, false);
  assert.equal(summary.synthetic.needed, SYNTHETIC_STREAK - 3);
});

test("real scans in a row after the first stage qualify", () => {
  const short = summarizeAnswers([...passFirstStage(), ...answers("real", REAL_STREAK - 1)], true);
  assert.equal(short.passes, false);
  assert.equal(short.real.needed, 1);
  assert.equal(summarizeAnswers([...passFirstStage(), ...answers("real", REAL_STREAK)], true).passes, true);
});

test("real scans from before the first stage is passed do not count", () => {
  const summary = summarizeAnswers([...answers("real", REAL_STREAK), ...passFirstStage()], true);
  assert.equal(summary.passes, false);
  assert.deepEqual(summary.real.recent, []);
});

test("a wrong real scan restarts the second stage", () => {
  const summary = summarizeAnswers(
    [...passFirstStage(), ...answers("real", REAL_STREAK - 1), ...answers("real", 1, false)],
    true,
  );
  assert.equal(summary.real.needed, REAL_STREAK);
});

test("practice after the first stage changes nothing", () => {
  const summary = summarizeAnswers(
    [
      ...passFirstStage(),
      ...answers("real", 5),
      ...answers("synthetic", 2, false),
      ...answers("real", REAL_STREAK - 5),
    ],
    true,
  );
  assert.equal(summary.synthetic.passed, true);
  assert.equal(summary.passes, true);
});

test("a class without generated images skips the first stage", () => {
  assert.equal(summarizeAnswers(answers("real", REAL_STREAK), false).passes, true);
});

test("reports each answer in a stage, oldest first", () => {
  const summary = summarizeAnswers(
    [...answers("synthetic", 2), ...answers("synthetic", 1, false), ...answers("synthetic", 1)],
    true,
  );
  assert.deepEqual(summary.synthetic.recent, [true, true, false, true]);
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

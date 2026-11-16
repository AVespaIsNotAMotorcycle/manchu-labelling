import assert from "node:assert/strict";
import { test } from "node:test";

import { datasetWordToAbkai } from "../src/scripts/import-training.ts";
import { STREAK, summarizeAnswers } from "../src/training.ts";

/** Answers of one kind, oldest first. */
const answers = (kind: string, count: number, correct = true) =>
  Array.from({ length: count }, () => ({ correct, kind }));
const ALL = new Set(["synthetic", "printed", "manuscript"]);
const passed = (summary: ReturnType<typeof summarizeAnswers>) => summary.phases.map((phase) => phase.passed);

test("each phase needs its images correct in a row, in order", () => {
  const before = summarizeAnswers(answers("synthetic", STREAK - 1), ALL);
  assert.deepEqual(passed(before), [false, false, false]);
  assert.equal(before.phases[0]?.needed, 1);

  const all = summarizeAnswers(
    [...answers("synthetic", STREAK), ...answers("printed", STREAK), ...answers("manuscript", STREAK)],
    ALL,
  );
  assert.deepEqual(passed(all), [true, true, true]);
  assert.equal(all.passes, true);
});

test("a wrong answer restarts only the current phase", () => {
  const summary = summarizeAnswers(
    [...answers("synthetic", STREAK), ...answers("printed", 5), ...answers("printed", 1, false), ...answers("printed", 2)],
    ALL,
  );
  assert.deepEqual(passed(summary), [true, false, false]);
  assert.equal(summary.phases[1]?.needed, STREAK - 2);
});

test("answers only count towards the phase the user was in", () => {
  // Printed answers before the synthetic phase, and old "real" answers, count for nothing.
  const summary = summarizeAnswers(
    [...answers("printed", STREAK), ...answers("real", STREAK), ...answers("synthetic", STREAK)],
    ALL,
  );
  assert.deepEqual(passed(summary), [true, false, false]);
  assert.deepEqual(summary.phases[1]?.recent, []);
});

test("practice after the synthetic phase changes nothing", () => {
  const summary = summarizeAnswers(
    [
      ...answers("synthetic", STREAK),
      ...answers("printed", 3),
      ...answers("synthetic", 2, false),
      ...answers("printed", STREAK - 3),
    ],
    ALL,
  );
  assert.deepEqual(passed(summary), [true, true, false]);
});

test("a phase without images is passed automatically", () => {
  const summary = summarizeAnswers(answers("printed", STREAK), new Set(["printed"]));
  assert.equal(summary.passes, true);
});

test("reports each answer in a phase, oldest first", () => {
  const summary = summarizeAnswers(
    [...answers("synthetic", 2), ...answers("synthetic", 1, false), ...answers("synthetic", 1)],
    ALL,
  );
  assert.deepEqual(summary.phases[0]?.recent, [true, true, false, true]);
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

test("qualification follows passes, resets, and runs of failed checks", async () => {
  const { replayQualification } = await import("../src/training.ts");
  const at = (minute: number) => new Date(2026, 0, 1, 0, minute);
  const fails = (from: number, count: number) =>
    Array.from({ length: count }, (_, index) => ({ at: at(from + index), type: "check" as const, passed: false }));

  assert.equal(replayQualification([]).qualified, false);
  assert.equal(replayQualification([{ at: at(0), type: "pass" }]).qualified, true);

  const lost = replayQualification([{ at: at(0), type: "pass" }, ...fails(1, 5)]);
  assert.deepEqual(lost, { qualified: false, since: at(5), lostToChecks: true });

  // A pass in the middle breaks the run.
  const kept = replayQualification([
    { at: at(0), type: "pass" },
    ...fails(1, 4),
    { at: at(5), type: "check", passed: true },
    ...fails(6, 4),
  ]);
  assert.equal(kept.qualified, true);

  // Checks before the first pass, or while unqualified, are ignored, and a new pass starts a new run.
  const regained = replayQualification([
    ...fails(0, 5),
    { at: at(10), type: "pass" },
    ...fails(11, 5),
    ...fails(16, 5),
    { at: at(30), type: "pass" },
    ...fails(31, 4),
  ]);
  assert.equal(regained.qualified, true);

  const reset = replayQualification([{ at: at(0), type: "pass" }, { at: at(1), type: "reset" }]);
  assert.deepEqual(reset, { qualified: false, since: at(1), lostToChecks: false });
});

import assert from "node:assert/strict";
import { test } from "node:test";

import { abkaiToManchu } from "@manchu-labelling/script";
import { Types } from "mongoose";

import { MAX_LABELERS, settle } from "../src/consensus.ts";
import { groupReadings } from "../src/label-review.ts";

const reading = (abkai: string, extra: object = {}) => ({
  user: new Types.ObjectId(),
  category: "manchu",
  transcription: { abkai, manchu: abkaiToManchu(abkai).text },
  createdAt: new Date(),
  trusted: true,
  ...extra,
});
const status = (...labels: ReturnType<typeof reading>[]) => settle(labels).status;

test("two matching labels that count settle an image", () => {
  const result = settle([reading("manju"), reading("manju")]);
  assert.equal(result.status, "agreed");
  assert.deepEqual(result.answer, { category: "manchu", manchu: abkaiToManchu("manju").text });
  assert.equal(result.wantsLabel, false);
  assert.equal(status(reading("manju"), reading("manju"), reading("manjv")), "agreed");
});

test("a disagreement, an unsure label, or an unreadable letter asks for a third label", () => {
  for (const second of [
    reading("manjv"),
    reading("manju", { confidence: { transcription: "unconfident" } }),
    reading("manju", { confidence: { category: "unconfident" } }),
  ]) {
    const result = settle([reading("manju"), second]);
    assert.equal(result.status, "pending");
    assert.equal(result.wantsLabel, true);
  }
  assert.equal(status(reading("man?u"), reading("man?u")), "pending");
});

test("three labels that do not settle an image send it to a reviewer", () => {
  const result = settle([reading("manju"), reading("manjv"), reading("monju")]);
  assert.equal(result.status, "needs_review");
  assert.equal(result.wantsLabel, false);
  // Two answers with two labels each is a tie, not an agreement.
  assert.equal(status(reading("a"), reading("a"), reading("e"), reading("e")), "needs_review");
});

test("labels from users who were not trusted do not count", () => {
  const result = settle([reading("manju"), reading("manju", { trusted: false })]);
  assert.equal(result.status, "single");
  assert.equal(result.counted, 1);
  assert.equal(result.labelers, 2);
  const untrusted = Array.from({ length: MAX_LABELERS }, () => reading("manju", { trusted: false }));
  assert.equal(settle(untrusted).wantsLabel, false);
});

test("held-back images need 3 labels even when 2 agree, and a review is final", () => {
  assert.equal(settle([reading("manju"), reading("manju")], { heldBack: true }).wantsLabel, true);
  const reviewed = settle([reading("manju"), reading("manjv"), reading("x")], {
    review: { category: "illegible" },
  });
  assert.equal(reviewed.status, "reviewed");
  assert.deepEqual(reviewed.answer, { category: "illegible" });
});

test("readings are grouped without names, most common first", () => {
  const readings = groupReadings([
    reading("manjv"),
    reading("manju"),
    reading("manju", { confidence: { transcription: "unconfident" } }),
  ]);
  assert.deepEqual(
    readings.map(({ abkai, count, unsure }) => [abkai, count, unsure]),
    [
      ["manju", 2, 1],
      ["manjv", 1, 0],
    ],
  );
  assert.equal("user" in (readings[0] as object), false);
});

test("an agreement only settles 30 minutes after the last label, but stops wanting labels at once", () => {
  const made = new Date(2026, 0, 1, 12, 0);
  const labels = [reading("manju", { createdAt: made }), reading("manju", { createdAt: made })];
  const soon = settle(labels, { now: new Date(2026, 0, 1, 12, 29) });
  assert.equal(soon.status, "agreed");
  assert.equal(soon.wantsLabel, false);
  assert.equal(soon.settled, false);
  assert.equal(soon.quiet, false);
  const later = settle(labels, { now: new Date(2026, 0, 1, 12, 30) });
  assert.equal(later.settled, true);
  assert.equal(later.quiet, true);
  // A word that does not agree never settles on its own.
  assert.equal(settle([reading("manju", { createdAt: made })], { now: new Date(2027, 0, 1) }).settled, false);
});

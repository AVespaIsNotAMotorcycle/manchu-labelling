import { manchuToAbkai } from "@manchu-labelling/script";
import type { Types } from "mongoose";

import type { ParsedAnswer } from "./label-input.ts";
import { Dispute, type DisputeOutcome } from "./models/disputes.ts";
import { KnownLabel, type Category } from "./models/labels.ts";
import { TrainingAttempt, TrainingItem } from "./models/training.ts";
import { visibleCheckResults } from "./profile.ts";

type Id = Types.ObjectId;

export class DisputeError extends Error {}

const stored = (answer: ParsedAnswer) => ({
  category: answer.category,
  ...(answer.transcription ?? {}),
});

const withAbkai = (answer: { category: Category; manchu?: string | null }) => ({
  category: answer.category,
  ...(answer.manchu ? { manchu: answer.manchu, abkai: manchuToAbkai(answer.manchu).text } : {}),
});

/** Opens a dispute on a past check the user can see in their history. */
export async function disputeCheck(user: Id, wordImage: Id, proposed: ParsedAnswer, note?: string) {
  const visible = await visibleCheckResults(user);
  if (!visible.some((result) => result.wordImage.equals(wordImage))) {
    throw new DisputeError("This image is not in your history");
  }
  if (await Dispute.exists({ user, wordImage, resolution: { $exists: false } })) {
    throw new DisputeError("You have already disputed this image");
  }
  const known = await KnownLabel.findOne({ wordImage }).orFail();
  return Dispute.create({
    user,
    kind: "check",
    wordImage,
    answer: withAbkai(known),
    proposed: stored(proposed),
    note,
  });
}

/** Opens a dispute on the answer to a quiz image the user has answered. */
export async function disputeQuiz(user: Id, trainingItem: Id, proposed: ParsedAnswer, note?: string) {
  const [answered, item] = await Promise.all([
    TrainingAttempt.exists({ user, item: trainingItem }),
    TrainingItem.findById(trainingItem),
  ]);
  if (!answered || !item) throw new DisputeError("You have not answered this quiz image");
  if (await Dispute.exists({ user, trainingItem, resolution: { $exists: false } })) {
    throw new DisputeError("You have already disputed this image");
  }
  return Dispute.create({
    user,
    kind: "quiz",
    trainingItem,
    answer: withAbkai(item),
    proposed: stored(proposed),
    note,
  });
}

/**
 * Resolves a dispute once. Upheld changes nothing. Corrected replaces a check's answer, keeping the old
 * one in its history. Withdrawn stops a check grading anyone, or takes a quiz image out of the quiz.
 * Grades are worked out from history, so trust and qualification follow by themselves.
 */
export async function resolveDispute(
  id: Id,
  reviewer: Id,
  outcome: DisputeOutcome,
  options: { answer?: ParsedAnswer; note?: string } = {},
) {
  const dispute = await Dispute.findById(id);
  if (!dispute) throw new DisputeError("Dispute not found");
  if (dispute.resolution) throw new DisputeError("This dispute was already resolved");
  if (dispute.user.equals(reviewer)) throw new DisputeError("You cannot resolve your own dispute");
  if (dispute.kind === "quiz" && outcome === "corrected") {
    throw new DisputeError("Quiz images are withdrawn rather than corrected");
  }
  if (outcome === "corrected" && !options.answer) throw new DisputeError("A correction needs an answer");

  const resolution = {
    outcome,
    reviewer,
    ...(outcome === "corrected" && options.answer ? { answer: stored(options.answer) } : {}),
    ...(options.note ? { note: options.note } : {}),
    at: new Date(),
  };
  const claimed = await Dispute.updateOne({ _id: id, resolution: { $exists: false } }, { $set: { resolution } });
  if (claimed.modifiedCount !== 1) throw new DisputeError("This dispute was already resolved");

  if (dispute.kind === "quiz") {
    if (outcome === "withdrawn") await TrainingItem.updateOne({ _id: dispute.trainingItem }, { active: false });
    return;
  }
  if (outcome === "withdrawn") {
    await KnownLabel.updateOne({ wordImage: dispute.wordImage }, { state: "withdrawn" });
  } else if (outcome === "corrected" && options.answer) {
    const known = await KnownLabel.findOne({ wordImage: dispute.wordImage }).orFail();
    const { category, transcription } = options.answer;
    await KnownLabel.updateOne(
      { _id: known._id },
      {
        // A correction to a category other than Manchu must not keep the old letters.
        ...(transcription
          ? { $set: { category, manchu: transcription.manchu } }
          : { $set: { category }, $unset: { manchu: "" } }),
        $push: {
          history: { category: known.category, manchu: known.manchu, replacedAt: new Date(), dispute: id },
        },
      },
    );
  }
}

import { manchuToAbkai } from "@manchu-labelling/script";
import { Router } from "express";
import { Types } from "mongoose";

import { currentUser, requireLicense, requireUser } from "../auth.ts";
import { DisputeError, disputeCheck, disputeQuiz } from "../disputes.ts";
import { parseAnswer } from "../label-input.ts";
import { WordImage } from "../models/crops.ts";
import { Dispute } from "../models/disputes.ts";
import { Annotation, KnownLabel } from "../models/labels.ts";
import { TrainingItem } from "../models/training.ts";
import { accuracyByClass, visibleCheckResults } from "../profile.ts";

export const profileRouter = Router();
profileRouter.use(requireUser, requireLicense);

const imageUrl = (key: string) => `/api/images/${key}`;
const withAbkai = (manchu?: string | null) => (manchu ? { manchu, abkai: manchuToAbkai(manchu).text } : {});

/** The past checks a user may see, after the delay, and their accuracy on them. */
profileRouter.get("/", async (_request, response) => {
  const user = currentUser(response)._id;
  const results = await visibleCheckResults(user);
  const shown = [...results].reverse().slice(0, 200);
  const imageIds = shown.map(({ wordImage }) => wordImage);
  const [images, labels, known, disputes] = await Promise.all([
    WordImage.find({ _id: { $in: imageIds } }, "imageKey").lean(),
    Annotation.find({ _id: { $in: shown.map(({ label }) => label) } }, "category transcription").lean(),
    KnownLabel.find({ wordImage: { $in: imageIds } }, "wordImage category manchu").lean(),
    Dispute.find({ user }).sort({ createdAt: -1 }).lean(),
  ]);
  const keyOf = new Map(images.map(({ _id, imageKey }) => [String(_id), imageKey]));
  const labelOf = new Map(labels.map((label) => [String(label._id), label]));
  const answerOf = new Map(known.map((answer) => [String(answer.wordImage), answer]));
  const latestDispute = new Map<string, (typeof disputes)[number]>();
  for (const dispute of disputes) {
    const target = String(dispute.wordImage ?? dispute.trainingItem);
    if (!latestDispute.has(target)) latestDispute.set(target, dispute);
  }
  const status = (target: string) => {
    const dispute = latestDispute.get(target);
    return dispute ? (dispute.resolution?.outcome ?? "open") : null;
  };

  const quizItems = await TrainingItem.find(
    { _id: { $in: disputes.flatMap(({ trainingItem }) => (trainingItem ? [trainingItem] : [])) } },
    "imageKey",
  ).lean();
  const quizKeyOf = new Map(quizItems.map(({ _id, imageKey }) => [String(_id), imageKey]));

  response.json({
    accuracy: accuracyByClass(results),
    checks: shown.map(({ wordImage, scriptClass, passed, accuracy, label }) => {
      const given = labelOf.get(String(label));
      const answer = answerOf.get(String(wordImage));
      return {
        id: String(wordImage),
        imageUrl: imageUrl(keyOf.get(String(wordImage)) ?? ""),
        scriptClass,
        passed,
        accuracy,
        label: { category: given?.category, ...withAbkai(given?.transcription?.manchu) },
        answer: { category: answer?.category, ...withAbkai(answer?.manchu) },
        dispute: status(String(wordImage)),
      };
    }),
    disputes: disputes.map((dispute) => ({
      id: String(dispute._id),
      kind: dispute.kind,
      imageUrl: imageUrl(
        dispute.kind === "check"
          ? (keyOf.get(String(dispute.wordImage)) ?? "")
          : (quizKeyOf.get(String(dispute.trainingItem)) ?? ""),
      ),
      createdAt: dispute.createdAt,
      answer: dispute.answer,
      proposed: dispute.proposed,
      note: dispute.note,
      outcome: dispute.resolution?.outcome ?? "open",
      reviewerNote: dispute.resolution?.note,
    })),
  });
});

/** Disputes the answer to a past check in the user's history, or to a quiz image they answered. */
profileRouter.post("/disputes", async (request, response) => {
  const { kind, id, note } = request.body ?? {};
  const proposed = parseAnswer(request.body);
  if (
    (kind !== "check" && kind !== "quiz") ||
    !Types.ObjectId.isValid(id) ||
    !proposed ||
    (note !== undefined && (typeof note !== "string" || note.length > 2000))
  ) {
    response.status(400).json({ error: "This dispute is not valid" });
    return;
  }
  const user = currentUser(response)._id;
  const target = new Types.ObjectId(id as string);
  const text = note?.trim() || undefined;
  try {
    if (kind === "check") await disputeCheck(user, target, proposed, text);
    else await disputeQuiz(user, target, proposed, text);
  } catch (error) {
    if (!(error instanceof DisputeError)) throw error;
    response.status(409).json({ error: error.message });
    return;
  }
  response.status(201).end();
});

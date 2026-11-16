import { manchuToAbkai } from "@manchu-labelling/script";
import { Router } from "express";
import { Types } from "mongoose";

import { checkResults } from "../checks.ts";
import { currentUser, requireReviewer, requireUser } from "../auth.ts";
import { DisputeError, resolveDispute } from "../disputes.ts";
import { agreementsToReview, reviewAgreement, undoableDecisions, undoDecision } from "../held-back.ts";
import { parseAnswer } from "../label-input.ts";
import { imagesForReview, ReviewError, reviewLabels } from "../label-review.ts";
import { WordImage } from "../models/crops.ts";
import { Dispute, DISPUTE_OUTCOMES, type DisputeOutcome } from "../models/disputes.ts";
import { Page } from "../models/sources.ts";
import { TrainingItem } from "../models/training.ts";

export const reviewRouter = Router();
reviewRouter.use(requireUser, requireReviewer);

const imageUrl = (key: string) => `/api/images/${key}`;

/** The crops and pages for some images, to show each with its place on the page. */
async function imageContexts(ids: readonly Types.ObjectId[]) {
  const crops = await WordImage.find({ _id: { $in: ids } }).lean();
  const pages = await Page.find({ _id: { $in: crops.map(({ page }) => page) } }).lean();
  const pageById = new Map(pages.map((page) => [String(page._id), page]));
  return new Map(
    crops.map((crop) => {
      const page = pageById.get(String(crop.page));
      if (!page) throw new Error(`Missing page for ${crop._id}`);
      return [
        String(crop._id),
        {
          imageUrl: imageUrl(crop.imageKey),
          context: {
            pageImageUrl: imageUrl(page.imageKey),
            width: page.width,
            height: page.height,
            box: crop.box,
          },
        },
      ];
    }),
  );
}

/** Open disputes, oldest first. */
reviewRouter.get("/disputes", async (_request, response) => {
  const disputes = await Dispute.find({ resolution: { $exists: false } })
    .sort({ createdAt: 1 })
    .limit(50)
    .lean();
  const checkImages = disputes.flatMap(({ wordImage }) => (wordImage ? [wordImage] : []));
  const [contexts, items, results] = await Promise.all([
    imageContexts(checkImages),
    TrainingItem.find({ _id: { $in: disputes.map(({ trainingItem }) => trainingItem) } }).lean(),
    checkResults(),
  ]);
  const itemById = new Map(items.map((item) => [String(item._id), item]));
  response.json({
    items: disputes.map((dispute) => {
      const base = {
        id: String(dispute._id),
        kind: dispute.kind,
        answer: dispute.answer,
        proposed: dispute.proposed,
        note: dispute.note,
        createdAt: dispute.createdAt,
      };
      if (dispute.kind === "quiz") {
        const item = itemById.get(String(dispute.trainingItem));
        return { ...base, imageUrl: imageUrl(item?.imageKey ?? ""), source: item?.source };
      }
      const graded = results.filter(({ wordImage }) => wordImage.equals(dispute.wordImage));
      return {
        ...base,
        ...contexts.get(String(dispute.wordImage)),
        graded: { total: graded.length, passed: graded.filter(({ passed }) => passed).length },
      };
    }),
  });
});

reviewRouter.post("/disputes/:id", async (request, response) => {
  const { outcome, note } = request.body ?? {};
  const answer = outcome === "corrected" ? parseAnswer(request.body) : undefined;
  if (
    !Types.ObjectId.isValid(request.params.id) ||
    !DISPUTE_OUTCOMES.includes(outcome) ||
    answer === null ||
    (note !== undefined && (typeof note !== "string" || note.length > 2000))
  ) {
    response.status(400).json({ error: "This decision is not valid" });
    return;
  }
  try {
    await resolveDispute(
      new Types.ObjectId(request.params.id),
      currentUser(response)._id,
      outcome as DisputeOutcome,
      { answer, note: note?.trim() || undefined },
    );
  } catch (error) {
    if (!(error instanceof DisputeError)) throw error;
    response.status(409).json({ error: error.message });
    return;
  }
  response.status(204).end();
});

/** Held-back images whose labelers agree, for a reviewer to confirm as hidden checks. */
reviewRouter.get("/held-back", async (_request, response) => {
  const agreements = await agreementsToReview();
  const contexts = await imageContexts(agreements.map(({ wordImage }) => wordImage));
  response.json({
    items: agreements.map(({ wordImage, category, manchu, labelers }) => {
      const context = contexts.get(String(wordImage));
      if (!context) throw new Error(`Missing crop for ${wordImage}`);
      return {
        id: String(wordImage),
        ...context,
        category,
        manchu,
        abkai: manchu ? manchuToAbkai(manchu).text : undefined,
        labelers: labelers.length,
      };
    }),
  });
});

reviewRouter.post("/held-back/:id", async (request, response) => {
  const { decision, category, manchu } = request.body ?? {};
  if (
    !Types.ObjectId.isValid(request.params.id) ||
    (decision !== "yes" && decision !== "no") ||
    typeof category !== "string" ||
    (manchu !== undefined && typeof manchu !== "string")
  ) {
    response.status(400).json({ error: "This decision is not valid" });
    return;
  }
  try {
    await reviewAgreement(new Types.ObjectId(request.params.id), currentUser(response)._id, decision, {
      category,
      manchu,
    });
  } catch (error) {
    response.status(409).json({ error: (error as Error).message });
    return;
  }
  response.status(204).end();
});

/** Recent decisions on held-back answers, newest first, so that a mistake can be undone. */
reviewRouter.get("/held-back-decisions", async (_request, response) => {
  const decisions = await undoableDecisions();
  const contexts = await imageContexts(decisions.map(({ wordImage }) => wordImage));
  response.json({
    items: decisions.map(({ wordImage, decision, category, manchu, createdAt }) => ({
      id: String(wordImage),
      imageUrl: contexts.get(String(wordImage))?.imageUrl,
      decision,
      category,
      manchu,
      abkai: manchu ? manchuToAbkai(manchu).text : undefined,
      decidedAt: createdAt,
    })),
  });
});

reviewRouter.post("/held-back/:id/undo", async (request, response) => {
  if (!Types.ObjectId.isValid(request.params.id)) {
    response.status(400).json({ error: "This image is not valid" });
    return;
  }
  try {
    await undoDecision(new Types.ObjectId(request.params.id), currentUser(response)._id);
  } catch (error) {
    response.status(409).json({ error: (error as Error).message });
    return;
  }
  response.status(204).end();
});

/** Images whose labels did not settle them, with the readings given, for a reviewer to decide. */
reviewRouter.get("/labels", async (_request, response) => {
  const images = await imagesForReview(currentUser(response)._id);
  const contexts = await imageContexts(images.map(({ wordImage }) => wordImage));
  response.json({
    items: images.map(({ wordImage, readings }) => ({
      id: String(wordImage),
      ...contexts.get(String(wordImage)),
      readings,
    })),
  });
});

reviewRouter.post("/labels/:id", async (request, response) => {
  const answer = parseAnswer(request.body);
  if (!Types.ObjectId.isValid(request.params.id) || !answer) {
    response.status(400).json({ error: "This answer is not valid" });
    return;
  }
  try {
    await reviewLabels(new Types.ObjectId(request.params.id), currentUser(response)._id, answer);
  } catch (error) {
    if (!(error instanceof ReviewError)) throw error;
    response.status(409).json({ error: error.message });
    return;
  }
  response.status(204).end();
});

import { manchuToAbkai } from "@manchu-labelling/script";
import { Router } from "express";
import { Types } from "mongoose";

import { currentUser, requireAdmin, requireUser } from "../auth.ts";
import { ruleOnReview } from "../crop-reviews.ts";
import { agreementsToReview, reviewAgreement } from "../held-back.ts";
import { CropReview, WordImage } from "../models/crops.ts";
import { Page } from "../models/sources.ts";

export const adminRouter = Router();
adminRouter.use(requireUser, requireAdmin);

adminRouter.get("/crop-reviews", async (_request, response) => {
  const reviews = await CropReview.find({ status: "open" }).sort({ createdAt: 1 }).limit(50).lean();
  const cropIds = reviews.flatMap(({ crops }) => crops);
  const crops = await WordImage.find({ _id: { $in: cropIds } }, "imageKey").lean();
  const keys = new Map(crops.map(({ _id, imageKey }) => [String(_id), imageKey]));
  response.json({
    reviews: reviews.map((review) => ({
      id: String(review._id),
      reason: review.reason,
      crops: review.crops.map((crop) => ({
        id: String(crop),
        imageUrl: `/api/images/${keys.get(String(crop))}`,
      })),
    })),
  });
});

adminRouter.post("/crop-reviews/:id/ruling", async (request, response) => {
  const { chosenCrop } = request.body ?? {};
  if (!Types.ObjectId.isValid(request.params.id) || !Types.ObjectId.isValid(chosenCrop)) {
    response.status(400).json({ error: "This ruling is not valid" });
    return;
  }
  try {
    await ruleOnReview(
      new Types.ObjectId(request.params.id),
      new Types.ObjectId(chosenCrop),
      currentUser(response)._id,
    );
  } catch (error) {
    response.status(409).json({ error: (error as Error).message });
    return;
  }
  response.status(204).end();
});

/** Held-back images whose labelers agree, for an admin to confirm as hidden checks. */
adminRouter.get("/held-back", async (_request, response) => {
  const agreements = await agreementsToReview();
  const crops = await WordImage.find({ _id: { $in: agreements.map(({ wordImage }) => wordImage) } }).lean();
  const pages = await Page.find({ _id: { $in: crops.map(({ page }) => page) } }).lean();
  const cropById = new Map(crops.map((crop) => [String(crop._id), crop]));
  const pageById = new Map(pages.map((page) => [String(page._id), page]));
  response.json({
    items: agreements.map(({ wordImage, category, manchu, labelers }) => {
      const crop = cropById.get(String(wordImage));
      const page = pageById.get(String(crop?.page));
      if (!crop || !page) throw new Error(`Missing crop or page for ${wordImage}`);
      return {
        id: String(wordImage),
        imageUrl: `/api/images/${crop.imageKey}`,
        context: {
          pageImageUrl: `/api/images/${page.imageKey}`,
          width: page.width,
          height: page.height,
          box: crop.box,
        },
        category,
        manchu,
        abkai: manchu ? manchuToAbkai(manchu).text : undefined,
        labelers: labelers.length,
      };
    }),
  });
});

adminRouter.post("/held-back/:id", async (request, response) => {
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

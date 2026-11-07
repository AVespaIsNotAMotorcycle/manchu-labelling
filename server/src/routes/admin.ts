import { Router } from "express";
import { Types } from "mongoose";

import { currentUser, requireAdmin, requireUser } from "../auth.ts";
import { ruleOnReview } from "../crop-reviews.ts";
import { CropReview, WordImage } from "../models/crops.ts";

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

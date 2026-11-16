import { Router } from "express";
import { Types } from "mongoose";

import { currentUser, requireAdmin, requireUser } from "../auth.ts";
import { AccountError, createInvite, inviteUrl } from "../accounts.ts";
import type { Status } from "../consensus.ts";
import { ruleOnReview } from "../crop-reviews.ts";
import { labelledImages } from "../labelled.ts";
import { CropReview, WordImage } from "../models/crops.ts";
import { Invite, ROLES } from "../models/users.ts";

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

/** Makes an invite link. Only the link's hash is kept, so the link is shown once. */
adminRouter.post("/invites", async (request, response) => {
  const { email, role, note } = request.body ?? {};
  if (
    (email !== undefined && email !== "" && typeof email !== "string") ||
    (role !== undefined && !ROLES.includes(role)) ||
    (note !== undefined && (typeof note !== "string" || note.length > 200))
  ) {
    response.status(400).json({ error: "This invite is not valid" });
    return;
  }
  try {
    const { token, invite } = await createInvite({
      createdBy: currentUser(response)._id,
      email: email || undefined,
      role,
      note: note?.trim() || undefined,
    });
    const origin = request.app.locals.origin ?? `${request.protocol}://${request.get("Host")}`;
    response.status(201).json({ url: inviteUrl(origin, token), expiresAt: invite.expiresAt });
  } catch (error) {
    if (!(error instanceof AccountError)) throw error;
    response.status(400).json({ error: error.message });
  }
});

/** Recent invites and whether they were used, without their links. */
adminRouter.get("/invites", async (_request, response) => {
  const invites = await Invite.find().sort({ createdAt: -1 }).limit(50).lean();
  const now = new Date();
  response.json({
    items: invites.map((invite) => ({
      id: String(invite._id),
      email: invite.email,
      role: invite.role,
      note: invite.note,
      createdAt: invite.createdAt,
      expiresAt: invite.expiresAt,
      status: invite.usedAt ? "used" : invite.expiresAt <= now ? "expired" : "open",
    })),
  });
});

/** Withdraws an invite that has not been used. */
adminRouter.delete("/invites/:id", async (request, response) => {
  if (!Types.ObjectId.isValid(request.params.id)) {
    response.status(404).end();
    return;
  }
  await Invite.updateOne({ _id: request.params.id, usedAt: { $exists: false } }, { expiresAt: new Date() });
  response.status(204).end();
});

const STATUSES = ["unlabelled", "single", "pending", "agreed", "needs_review", "reviewed"];

/** Labelled images not yet in any release, with their labels, newest first. */
adminRouter.get("/labelled", async (request, response) => {
  const status = typeof request.query.status === "string" && request.query.status ? request.query.status : undefined;
  const page = Number(request.query.page ?? 0);
  if ((status && !STATUSES.includes(status)) || !Number.isInteger(page) || page < 0) {
    response.status(400).json({ error: "This filter is not valid" });
    return;
  }
  response.json(await labelledImages({ status: status as Status | undefined, page }));
});

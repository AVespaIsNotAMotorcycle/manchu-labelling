import { CONVERTER_VERSION } from "@manchu-labelling/script";
import { Router, type Response } from "express";
import { Types } from "mongoose";

import { currentUser, requireLicense, requireUser } from "../auth.ts";
import { parseText } from "../label-input.ts";
import { WordImage } from "../models/crops.ts";
import { Annotation, Assignment, CATEGORIES } from "../models/labels.ts";
import { Page, Volume, PRODUCTION_TYPES, SCRIPT_TYPES } from "../models/sources.ts";
import { scriptClassOfImages } from "../checks.ts";
import { pickNextImage } from "../queue.ts";
import { qualifiedClasses } from "../training.ts";

export const labellingRouter = Router();
labellingRouter.use(requireUser, requireLicense);

const imageUrl = (key: string) => `/api/images/${key}`;

/**
 * Builds what a labeler sees. This must look the same for every image, whether or not it is a hidden
 * check, so it must never read from `knownLabels`.
 */
async function describeImage(id: Types.ObjectId) {
  const image = await WordImage.findById(id).orFail();
  const page = await Page.findById(image.page).orFail();
  const volume = await Volume.findById(page.volume).orFail();
  return {
    id: String(image._id),
    imageUrl: imageUrl(image.imageKey),
    style: { production: volume.production, script: volume.script },
  };
}

async function findAssignment(user: Types.ObjectId, wordImage: string, response: Response) {
  if (!Types.ObjectId.isValid(wordImage)) {
    response.status(404).json({ error: "Image not found" });
    return null;
  }
  const assignment = await Assignment.findOne({ user, wordImage });
  if (!assignment) response.status(404).json({ error: "Image not found" });
  return assignment;
}

/**
 * The user's unlabelled images in classes they can still label, oldest first. An image waiting from a
 * class the user can no longer label stays assigned for when they requalify.
 */
async function openAssignments(user: Types.ObjectId, scriptClasses: readonly string[]) {
  const waiting = await Assignment.find({ user, submittedAt: null }).sort({ assignedAt: 1, _id: 1 });
  const classOf = await scriptClassOfImages(waiting.map(({ wordImage }) => wordImage));
  return waiting.filter(({ wordImage }) => scriptClasses.includes(classOf.get(String(wordImage)) ?? ""));
}

/**
 * Hands out the image at `position` in the user's open images: 0 for the one to label now, 1 for the one
 * after, which the client loads in advance so that there is no wait between images. A user never has more
 * than these two open.
 */
async function handOut(response: Response, position: 0 | 1) {
  const user = currentUser(response)._id;
  const scriptClasses = await qualifiedClasses(user);
  if (scriptClasses.length === 0) {
    response.status(403).json({ error: "Please complete training first" });
    return;
  }
  const open = await openAssignments(user, scriptClasses);
  if (position === 1 && open.length === 0) {
    response.json({ image: null });
    return;
  }
  const existing = open[position];
  const wordImage = existing?.wordImage ?? (await pickNextImage(user, scriptClasses));
  if (!wordImage) {
    response.json({ image: null });
    return;
  }
  if (!existing) await Assignment.create({ user, wordImage });
  response.json({ image: await describeImage(wordImage) });
}

labellingRouter.get("/next", (_request, response) => handOut(response, 0));
labellingRouter.get("/upcoming", (_request, response) => handOut(response, 1));

labellingRouter.get("/:id/context", async (request, response) => {
  const assignment = await findAssignment(currentUser(response)._id, request.params.id, response);
  if (!assignment) return;
  const image = await WordImage.findById(assignment.wordImage).orFail();
  const page = await Page.findById(image.page).orFail();
  response.json({
    pageImageUrl: imageUrl(page.imageKey),
    width: page.width,
    height: page.height,
    box: image.box,
  });
});

const isOneOf = (values: readonly string[], value: unknown): boolean =>
  value === undefined || (typeof value === "string" && values.includes(value));

labellingRouter.post("/:id", async (request, response) => {
  const user = currentUser(response)._id;
  const assignment = await findAssignment(user, request.params.id, response);
  if (!assignment) return;
  if (assignment.submittedAt) {
    response.status(409).json({ error: "This image was already labelled" });
    return;
  }

  const { category, transcription, intendedWord, production, script, confidence } = request.body ?? {};
  const isManchu = category === "manchu";
  const parsedTranscription = isManchu ? parseText(transcription) : null;
  const parsedIntended = isManchu ? parseText(intendedWord) : null;
  const confidenceValues = ["confident", "unconfident"];
  const validConfidence = ["category", "transcription", "style"].every((field) =>
    isOneOf(confidenceValues, confidence?.[field]),
  );
  if (
    !CATEGORIES.includes(category) ||
    parsedTranscription === "invalid" ||
    parsedIntended === "invalid" ||
    (isManchu && !parsedTranscription) ||
    !isOneOf(PRODUCTION_TYPES, production) ||
    !isOneOf(SCRIPT_TYPES, script) ||
    !validConfidence
  ) {
    response.status(400).json({ error: "This label is not valid" });
    return;
  }

  await Annotation.create({
    wordImage: assignment.wordImage,
    user,
    category,
    ...(parsedTranscription ? { transcription: parsedTranscription } : {}),
    ...(parsedIntended ? { intendedWord: parsedIntended } : {}),
    production,
    script,
    confidence: {
      category: confidence?.category,
      transcription: confidence?.transcription,
      style: confidence?.style,
    },
    converterVersion: CONVERTER_VERSION,
  });
  assignment.submittedAt = new Date();
  await assignment.save();
  response.status(201).end();
});

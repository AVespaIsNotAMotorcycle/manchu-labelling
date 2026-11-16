import { CONVERTER_VERSION } from "@manchu-labelling/script";
import { Router, type Response } from "express";
import { Types } from "mongoose";

import { currentUser, requireLicense, requireUser } from "../auth.ts";
import { parseText } from "../label-input.ts";
import { WordImage } from "../models/crops.ts";
import { Annotation, Assignment, CATEGORIES, type Category } from "../models/labels.ts";
import { Page, Volume, PRODUCTION_TYPES, SCRIPT_TYPES } from "../models/sources.ts";
import { scriptClassOfImages } from "../checks.ts";
import { UNDO_WINDOW_MS } from "../consensus.ts";
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

type Confidence = "confident" | "unconfident" | undefined;

/** Reads a label from a request body, or returns null if it is not valid. */
function parseLabel(body: unknown) {
  const { category, transcription, intendedWord, production, script, confidence } = (body ?? {}) as {
    category?: unknown;
    transcription?: unknown;
    intendedWord?: unknown;
    production?: unknown;
    script?: unknown;
    confidence?: Record<string, unknown> | null;
  };
  const isManchu = category === "manchu";
  const parsedTranscription = isManchu ? parseText(transcription) : null;
  const parsedIntended = isManchu ? parseText(intendedWord) : null;
  const confidenceValues = ["confident", "unconfident"];
  const validConfidence = ["category", "transcription", "style"].every((field) =>
    isOneOf(confidenceValues, confidence?.[field]),
  );
  if (
    !CATEGORIES.includes(category as Category) ||
    parsedTranscription === "invalid" ||
    parsedIntended === "invalid" ||
    (isManchu && !parsedTranscription) ||
    !isOneOf(PRODUCTION_TYPES, production) ||
    !isOneOf(SCRIPT_TYPES, script) ||
    !validConfidence
  ) {
    return null;
  }
  const text = (value: unknown) => (typeof value === "string" ? value : undefined);
  return {
    category: category as Category,
    ...(parsedTranscription ? { transcription: parsedTranscription } : {}),
    ...(parsedIntended ? { intendedWord: parsedIntended } : {}),
    production: text(production) as (typeof PRODUCTION_TYPES)[number] | undefined,
    script: text(script) as (typeof SCRIPT_TYPES)[number] | undefined,
    confidence: {
      category: text(confidence?.category) as Confidence,
      transcription: text(confidence?.transcription) as Confidence,
      style: text(confidence?.style) as Confidence,
    },
    converterVersion: CONVERTER_VERSION,
  };
}

labellingRouter.post("/:id", async (request, response) => {
  const user = currentUser(response)._id;
  const assignment = await findAssignment(user, request.params.id, response);
  if (!assignment) return;
  if (assignment.submittedAt) {
    response.status(409).json({ error: "This image was already labelled" });
    return;
  }
  const label = parseLabel(request.body);
  if (!label) {
    response.status(400).json({ error: "This label is not valid" });
    return;
  }
  await Annotation.create({ wordImage: assignment.wordImage, user, ...label });
  assignment.submittedAt = new Date();
  await assignment.save();
  response.status(201).end();
});

/** The user's latest label, if they can still change it: it must be less than 30 minutes old. */
async function changeableLabel(user: Types.ObjectId) {
  const latest = await Annotation.findOne({ user }).sort({ createdAt: -1, _id: -1 });
  if (!latest || Date.now() - latest.createdAt.getTime() >= UNDO_WINDOW_MS) return null;
  return latest;
}

/** The user's last answer, with its image, while they can still change it. */
labellingRouter.get("/last", async (_request, response) => {
  const latest = await changeableLabel(currentUser(response)._id);
  if (!latest) {
    response.json({ last: null });
    return;
  }
  response.json({
    last: {
      image: await describeImage(latest.wordImage),
      label: {
        category: latest.category,
        transcription: latest.transcription?.abkai,
        intendedWord: latest.intendedWord?.abkai,
        production: latest.production,
        script: latest.script,
        confidence: latest.confidence,
      },
      changeableUntil: new Date(latest.createdAt.getTime() + UNDO_WINDOW_MS),
    },
  });
});

/**
 * Changes the user's last answer within 30 minutes of giving it. The old label is kept, and the new one
 * points to it, as with every correction. Only the latest answer can change, so that a user cannot go
 * back over their history.
 */
labellingRouter.post("/:id/change", async (request, response) => {
  const user = currentUser(response)._id;
  const latest = await changeableLabel(user);
  if (!latest || String(latest.wordImage) !== request.params.id) {
    response.status(409).json({ error: "Only your last answer can be changed, within 30 minutes" });
    return;
  }
  const label = parseLabel(request.body);
  if (!label) {
    response.status(400).json({ error: "This label is not valid" });
    return;
  }
  await Annotation.create({ wordImage: latest.wordImage, user, supersedes: latest._id, ...label });
  response.status(201).end();
});

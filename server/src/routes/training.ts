import { manchuToMollendorff } from "@manchu-labelling/script";
import { Router } from "express";

import { currentUser, requireLicense, requireUser } from "../auth.ts";
import { parseText } from "../label-input.ts";
import { CATEGORIES } from "../models/labels.ts";
import { isScriptClass, type ScriptClass } from "../models/sources.ts";
import { TrainingItem } from "../models/training.ts";
import {
  currentItem,
  getProgress,
  qualifiedClasses,
  recordAnswer,
  resetQuiz,
  type Mode,
} from "../training.ts";

export const trainingRouter = Router();
trainingRouter.use(requireUser, requireLicense);

/** Lists the classes that have images, and the user's progress in each. */
trainingRouter.get("/status", async (_request, response) => {
  const user = currentUser(response)._id;
  const available: ScriptClass[] = await TrainingItem.distinct("scriptClass", {
    active: { $ne: false },
  });
  const classes = await Promise.all(
    available.map(async (scriptClass) => ({
      scriptClass,
      progress: await getProgress(user, scriptClass),
    })),
  );
  response.json({ classes, qualified: await qualifiedClasses(user) });
});

const MODES: [string, Mode][] = [
  ["", "quiz"],
  ["/practice", "practice"],
];

for (const [path, mode] of MODES) {
  trainingRouter.get(`/:scriptClass${path}/next`, async (request, response) => {
    const { scriptClass } = request.params;
    if (!isScriptClass(scriptClass)) {
      response.status(404).json({ error: "Unknown script class" });
      return;
    }
    const user = currentUser(response)._id;
    const current = await currentItem(user, scriptClass, mode);
    if ("locked" in current) {
      response.status(409).json({ error: "Finish the generated images first" });
      return;
    }
    const { item } = current;
    response.json({
      // The answer must only ever be sent after the user has answered.
      item: item && { id: String(item._id), imageUrl: `/api/images/${item.imageKey}` },
      progress: await getProgress(user, scriptClass),
    });
  });

  trainingRouter.post(`/:scriptClass${path}/answer`, async (request, response) => {
    const { scriptClass } = request.params;
    const { category, transcription } = request.body ?? {};
    const parsed = category === "manchu" ? parseText(transcription) : null;
    if (
      !isScriptClass(scriptClass) ||
      !CATEGORIES.includes(category) ||
      parsed === "invalid" ||
      (category === "manchu" && !parsed)
    ) {
      response.status(400).json({ error: "This answer is not valid" });
      return;
    }

    const result = await recordAnswer(currentUser(response)._id, scriptClass, mode, {
      category,
      ...(parsed ? parsed : {}),
    });
    if (!result) {
      response.status(409).json({ error: "There is no image waiting for an answer" });
      return;
    }

    const { correct, item, progress } = result;
    response.json({
      correct,
      answer: {
        category: item.category,
        manchu: item.manchu,
        abkai: item.abkai,
        mollendorff: item.manchu ? manchuToMollendorff(item.manchu).text : undefined,
      },
      source: item.source,
      progress,
    });
  });
}

/** Starts the quiz for a class again, at the user's request. */
trainingRouter.post("/:scriptClass/reset", async (request, response) => {
  const { scriptClass } = request.params;
  if (!isScriptClass(scriptClass)) {
    response.status(404).json({ error: "Unknown script class" });
    return;
  }
  const user = currentUser(response)._id;
  if (!(await resetQuiz(user, scriptClass))) {
    response.status(409).json({ error: "There is no progress to reset" });
    return;
  }
  response.json({ progress: await getProgress(user, scriptClass) });
});

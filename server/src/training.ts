import type { Types } from "mongoose";

import type { Category } from "./models/labels.ts";
import type { ScriptClass } from "./models/sources.ts";
import { Qualification, TrainingAttempt, TrainingItem, TrainingState } from "./models/training.ts";

type Id = Types.ObjectId;

/** The rolling window of answers that must all be correct. */
export const WINDOW_SIZE = 20;
/** Real images in the window. Synthetic images are easier, so they cannot carry a user alone. */
export const MIN_REAL_IN_WINDOW = 10;
/** Share of images that are not Manchu, so that the category question stays meaningful. */
const NON_MANCHU_SHARE = 0.1;
/** Share of the remaining images that are synthetic, when the window has enough real ones. */
const SYNTHETIC_SHARE = 0.4;

export interface Progress {
  answered: number;
  correct: number;
  real: number;
  windowSize: number;
  minReal: number;
  qualified: boolean;
}

interface Recent {
  correct: boolean;
  kind: string;
}

/** Works out whether the most recent answers qualify, most recent first. */
export function summarizeWindow(recent: readonly Recent[]): Omit<Progress, "qualified"> & { passes: boolean } {
  const window = recent.slice(0, WINDOW_SIZE);
  const correct = window.filter((attempt) => attempt.correct).length;
  const real = window.filter((attempt) => attempt.kind === "real").length;
  return {
    answered: window.length,
    correct,
    real,
    windowSize: WINDOW_SIZE,
    minReal: MIN_REAL_IN_WINDOW,
    passes: correct === WINDOW_SIZE && real >= MIN_REAL_IN_WINDOW,
  };
}

function recentAttempts(user: Id, scriptClass: ScriptClass) {
  return TrainingAttempt.find({ user, scriptClass }, "correct kind item")
    .sort({ createdAt: -1, _id: -1 })
    .limit(WINDOW_SIZE)
    .lean();
}

export async function getProgress(user: Id, scriptClass: ScriptClass): Promise<Progress> {
  const [recent, qualification] = await Promise.all([
    recentAttempts(user, scriptClass),
    Qualification.exists({ user, scriptClass }),
  ]);
  const { passes: _passes, ...summary } = summarizeWindow(recent);
  return { ...summary, qualified: Boolean(qualification) };
}

/** Script classes the user may label. */
export async function qualifiedClasses(user: Id): Promise<ScriptClass[]> {
  return Qualification.distinct("scriptClass", { user });
}

async function sampleItem(match: object): Promise<Id | null> {
  const [item] = await TrainingItem.aggregate<{ _id: Id }>([
    { $match: match },
    { $sample: { size: 1 } },
    { $project: { _id: 1 } },
  ]);
  return item?._id ?? null;
}

/**
 * Chooses a quiz image the user has not answered. The choice is only forced to be real when the window
 * could not otherwise reach its minimum. Once every image has been answered, repeats are allowed.
 */
async function chooseItem(user: Id, scriptClass: ScriptClass, random = Math.random): Promise<Id | null> {
  const recent = await recentAttempts(user, scriptClass);
  const nextWindow = recent.slice(0, WINDOW_SIZE - 1);
  const realInWindow = nextWindow.filter(({ kind }) => kind === "real").length;
  const slotsLeft = WINDOW_SIZE - nextWindow.length;
  const needsReal = MIN_REAL_IN_WINDOW - realInWindow >= slotsLeft;

  const answered = await TrainingAttempt.distinct("item", { user, scriptClass });
  const unseen = { _id: { $nin: answered }, scriptClass, active: { $ne: false } };

  const roll = random();
  const preferred = (() => {
    if (roll < NON_MANCHU_SHARE) return { kind: "real", category: { $ne: "manchu" } };
    const useSynthetic = !needsReal && roll < NON_MANCHU_SHARE + (1 - NON_MANCHU_SHARE) * SYNTHETIC_SHARE;
    return useSynthetic ? { kind: "synthetic" } : { kind: "real", category: "manchu" };
  })();

  return (
    (await sampleItem({ ...unseen, ...preferred })) ??
    (await sampleItem({ ...unseen, ...(needsReal ? { kind: "real" } : {}) })) ??
    (await sampleItem({ scriptClass, active: { $ne: false }, ...(needsReal ? { kind: "real" } : {}) }))
  );
}

/** Returns the image the user must answer, choosing one if needed. */
export async function currentItem(user: Id, scriptClass: ScriptClass) {
  const state = await TrainingState.findOne({ user, scriptClass });
  const itemId = state?.currentItem ?? (await chooseItem(user, scriptClass));
  if (!itemId) return null;
  if (!state?.currentItem) {
    await TrainingState.updateOne({ user, scriptClass }, { currentItem: itemId }, { upsert: true });
  }
  return TrainingItem.findById(itemId).orFail();
}

/** Records an answer to the current image, and grants qualification if the window now passes. */
export async function recordAnswer(
  user: Id,
  scriptClass: ScriptClass,
  answer: { category: Category; abkai?: string; manchu?: string },
) {
  const state = await TrainingState.findOne({ user, scriptClass });
  if (!state?.currentItem) return null;
  const item = await TrainingItem.findById(state.currentItem).orFail();

  const correct =
    answer.category === item.category && (item.category !== "manchu" || answer.manchu === item.manchu);
  await TrainingAttempt.create({
    user,
    item: item._id,
    scriptClass,
    kind: item.kind,
    category: answer.category,
    abkai: answer.abkai,
    manchu: answer.manchu,
    correct,
  });
  await TrainingState.updateOne({ _id: state._id }, { $unset: { currentItem: "" } });

  const { passes } = summarizeWindow(await recentAttempts(user, scriptClass));
  if (passes) {
    await Qualification.updateOne({ user, scriptClass }, { $setOnInsert: { user, scriptClass } }, { upsert: true });
  }
  return { correct, item, progress: await getProgress(user, scriptClass) };
}

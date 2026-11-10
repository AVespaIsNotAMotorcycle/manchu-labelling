import type { Types } from "mongoose";

import type { Category } from "./models/labels.ts";
import type { ScriptClass } from "./models/sources.ts";
import { Qualification, TrainingAttempt, TrainingItem, TrainingState } from "./models/training.ts";

type Id = Types.ObjectId;
type Kind = "real" | "synthetic";

/** Generated images answered correctly in a row to finish the first stage. */
export const SYNTHETIC_STREAK = 10;
/** Real scans answered correctly in a row, after the first stage, to qualify. */
export const REAL_STREAK = 15;
/** Share of real scans that are not Manchu, so that the category question stays meaningful. */
const NON_MANCHU_SHARE = 0.1;

/**
 * The quiz proper, or practice on generated images once the first stage is passed. Each has its own
 * waiting image, so that switching between them cannot skip one.
 */
export type Mode = "quiz" | "practice";
const STATE_FIELD = { quiz: "currentItem", practice: "practiceItem" } as const;

export interface Stage {
  /** Whether each of the latest answers in this stage was correct, oldest first. */
  recent: boolean[];
  /** Correct answers in a row that the stage needs. */
  length: number;
  /** How many more correct answers in a row are needed. */
  needed: number;
}

export interface Progress {
  answered: number;
  /** Passing this stage is permanent, so practice afterwards cannot undo it. */
  synthetic: Stage & { passed: boolean };
  real: Stage;
  qualified: boolean;
}

interface Answer {
  correct: boolean;
  kind: string;
}

const correctInARow = (results: readonly boolean[]) => results.length - 1 - results.lastIndexOf(false);

function stage(results: readonly boolean[], length: number): Stage {
  return {
    recent: results.slice(-length),
    length,
    needed: Math.max(0, length - correctInARow(results)),
  };
}

/**
 * Works out both stages from every answer in a class, oldest first. Real answers only count once the
 * first stage is passed, and generated images after that are practice. A class without generated
 * images skips the first stage.
 */
export function summarizeAnswers(
  answers: readonly Answer[],
  hasSynthetic: boolean,
): Omit<Progress, "qualified"> & { passes: boolean } {
  const synthetic: boolean[] = [];
  const real: boolean[] = [];
  let passed = !hasSynthetic;
  for (const { correct, kind } of answers) {
    if (!passed && kind === "synthetic") {
      synthetic.push(correct);
      passed = correctInARow(synthetic) >= SYNTHETIC_STREAK;
    } else if (passed && kind === "real") {
      real.push(correct);
    }
  }
  const realStage = stage(real, REAL_STREAK);
  return {
    answered: answers.length,
    synthetic: { ...stage(synthetic, SYNTHETIC_STREAK), passed },
    real: realStage,
    passes: passed && realStage.needed === 0,
  };
}

async function summarize(user: Id, scriptClass: ScriptClass) {
  const [answers, hasSynthetic] = await Promise.all([
    TrainingAttempt.find({ user, scriptClass }, "correct kind").sort({ createdAt: 1, _id: 1 }).lean(),
    TrainingItem.exists({ scriptClass, kind: "synthetic", active: { $ne: false } }),
  ]);
  return summarizeAnswers(answers, Boolean(hasSynthetic));
}

export async function getProgress(user: Id, scriptClass: ScriptClass): Promise<Progress> {
  const [summary, qualification] = await Promise.all([
    summarize(user, scriptClass),
    Qualification.exists({ user, scriptClass }),
  ]);
  const { passes: _passes, ...progress } = summary;
  return { ...progress, qualified: Boolean(qualification) };
}

/** Script classes the user may label. */
export async function qualifiedClasses(user: Id): Promise<ScriptClass[]> {
  return Qualification.distinct("scriptClass", { user });
}

/** The kind of image a mode draws from now, or null if practice is not open yet. */
async function poolFor(user: Id, scriptClass: ScriptClass, mode: Mode): Promise<Kind | null> {
  const { synthetic } = await summarize(user, scriptClass);
  if (mode === "practice") return synthetic.passed ? "synthetic" : null;
  return synthetic.passed ? "real" : "synthetic";
}

async function sampleItem(match: object): Promise<Id | null> {
  const [item] = await TrainingItem.aggregate<{ _id: Id }>([
    { $match: match },
    { $sample: { size: 1 } },
    { $project: { _id: 1 } },
  ]);
  return item?._id ?? null;
}

/** Chooses an image the user has not answered. Once every image has been answered, repeats are allowed. */
async function chooseItem(user: Id, scriptClass: ScriptClass, pool: Kind, random = Math.random) {
  const answered = await TrainingAttempt.distinct("item", { user, scriptClass });
  const available = { scriptClass, kind: pool, active: { $ne: false } };
  const unseen = { ...available, _id: { $nin: answered } };
  const preferred =
    pool === "real" ? { category: random() < NON_MANCHU_SHARE ? { $ne: "manchu" } : "manchu" } : {};
  return (
    (await sampleItem({ ...unseen, ...preferred })) ??
    (await sampleItem(unseen)) ??
    (await sampleItem(available))
  );
}

/** Returns the image the user must answer, choosing one if needed. */
export async function currentItem(user: Id, scriptClass: ScriptClass, mode: Mode) {
  const pool = await poolFor(user, scriptClass, mode);
  if (!pool) return { locked: true } as const;
  const field = STATE_FIELD[mode];
  const state = await TrainingState.findOne({ user, scriptClass });
  const waiting = state?.[field] ? await TrainingItem.findById(state[field]) : null;
  // A waiting image only goes unanswered if it belongs to another stage, as after a change to the rules.
  if (waiting?.kind === pool) return { item: waiting };

  const itemId = await chooseItem(user, scriptClass, pool);
  if (!itemId) return { item: null };
  await TrainingState.updateOne({ user, scriptClass }, { [field]: itemId }, { upsert: true });
  return { item: await TrainingItem.findById(itemId).orFail() };
}

/** Records an answer to the waiting image, and grants qualification if the quiz is now passed. */
export async function recordAnswer(
  user: Id,
  scriptClass: ScriptClass,
  mode: Mode,
  answer: { category: Category; abkai?: string; manchu?: string },
) {
  const field = STATE_FIELD[mode];
  const [state, pool] = await Promise.all([
    TrainingState.findOne({ user, scriptClass }),
    poolFor(user, scriptClass, mode),
  ]);
  const itemId = state?.[field];
  if (!state || !itemId || !pool) return null;
  const item = await TrainingItem.findById(itemId).orFail();
  if (item.kind !== pool) return null;

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
  await TrainingState.updateOne({ _id: state._id }, { $unset: { [field]: "" } });

  const { passes } = await summarize(user, scriptClass);
  if (passes) {
    await Qualification.updateOne({ user, scriptClass }, { $setOnInsert: { user, scriptClass } }, { upsert: true });
  }
  return { correct, item, progress: await getProgress(user, scriptClass) };
}

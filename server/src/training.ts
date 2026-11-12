import type { Types } from "mongoose";

import type { Category } from "./models/labels.ts";
import type { ScriptClass } from "./models/sources.ts";
import {
  Qualification,
  TRAINING_KINDS,
  TrainingAttempt,
  TrainingItem,
  TrainingState,
  type TrainingKind,
} from "./models/training.ts";

type Id = Types.ObjectId;

/** Correct answers in a row that each phase needs. */
export const STREAK = 8;
/** Share of real images that are not Manchu, so that the category question stays meaningful. */
const NON_MANCHU_SHARE = 0.1;

/**
 * The quiz proper, or practice on synthetic images once that phase is passed. Each has its own waiting
 * image, so that switching between them cannot skip one.
 */
export type Mode = "quiz" | "practice";
const STATE_FIELD = { quiz: "currentItem", practice: "practiceItem" } as const;

export interface PhaseProgress {
  phase: TrainingKind;
  /** Passing a phase is permanent, so later answers cannot undo it. */
  passed: boolean;
  /** Whether each of the latest answers in this phase was correct, oldest first. */
  recent: boolean[];
  /** Correct answers in a row that the phase needs. */
  length: number;
  /** How many more correct answers in a row are needed. */
  needed: number;
}

export interface Progress {
  answered: number;
  phases: PhaseProgress[];
  qualified: boolean;
}

interface Answer {
  correct: boolean;
  kind: string;
}

const correctInARow = (results: readonly boolean[]) => results.length - 1 - results.lastIndexOf(false);

/**
 * Works out every phase from all of a user's answers in a class, oldest first. An answer only counts
 * towards the phase the user was in when they gave it, so practice and answers from before the quiz had
 * phases change nothing. A phase without any images is passed automatically.
 */
export function summarizeAnswers(
  answers: readonly Answer[],
  phasesWithImages: ReadonlySet<string>,
): Omit<Progress, "qualified"> & { passes: boolean } {
  const results = TRAINING_KINDS.map((): boolean[] => []);
  const firstUnpassed = (from: number) => {
    let index = from;
    while (index < TRAINING_KINDS.length && !phasesWithImages.has(TRAINING_KINDS[index] as string)) {
      index += 1;
    }
    return index;
  };

  let current = firstUnpassed(0);
  for (const { correct, kind } of answers) {
    if (kind !== TRAINING_KINDS[current]) continue;
    const phase = results[current] as boolean[];
    phase.push(correct);
    if (correctInARow(phase) >= STREAK) current = firstUnpassed(current + 1);
  }

  const phases = TRAINING_KINDS.map((phase, index) => {
    const phaseResults = results[index] as boolean[];
    const passed = index < current;
    return {
      phase,
      passed,
      recent: phaseResults.slice(-STREAK),
      length: STREAK,
      needed: passed ? 0 : STREAK - correctInARow(phaseResults),
    };
  });
  return { answered: answers.length, phases, passes: current === TRAINING_KINDS.length };
}

async function summarize(user: Id, scriptClass: ScriptClass) {
  const [answers, phasesWithImages] = await Promise.all([
    TrainingAttempt.find({ user, scriptClass }, "correct kind").sort({ createdAt: 1, _id: 1 }).lean(),
    TrainingItem.distinct("kind", { scriptClass, active: { $ne: false } }),
  ]);
  return summarizeAnswers(answers, new Set(phasesWithImages));
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

/**
 * The kind of image a mode draws from now, or null if practice is not open yet. Once every phase is
 * passed, the quiz keeps going with the last one.
 */
async function poolFor(user: Id, scriptClass: ScriptClass, mode: Mode): Promise<TrainingKind | null> {
  const { phases } = await summarize(user, scriptClass);
  const [synthetic] = phases;
  if (mode === "practice") return synthetic?.passed ? "synthetic" : null;
  return (phases.find(({ passed }) => !passed) ?? phases.at(-1))?.phase ?? null;
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
async function chooseItem(user: Id, scriptClass: ScriptClass, pool: TrainingKind, random = Math.random) {
  const answered = await TrainingAttempt.distinct("item", { user, scriptClass });
  const available = { scriptClass, kind: pool, active: { $ne: false } };
  const unseen = { ...available, _id: { $nin: answered } };
  const preferred =
    pool === "synthetic" ? {} : { category: random() < NON_MANCHU_SHARE ? { $ne: "manchu" } : "manchu" };
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

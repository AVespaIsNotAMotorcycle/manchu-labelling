import type { Types } from "mongoose";

import { checkResults, summarizeChecks, type CheckResult } from "./checks.ts";
import { Annotation } from "./models/labels.ts";

type Id = Types.ObjectId;

/**
 * A user only sees a check after labelling this many more images, so that their history cannot tell
 * them which images in a session were checks.
 */
export const FEEDBACK_DELAY = 25;

/** The user's graded checks that they are allowed to see: those followed by at least 25 more labels. */
export async function visibleCheckResults(user: Id): Promise<CheckResult[]> {
  const [results, firsts] = await Promise.all([
    checkResults({ users: [user] }),
    Annotation.aggregate<{ at: Date }>([
      { $match: { user } },
      { $group: { _id: "$wordImage", at: { $min: "$createdAt" } } },
      { $sort: { at: 1 } },
    ]),
  ]);
  const times = firsts.map(({ at }) => at.getTime());
  /** How many images the user first labelled after a moment. */
  const labelledAfter = (at: Date) => {
    let low = 0;
    let high = times.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if ((times[middle] as number) <= at.getTime()) low = middle + 1;
      else high = middle;
    }
    return times.length - low;
  };
  return results.filter(({ at }) => labelledAfter(at) >= FEEDBACK_DELAY);
}

export interface ClassAccuracy {
  scriptClass: string;
  answered: number;
  passed: number;
  accuracy: number;
}

/** Accuracy in each script class over the checks the user can see. */
export function accuracyByClass(results: readonly CheckResult[]): ClassAccuracy[] {
  return [...summarizeChecks(results)].map(([key, { answered, passed, accuracy }]) => ({
    scriptClass: key.split(":")[1] as string,
    answered,
    passed,
    accuracy,
  }));
}

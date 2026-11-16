import type { CheckResult } from "./checks.ts";

/** The number of a user's latest graded checks that trust looks at. */
export const TRUST_WINDOW = 30;
/** The mean character accuracy over that window that a user needs to be trusted. */
export const TRUST_THRESHOLD = 0.95;
/** Graded checks a user needs before trust can exclude them. Until then, they count as trusted. */
export const TRUST_MINIMUM_SAMPLE = 10;

/** Edit distance between two strings, counting Unicode code points. */
export function editDistance(a: string, b: string): number {
  const left = Array.from(a);
  const right = Array.from(b);
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= right.length; j += 1) {
      const substitution = (previous[j - 1] as number) + (left[i - 1] === right[j - 1] ? 0 : 1);
      current.push(Math.min((previous[j] as number) + 1, (current[j - 1] as number) + 1, substitution));
    }
    previous = current;
  }
  return previous[right.length] as number;
}

interface Answer {
  category: string;
  manchu?: string | null;
}

interface Label {
  category: string;
  transcription?: { manchu: string } | null;
}

/**
 * How much of a known answer a label got right, from 0 to 1. A wrong category scores 0. For Manchu, it is
 * 1 − edit distance ÷ answer length, and never less than 0.
 */
export function characterAccuracy(answer: Answer, label: Label): number {
  if (label.category !== answer.category) return 0;
  if (answer.category !== "manchu") return 1;
  const expected = answer.manchu ?? "";
  const given = label.transcription?.manchu ?? "";
  const length = Array.from(expected).length;
  if (length === 0) return given === "" ? 1 : 0;
  return Math.max(0, 1 - editDistance(expected, given) / length);
}

/**
 * Decides whether users were trusted at given moments, from their graded checks. A user is trusted in a
 * class at a moment if, of the checks they first labelled before then, the latest 30 average at least
 * 95% character accuracy. With fewer than 10 such checks, they are trusted.
 */
export class TrustIndex {
  /** Results for each `user:scriptClass`, oldest first. */
  private readonly results = new Map<string, CheckResult[]>();

  constructor(results: readonly CheckResult[]) {
    for (const result of [...results].sort((a, b) => a.at.getTime() - b.at.getTime())) {
      const key = `${result.user}:${result.scriptClass}`;
      const list = this.results.get(key) ?? [];
      list.push(result);
      this.results.set(key, list);
    }
  }

  /** The checks counted for trust at a moment: the latest 30 first labelled before it. */
  window(user: unknown, scriptClass: string, at: Date): CheckResult[] {
    const list = this.results.get(`${user}:${scriptClass}`) ?? [];
    let end = 0;
    while (end < list.length && (list[end] as CheckResult).at < at) end += 1;
    return list.slice(Math.max(0, end - TRUST_WINDOW), end);
  }

  /** Mean character accuracy over the window, or null if the sample is too small to judge. */
  accuracy(user: unknown, scriptClass: string, at: Date): number | null {
    const window = this.window(user, scriptClass, at);
    if (window.length < TRUST_MINIMUM_SAMPLE) return null;
    return window.reduce((sum, { accuracy }) => sum + accuracy, 0) / window.length;
  }

  isTrusted(user: unknown, scriptClass: string, at: Date): boolean {
    const accuracy = this.accuracy(user, scriptClass, at);
    // The tolerance stops rounding in the mean from failing a user exactly at the threshold.
    return accuracy === null || accuracy >= TRUST_THRESHOLD - 1e-9;
  }
}

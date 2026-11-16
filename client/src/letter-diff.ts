import { manchuToAbkai } from "@manchu-labelling/script";

export interface DiffLetter {
  /** The letter in Abkai. */
  abkai: string;
  /** `same` in both readings, `missing` from the given reading, or `extra` in it. */
  kind: "same" | "missing" | "extra";
}

/**
 * Lines up two readings letter by letter, using the longest run of letters they share, so that a
 * learner can see which letters they missed or added. Letters are compared in Manchu Unicode and shown in
 * Abkai.
 */
export function diffLetters(expected: string, given: string): DiffLetter[] {
  const a = Array.from(expected);
  const b = Array.from(given);
  const table = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i]![j] = a[i] === b[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }
  const result: DiffLetter[] = [];
  const letter = (character: string) => manchuToAbkai(character).text;
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      result.push({ abkai: letter(a[i]!), kind: "same" });
      i += 1;
      j += 1;
    } else if (j < b.length && (i >= a.length || table[i]![j + 1]! >= table[i + 1]![j]!)) {
      result.push({ abkai: letter(b[j]!), kind: "extra" });
      j += 1;
    } else {
      result.push({ abkai: letter(a[i]!), kind: "missing" });
      i += 1;
    }
  }
  return result;
}

import { abkaiToManchu } from "@manchu-labelling/script";

import { CATEGORIES, type Category } from "./models/labels.ts";

export interface ParsedText {
  abkai: string;
  manchu: string;
}

/**
 * Converts typed Abkai. Stored text is always worked out on the server, so that a client cannot submit
 * Manchu that it did not type.
 */
export function parseText(abkai: unknown): ParsedText | null | "invalid" {
  if (abkai === undefined || abkai === null || abkai === "") return null;
  if (typeof abkai !== "string") return "invalid";
  const { text, invalid } = abkaiToManchu(abkai);
  return invalid.length > 0 || text === "" ? "invalid" : { abkai, manchu: text };
}

export interface ParsedAnswer {
  category: Category;
  transcription?: ParsedText;
}

/** Reads a category and, for Manchu, typed Abkai, as given in a dispute or a review. Null if invalid. */
export function parseAnswer(body: unknown): ParsedAnswer | null {
  const { category, transcription } = (body ?? {}) as { category?: unknown; transcription?: unknown };
  if (!CATEGORIES.includes(category as Category)) return null;
  if (category !== "manchu") return { category: category as Category };
  const parsed = parseText(transcription);
  if (!parsed || parsed === "invalid") return null;
  return { category: "manchu", transcription: parsed };
}

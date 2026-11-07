import { abkaiToManchu } from "@manchu-labelling/script";

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

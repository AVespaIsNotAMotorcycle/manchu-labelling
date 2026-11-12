import { randomInt } from "node:crypto";

/** The share of words held back from releases, to become hidden checks. */
export const HOLD_BACK_RATE = 0.15;

/**
 * Chooses whether a new word is held back. It uses a cryptographic random source, since a choice that
 * could be predicted from anything a user sees would reveal future checks.
 */
export function chooseHeldBack(random: () => number = () => randomInt(1_000_000) / 1_000_000): boolean {
  return random() < HOLD_BACK_RATE;
}

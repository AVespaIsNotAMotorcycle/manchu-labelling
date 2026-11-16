/**
 * Lets the letter reference type into the Abkai field the user last used. Clicking a letter in the
 * reference moves focus away from the field, so the field registers itself when it gains focus and
 * stays registered until another field takes over or it goes away.
 */

type Insert = (text: string) => void;

let active: { insert: Insert } | null = null;
const listeners = new Set<() => void>();

export function setActiveAbkaiField(field: { insert: Insert } | null): void {
  active = field;
  for (const listener of listeners) listener();
}

export function clearActiveAbkaiField(field: { insert: Insert }): void {
  if (active === field) setActiveAbkaiField(null);
}

/** Types text into the active field. Returns false if there is none. */
export function insertAbkai(text: string): boolean {
  if (!active) return false;
  active.insert(text);
  return true;
}

export const hasActiveAbkaiField = () => active !== null;

/** Calls `listener` whenever a field becomes active or stops being active. */
export function onActiveAbkaiFieldChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

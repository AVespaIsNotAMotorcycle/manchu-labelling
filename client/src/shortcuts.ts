import { useEffect, useRef } from "react";

/**
 * Runs an action when a single key is pressed, unless the user is typing in a field or holding a
 * modifier. Keys are matched case-insensitively, such as "y" or "1".
 */
export function useKeyShortcuts(actions: Record<string, () => void>, enabled = true): void {
  const latest = useRef(actions);
  latest.current = actions;
  useEffect(() => {
    if (!enabled) return;
    function onKey(event: KeyboardEvent) {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if ((event.target as HTMLElement).closest("input, select, textarea, [contenteditable]")) return;
      const action = latest.current[event.key.toLowerCase()];
      if (action) {
        event.preventDefault();
        action();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [enabled]);
}

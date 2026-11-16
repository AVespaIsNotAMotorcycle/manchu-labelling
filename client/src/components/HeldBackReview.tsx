import { useCallback, useEffect, useState } from "react";

import {
  decideHeldBack,
  getHeldBack,
  getHeldBackDecisions,
  undoHeldBack,
  type HeldBackDecision,
  type HeldBackItem,
} from "../api.ts";
import { AnswerText } from "./AnswerText.tsx";
import { categoryName } from "./CategoryField.tsx";
import { CropImage } from "./CropImage.tsx";
import { ManchuText } from "./ManchuText.tsx";
import { PageImage } from "./PageView.tsx";

/**
 * Lets a reviewer confirm the answers that labelers agreed on for held-back images. A yes makes the image a
 * hidden check, so it should only be given when the image shows exactly that answer.
 */
export function HeldBackReview() {
  const [items, setItems] = useState<HeldBackItem[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    getHeldBack()
      .then(({ items: next }) => setItems(next))
      .catch((failure: Error) => setError(failure.message));
  }, []);
  useEffect(load, [load]);

  const item = items?.[0];
  const decide = useCallback(
    async (decision: "yes" | "no") => {
      if (!item || busy) return;
      setBusy(true);
      setError("");
      try {
        await decideHeldBack(item, decision);
        setItems((current) => current?.slice(1) ?? null);
      } catch (failure) {
        setError((failure as Error).message);
        load();
      } finally {
        setBusy(false);
      }
    },
    [item, busy, load],
  );

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if ((event.target as HTMLElement).closest("input, select, textarea")) return;
      const key = event.key.toLowerCase();
      if (key === "y") decide("yes");
      else if (key === "n") decide("no");
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [decide]);

  return (
    <section className="held-back">
      <h2>Held-back answers</h2>
      <p className="hint">
        Each image was labelled the same way by {item?.labelers ?? 3} labelers. Yes makes it a hidden
        check, so only say yes if the image shows exactly this answer.
      </p>
      {error && <p role="alert">{error}</p>}
      {items === null && !error && <p className="status">Loading…</p>}
      {items?.length === 0 && <p className="status">Nothing is waiting for review.</p>}
      {item && (
        <div className="labelling" key={item.id}>
          <div className="comparison">
            <figure>
              <figcaption>Image</figcaption>
              <CropImage src={item.imageUrl} />
            </figure>
            <figure>
              <figcaption>Agreed answer</figcaption>
              {item.manchu ? (
                <ManchuText text={item.manchu} className="preview" />
              ) : (
                <p className="agreed-category">{categoryName(item.category)}</p>
              )}
            </figure>
          </div>
          <div className="fields">
            <p className="hint">{items.length === 50 ? "50 or more" : items.length} waiting</p>
            {item.abkai && (
              <p>
                Abkai: <strong className="agreed-abkai">{item.abkai}</strong>
              </p>
            )}
            <div className="actions">
              <button type="button" disabled={busy} onClick={() => decide("yes")}>
                Yes, make it a check (Y)
              </button>
              <button type="button" className="secondary" disabled={busy} onClick={() => decide("no")}>
                No (N)
              </button>
            </div>
          </div>
          <PageImage context={item.context} />
        </div>
      )}
      <RecentDecisions key={items?.length} onUndone={load} />
    </section>
  );
}

/**
 * The latest decisions, so that a mistake can be undone. Undoing a yes stops the image being a check,
 * and undoing a no puts it back in the list above.
 */
function RecentDecisions({ onUndone }: { onUndone: () => void }) {
  const [decisions, setDecisions] = useState<HeldBackDecision[]>([]);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    getHeldBackDecisions()
      .then(({ items }) => setDecisions(items))
      .catch((failure: Error) => setError(failure.message));
  }, []);
  useEffect(() => {
    if (open) load();
  }, [open, load]);

  async function undo(decision: HeldBackDecision) {
    const warning =
      decision.decision === "yes"
        ? "Undo this yes? The image will stop being a hidden check, and grades on it will no longer count."
        : "Undo this no? The image will go back on the list for review.";
    if (!window.confirm(warning)) return;
    try {
      await undoHeldBack(decision.id);
      load();
      onUndone();
    } catch (failure) {
      setError((failure as Error).message);
    }
  }

  return (
    <details className="recent-decisions" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>Recent decisions</summary>
      {error && <p role="alert">{error}</p>}
      {open && decisions.length === 0 && <p className="hint">No decisions yet.</p>}
      <ul className="past-checks">
        {decisions.map((decision) => (
          <li key={decision.id} className="past-check">
            <img className="thumbnail" src={decision.imageUrl} alt="A held-back image" />
            <AnswerText answer={decision} />
            <div className="past-check-result">
              <p>{decision.decision === "yes" ? "Yes, a hidden check" : "No"}</p>
              <button type="button" className="secondary" onClick={() => undo(decision)}>
                Undo
              </button>
            </div>
          </li>
        ))}
      </ul>
    </details>
  );
}

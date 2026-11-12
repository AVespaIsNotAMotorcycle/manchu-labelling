import { useCallback, useEffect, useState } from "react";

import { decideHeldBack, getHeldBack, type HeldBackItem } from "../api.ts";
import { categoryName } from "./CategoryField.tsx";
import { CropImage } from "./CropImage.tsx";
import { ManchuText } from "./ManchuText.tsx";
import { PageImage } from "./PageView.tsx";

/**
 * Lets an admin confirm the answers that labelers agreed on for held-back images. A yes makes the image a
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
    <main className="held-back">
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
    </main>
  );
}

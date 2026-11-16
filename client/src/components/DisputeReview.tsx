import { useCallback, useEffect, useState } from "react";

import { getDisputes, resolveDispute, type DisputeItem } from "../api.ts";
import { AnswerForm } from "./AnswerForm.tsx";
import { AnswerText } from "./AnswerText.tsx";
import { CropImage } from "./CropImage.tsx";
import { PagePreview } from "./PageView.tsx";
import { useKeyShortcuts } from "../shortcuts.ts";

/**
 * Lets a reviewer settle disputes. Upholding changes nothing. Correcting replaces a check's answer, and
 * withdrawing stops the image counting. Grades and qualification follow automatically.
 */
export function DisputeReview({ onChange }: { onChange?: () => void }) {
  const [items, setItems] = useState<DisputeItem[] | null>(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [correcting, setCorrecting] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    getDisputes()
      .then(({ items: next }) => setItems(next))
      .catch((failure: Error) => setError(failure.message));
  }, []);
  useEffect(load, [load]);

  const item = items?.[0];

  async function decide(outcome: "upheld" | "corrected" | "withdrawn", answer?: object) {
    if (!item) return;
    setBusy(true);
    setError("");
    try {
      await resolveDispute(item.id, { outcome, ...answer, note: note || undefined });
      setItems((current) => current?.slice(1) ?? null);
      onChange?.();
      setNote("");
      setCorrecting(false);
    } catch (failure) {
      setError((failure as Error).message);
      load();
    } finally {
      setBusy(false);
    }
  }

  /** Moves the current dispute to the end of the list, so that a hard one does not block the rest. */
  function skip() {
    setItems((current) => (current && current.length > 1 ? [...current.slice(1), current[0] as DisputeItem] : current));
    setCorrecting(false);
  }

  useKeyShortcuts(
    {
      u: () => !busy && decide("upheld"),
      c: () => item?.kind === "check" && setCorrecting(true),
      w: () => !busy && decide("withdrawn"),
      s: skip,
    },
    Boolean(item) && !correcting,
  );

  return (
    <section className="held-back">
      <h2>Disputes</h2>
      <p className="hint">
        A labeler thinks the expected answer is wrong. Look at the image and its page before deciding.
      </p>
      {error && <p role="alert">{error}</p>}
      {items === null && !error && <p className="status">Loading…</p>}
      {items?.length === 0 && <p className="status">No disputes are waiting.</p>}
      {item && (
        <div className="labelling" key={item.id}>
          <div className="comparison">
            <figure>
              <figcaption>{item.kind === "quiz" ? "Quiz image" : "Hidden check"}</figcaption>
              <CropImage src={item.imageUrl} alt="The disputed word" />
            </figure>
            {item.context && <PagePreview context={item.context} />}
          </div>
          <div className="fields">
            <p className="hint">{items.length === 50 ? "50 or more" : items.length} waiting</p>
            <dl>
              <dt>Expected answer</dt>
              <dd>
                <AnswerText answer={item.answer} />
              </dd>
              <dt>The labeler suggests</dt>
              <dd>
                <AnswerText answer={item.proposed} />
              </dd>
              {item.note && (
                <>
                  <dt>Their note</dt>
                  <dd>{item.note}</dd>
                </>
              )}
              {item.graded && (
                <>
                  <dt>Labelers who matched the expected answer</dt>
                  <dd>
                    {item.graded.passed} of {item.graded.total}
                  </dd>
                </>
              )}
              {item.source && (
                <>
                  <dt>Source</dt>
                  <dd>{item.source}</dd>
                </>
              )}
            </dl>
            <label className="note">
              Note to the labeler (optional)
              <textarea value={note} maxLength={2000} rows={2} onChange={(event) => setNote(event.target.value)} />
            </label>
            {correcting ? (
              <AnswerForm
                idPrefix={`correct-${item.id}`}
                submitLabel="Save the corrected answer"
                initial={{ category: item.proposed.category, abkai: item.proposed.abkai }}
                onSubmit={(answer) => decide("corrected", answer)}
              />
            ) : (
              <div className="actions">
                <button type="button" disabled={busy} onClick={() => decide("upheld")}>
                  The answer stands (U)
                </button>
                {item.kind === "check" && (
                  <button type="button" className="secondary" disabled={busy} onClick={() => setCorrecting(true)}>
                    Correct the answer (C)
                  </button>
                )}
                <button type="button" className="secondary" disabled={busy} onClick={() => decide("withdrawn")}>
                  {item.kind === "quiz" ? "Take it out of the quiz" : "Stop using it as a check"} (W)
                </button>
                <button type="button" className="secondary" disabled={items.length < 2} onClick={skip}>
                  Skip for now (S)
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

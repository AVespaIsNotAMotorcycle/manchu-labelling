import { useCallback, useEffect, useState } from "react";

import { getDisputes, resolveDispute, type DisputeItem } from "../api.ts";
import { AnswerForm } from "./AnswerForm.tsx";
import { AnswerText } from "./AnswerText.tsx";
import { CropImage } from "./CropImage.tsx";
import { PageImage } from "./PageView.tsx";

/**
 * Lets a reviewer settle disputes. Upholding changes nothing. Correcting replaces a check's answer, and
 * withdrawing stops the image counting. Grades and qualification follow automatically.
 */
export function DisputeReview() {
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
      setNote("");
      setCorrecting(false);
    } catch (failure) {
      setError((failure as Error).message);
      load();
    } finally {
      setBusy(false);
    }
  }

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
              <CropImage src={item.imageUrl} />
            </figure>
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
                  The answer stands
                </button>
                {item.kind === "check" && (
                  <button type="button" className="secondary" disabled={busy} onClick={() => setCorrecting(true)}>
                    Correct the answer
                  </button>
                )}
                <button type="button" className="secondary" disabled={busy} onClick={() => decide("withdrawn")}>
                  {item.kind === "quiz" ? "Take it out of the quiz" : "Stop using it as a check"}
                </button>
              </div>
            )}
          </div>
          {item.context && <PageImage context={item.context} />}
        </div>
      )}
    </section>
  );
}

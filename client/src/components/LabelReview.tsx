import { useCallback, useEffect, useState } from "react";

import { getLabelReviews, reviewLabels, type LabelReviewItem, type Reading } from "../api.ts";
import { AnswerForm, type AnswerInput } from "./AnswerForm.tsx";
import { AnswerText } from "./AnswerText.tsx";
import { CropImage } from "./CropImage.tsx";
import { PageImage } from "./PageView.tsx";

const asInput = (reading: Reading): AnswerInput => ({
  category: reading.category,
  ...(reading.abkai ? { transcription: reading.abkai } : {}),
});

/**
 * Lets a reviewer give the final answer for an image whose labelers did not agree. The readings are
 * shown without names. The answer should record what is written, not the intended word.
 */
export function LabelReview() {
  const [items, setItems] = useState<LabelReviewItem[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [ownAnswer, setOwnAnswer] = useState(false);

  const load = useCallback(() => {
    getLabelReviews()
      .then(({ items: next }) => setItems(next))
      .catch((failure: Error) => setError(failure.message));
  }, []);
  useEffect(load, [load]);

  const item = items?.[0];

  async function decide(answer: AnswerInput) {
    if (!item) return;
    setBusy(true);
    setError("");
    try {
      await reviewLabels(item.id, answer);
      setItems((current) => current?.slice(1) ?? null);
      setOwnAnswer(false);
    } catch (failure) {
      setError((failure as Error).message);
      load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="held-back">
      <h2>Labels to settle</h2>
      <p className="hint">
        The labelers did not agree on these images. Choose the reading that matches what is written, or
        give your own. Record what is written, even if it is a misspelling.
      </p>
      {error && <p role="alert">{error}</p>}
      {items === null && !error && <p className="status">Loading…</p>}
      {items?.length === 0 && <p className="status">No images are waiting.</p>}
      {item && (
        <div className="labelling" key={item.id}>
          <div className="comparison">
            <figure>
              <figcaption>Image</figcaption>
              <CropImage src={item.imageUrl} />
            </figure>
          </div>
          <div className="fields">
            <p className="hint">{items.length === 50 ? "50 or more" : items.length} waiting</p>
            <ul className="readings">
              {item.readings.map((reading) => (
                <li key={`${reading.category}:${reading.manchu ?? ""}`}>
                  <AnswerText answer={reading} />
                  <span className="hint">
                    {reading.count} {reading.count === 1 ? "labeler" : "labelers"}
                    {reading.unsure > 0 && `, ${reading.unsure} unsure`}
                  </span>
                  <button type="button" disabled={busy} onClick={() => decide(asInput(reading))}>
                    Use this
                  </button>
                </li>
              ))}
            </ul>
            {ownAnswer ? (
              <AnswerForm idPrefix={`review-${item.id}`} submitLabel="Save my answer" onSubmit={decide} />
            ) : (
              <button type="button" className="secondary" onClick={() => setOwnAnswer(true)}>
                Give a different answer
              </button>
            )}
          </div>
          <PageImage context={item.context} />
        </div>
      )}
    </section>
  );
}

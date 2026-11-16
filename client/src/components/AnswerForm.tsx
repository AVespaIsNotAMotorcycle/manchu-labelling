import { abkaiToManchu } from "@manchu-labelling/script";
import { useState, type FormEvent, type ReactNode } from "react";

import { AbkaiField } from "./AbkaiField.tsx";
import { CategoryField } from "./CategoryField.tsx";
import { ManchuText } from "./ManchuText.tsx";

export interface AnswerInput {
  category: string;
  transcription?: string;
}

/**
 * Asks for a category and, for Manchu, what is written, as in a dispute or a review. `children` go
 * between the fields and the submit button.
 */
export function AnswerForm(props: {
  idPrefix: string;
  submitLabel: string;
  initial?: { category?: string; abkai?: string };
  onSubmit: (answer: AnswerInput) => Promise<void>;
  children?: ReactNode;
}) {
  const [category, setCategory] = useState(props.initial?.category ?? "manchu");
  const [abkai, setAbkai] = useState(props.initial?.abkai ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const isManchu = category === "manchu";
  const preview = abkaiToManchu(abkai);
  const ready = isManchu ? preview.text !== "" && preview.invalid.length === 0 : category !== "";

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError("");
    try {
      await props.onSubmit({ category, ...(isManchu ? { transcription: abkai } : {}) });
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="answer-form" onSubmit={submit}>
      <CategoryField value={category} onChange={setCategory} />
      {isManchu && (
        <div className="answer-entry">
          <AbkaiField
            id={`${props.idPrefix}-abkai`}
            label="What is written (Abkai)"
            value={abkai}
            onChange={setAbkai}
          />
          <ManchuText text={preview.text} className="small-preview" />
        </div>
      )}
      {props.children}
      {error && <p role="alert">{error}</p>}
      <div className="actions">
        <button type="submit" disabled={!ready || busy}>
          {props.submitLabel}
        </button>
      </div>
    </form>
  );
}

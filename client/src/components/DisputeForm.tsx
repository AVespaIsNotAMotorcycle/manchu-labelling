import { useState } from "react";

import { openDispute } from "../api.ts";
import { AnswerForm } from "./AnswerForm.tsx";

/** Lets a user say what they think the right answer is for a past check or a quiz image. */
export function DisputeForm(props: {
  kind: "check" | "quiz";
  id: string;
  initial?: { category?: string; abkai?: string };
  onDone: () => void;
  onCancel: () => void;
}) {
  const [note, setNote] = useState("");
  return (
    <div className="dispute-form">
      <p className="hint">
        Tell us what you think this image shows. A reviewer will look at it, and you can see the outcome
        on your Progress page.
      </p>
      <AnswerForm
        idPrefix={`dispute-${props.id}`}
        submitLabel="Send dispute"
        initial={props.initial}
        onSubmit={async (answer) => {
          await openDispute({ kind: props.kind, id: props.id, ...answer, note: note || undefined });
          props.onDone();
        }}
      >
        <label className="note">
          Note (optional)
          <textarea value={note} maxLength={2000} rows={3} onChange={(event) => setNote(event.target.value)} />
        </label>
      </AnswerForm>
      <button type="button" className="link" onClick={props.onCancel}>
        Cancel
      </button>
    </div>
  );
}

import { useState } from "react";

import type { ReviewCounts } from "../api.ts";
import { DisputeReview } from "./DisputeReview.tsx";
import { HeldBackReview } from "./HeldBackReview.tsx";
import { LabelReview } from "./LabelReview.tsx";

const SECTIONS = [
  ["labels", "Labels", "labels"],
  ["disputes", "Disputes", "disputes"],
  ["held-back", "Held-back answers", "heldBack"],
] as const;

type Section = (typeof SECTIONS)[number][0];

/** The work that reviewers and admins do. Each tab shows how much is waiting in it. */
export function Review({ counts, onChange }: { counts: ReviewCounts | null; onChange: () => void }) {
  const [section, setSection] = useState<Section>("labels");
  return (
    <main>
      <nav className="tabs" aria-label="Review">
        {SECTIONS.map(([value, name, count]) => (
          <button key={value} type="button" aria-current={section === value} onClick={() => setSection(value)}>
            {name}
            {counts && counts[count] > 0 && <span className="count"> ({counts[count]})</span>}
          </button>
        ))}
      </nav>
      {section === "labels" && <LabelReview onChange={onChange} />}
      {section === "disputes" && <DisputeReview onChange={onChange} />}
      {section === "held-back" && <HeldBackReview onChange={onChange} />}
    </main>
  );
}

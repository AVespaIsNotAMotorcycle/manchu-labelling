import { useState } from "react";

import { DisputeReview } from "./DisputeReview.tsx";
import { HeldBackReview } from "./HeldBackReview.tsx";
import { LabelReview } from "./LabelReview.tsx";

const SECTIONS = [
  ["labels", "Labels"],
  ["disputes", "Disputes"],
  ["held-back", "Held-back answers"],
] as const;

type Section = (typeof SECTIONS)[number][0];

/** The work that reviewers and admins do. */
export function Review() {
  const [section, setSection] = useState<Section>("labels");
  return (
    <main>
      <nav className="tabs" aria-label="Review">
        {SECTIONS.map(([value, name]) => (
          <button key={value} type="button" aria-current={section === value} onClick={() => setSection(value)}>
            {name}
          </button>
        ))}
      </nav>
      {section === "labels" && <LabelReview />}
      {section === "disputes" && <DisputeReview />}
      {section === "held-back" && <HeldBackReview />}
    </main>
  );
}

import { useState } from "react";

import { Invites } from "./Invites.tsx";
import { LabelledImages } from "./LabelledImages.tsx";

const SECTIONS = [
  ["labelled", "Labelled images"],
  ["invites", "Invites"],
] as const;

type Section = (typeof SECTIONS)[number][0];

/** The work only admins do. */
export function Admin() {
  const [section, setSection] = useState<Section>("labelled");
  return (
    <main>
      <nav className="tabs" aria-label="Admin">
        {SECTIONS.map(([value, name]) => (
          <button key={value} type="button" aria-current={section === value} onClick={() => setSection(value)}>
            {name}
          </button>
        ))}
      </nav>
      {section === "labelled" && <LabelledImages />}
      {section === "invites" && <Invites />}
    </main>
  );
}

import { manchuForDisplay } from "@manchu-labelling/script";

export function ManchuText({ text, className = "" }: { text: string; className?: string }) {
  return (
    <span className={`manchu ${className}`} lang="mnc">
      {manchuForDisplay(text)}
    </span>
  );
}

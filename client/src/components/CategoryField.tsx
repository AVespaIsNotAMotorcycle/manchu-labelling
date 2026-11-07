import type { ReactNode } from "react";

export const CATEGORIES = [
  ["manchu", "Manchu"],
  ["chinese", "Chinese"],
  ["mongolian", "Mongolian"],
  ["other_script", "Other script"],
  ["non_text", "Not text"],
  ["illegible", "Illegible"],
  ["bad_crop", "Bad crop"],
] as const;

export const categoryName = (value: string): string =>
  CATEGORIES.find(([category]) => category === value)?.[1] ?? value;

export function CategoryField(props: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  children?: ReactNode;
}) {
  return (
    <fieldset disabled={props.disabled}>
      <legend>What is in this image?</legend>
      <div className="choices">
        {CATEGORIES.map(([value, name]) => (
          <label key={value}>
            <input
              type="radio"
              name="category"
              value={value}
              checked={props.value === value}
              onChange={() => props.onChange(value)}
            />
            {name}
          </label>
        ))}
      </div>
      {props.children}
    </fieldset>
  );
}

import type { ReactNode } from "react";

export const CATEGORIES = [
  ["manchu", "Manchu"],
  ["chinese", "Chinese"],
  ["other_script", "Other script"],
  ["non_text", "Not text"],
  ["illegible", "Illegible"],
  ["bad_crop", "Bad crop"],
] as const;

export const categoryName = (value: string): string =>
  CATEGORIES.find(([category]) => category === value)?.[1] ?? value;

const NOT_MANCHU = CATEGORIES.filter(([value]) => value !== "manchu");

/**
 * Asks whether the image is Manchu, and if not, what it is instead. Choosing "Not Manchu" sets the
 * category to "" until the user picks one, so that no answer is chosen for them.
 */
export function CategoryField(props: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  children?: ReactNode;
}) {
  const isManchu = props.value === "manchu";
  return (
    <fieldset disabled={props.disabled}>
      <legend>What is in this image?</legend>
      <div className="choices">
        <label>
          <input
            type="radio"
            name="category"
            value="manchu"
            checked={isManchu}
            onChange={() => props.onChange("manchu")}
          />
          Manchu
        </label>
        <label>
          <input
            type="radio"
            name="category"
            value="not_manchu"
            checked={!isManchu}
            onChange={() => props.onChange("")}
          />
          Not Manchu
        </label>
      </div>
      {!isManchu && (
        <label className="not-manchu">
          What is it?
          <select value={props.value} onChange={(event) => props.onChange(event.target.value)}>
            <option value="" disabled>
              Choose one
            </option>
            {NOT_MANCHU.map(([value, name]) => (
              <option key={value} value={value}>
                {name}
              </option>
            ))}
          </select>
        </label>
      )}
      {props.children}
    </fieldset>
  );
}

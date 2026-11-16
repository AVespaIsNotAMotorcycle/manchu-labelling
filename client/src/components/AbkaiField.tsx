import { abkaiToManchu, manchuToMollendorff } from "@manchu-labelling/script";
import { useEffect, useRef } from "react";

import { clearActiveAbkaiField, setActiveAbkaiField } from "../abkai-input.ts";

export function AbkaiField(props: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoFocus?: boolean;
  disabled?: boolean;
}) {
  const { text, invalid } = abkaiToManchu(props.value);
  const input = useRef<HTMLInputElement>(null);
  const latest = useRef(props);
  latest.current = props;

  // The letter reference types into this field at the cursor, as if the user had typed it.
  const field = useRef({
    insert(addition: string) {
      const element = input.current;
      const { value, onChange } = latest.current;
      const start = element?.selectionStart ?? value.length;
      const end = element?.selectionEnd ?? value.length;
      onChange(value.slice(0, start) + addition + value.slice(end));
      requestAnimationFrame(() => {
        element?.focus();
        element?.setSelectionRange(start + addition.length, start + addition.length);
      });
    },
  });
  useEffect(() => {
    const current = field.current;
    if (props.autoFocus) setActiveAbkaiField(current);
    return () => clearActiveAbkaiField(current);
  }, [props.autoFocus]);

  return (
    <div className="abkai-field">
      <label htmlFor={props.id}>{props.label}</label>
      <input
        ref={input}
        id={props.id}
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        autoFocus={props.autoFocus}
        disabled={props.disabled}
        value={props.value}
        onFocus={() => setActiveAbkaiField(field.current)}
        onChange={(event) => props.onChange(event.target.value)}
      />
      {invalid.length > 0 && <p role="alert">Not Abkai: {invalid.join(" ")}</p>}
      {text && <p className="romanization">Möllendorff: {manchuToMollendorff(text).text}</p>}
    </div>
  );
}

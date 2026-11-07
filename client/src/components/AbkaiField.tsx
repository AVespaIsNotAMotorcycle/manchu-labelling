import { abkaiToManchu, manchuToMollendorff } from "@manchu-labelling/script";

export function AbkaiField(props: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoFocus?: boolean;
  disabled?: boolean;
}) {
  const { text, invalid } = abkaiToManchu(props.value);
  return (
    <div className="abkai-field">
      <label htmlFor={props.id}>{props.label}</label>
      <input
        id={props.id}
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        autoFocus={props.autoFocus}
        disabled={props.disabled}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
      />
      {invalid.length > 0 && <p role="alert">Not Abkai: {invalid.join(" ")}</p>}
      {text && <p className="romanization">Möllendorff: {manchuToMollendorff(text).text}</p>}
    </div>
  );
}

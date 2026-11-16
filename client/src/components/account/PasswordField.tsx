import { passwordProblems } from "@manchu-labelling/passwords";

/** A field for a new password, listing what it still needs as the user types. */
export function NewPasswordField(props: { value: string; onChange: (value: string) => void; label?: string }) {
  const problems = props.value ? passwordProblems(props.value) : [];
  return (
    <label>
      {props.label ?? "New password"}
      <input
        type="password"
        autoComplete="new-password"
        required
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        aria-describedby="password-rules"
      />
      <span id="password-rules" className="hint">
        {problems.length > 0
          ? `Still needs ${problems.join(", ")}.`
          : "At least 12 characters, with upper- and lower-case letters, a number, and a symbol."}
      </span>
    </label>
  );
}

export const isAcceptable = (password: string) => passwordProblems(password).length === 0;

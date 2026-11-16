import { passwordProblems } from "@manchu-labelling/passwords";

import { PasswordInput } from "../PasswordInput.tsx";

/** A field for a new password, listing what it still needs as the user types. */
export function NewPasswordField(props: { value: string; onChange: (value: string) => void; label?: string }) {
  const problems = props.value ? passwordProblems(props.value) : [];
  return (
    <>
      <PasswordInput
        label={props.label ?? "New password"}
        autoComplete="new-password"
        value={props.value}
        onChange={props.onChange}
        describedBy="password-rules"
      />
      <span id="password-rules" className="hint">
        {problems.length > 0
          ? `Still needs ${problems.join(", ")}.`
          : "At least 12 characters, with upper- and lower-case letters, a number, and a symbol."}
      </span>
    </>
  );
}

export const isAcceptable = (password: string) => passwordProblems(password).length === 0;

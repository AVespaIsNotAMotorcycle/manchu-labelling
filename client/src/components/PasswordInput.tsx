import { useId, useState, type ReactNode } from "react";

/**
 * A password field with a button to show what was typed. The button sits outside the label, so the
 * field's name is just its label.
 */
export function PasswordInput(props: {
  label: ReactNode;
  value: string;
  onChange: (value: string) => void;
  autoComplete: "current-password" | "new-password";
  describedBy?: string;
}) {
  const [shown, setShown] = useState(false);
  const id = useId();
  return (
    <div className="password-field">
      <label htmlFor={id}>{props.label}</label>
      <span className="password-row">
        <input
          id={id}
          type={shown ? "text" : "password"}
          autoComplete={props.autoComplete}
          required
          value={props.value}
          aria-describedby={props.describedBy}
          onChange={(event) => props.onChange(event.target.value)}
        />
        <button
          type="button"
          className="secondary"
          aria-pressed={shown}
          aria-label={shown ? "Hide password" : "Show password"}
          onClick={() => setShown(!shown)}
        >
          {shown ? "Hide" : "Show"}
        </button>
      </span>
    </div>
  );
}

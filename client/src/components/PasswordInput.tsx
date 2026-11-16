import { useState, type ReactNode } from "react";

/** A password field with a button to show what was typed. */
export function PasswordInput(props: {
  label: ReactNode;
  value: string;
  onChange: (value: string) => void;
  autoComplete: "current-password" | "new-password";
  describedBy?: string;
}) {
  const [shown, setShown] = useState(false);
  return (
    <label className="password-field">
      {props.label}
      <span className="password-row">
        <input
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
          onClick={() => setShown(!shown)}
        >
          {shown ? "Hide" : "Show"}
        </button>
      </span>
    </label>
  );
}

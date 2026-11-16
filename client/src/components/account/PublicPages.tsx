import { useEffect, useRef, useState, type FormEvent } from "react";

import { forgotPassword, register, resetPassword, verifyEmail } from "../../api.ts";
import { navigate } from "../../navigation.ts";
import { isAcceptable, NewPasswordField } from "./PasswordField.tsx";

function BackToLogIn() {
  return (
    <button type="button" className="link" onClick={() => navigate("/")}>
      Back to log in
    </button>
  );
}

export function Register({ invite }: { invite: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await register(invite, email, password);
      setDone(true);
    } catch (failure) {
      setError((failure as Error).message);
    }
  }

  if (done) {
    return (
      <section className="card">
        <h1>Check your email</h1>
        <p>We have sent a link to {email}. Open it to confirm your address, and then you can log in.</p>
        <BackToLogIn />
      </section>
    );
  }
  return (
    <form className="card" onSubmit={submit}>
      <h1>Join Manchu Labelling</h1>
      <p>You have been invited to help label word images from historical Manchu books.</p>
      <label>
        Email
        <input type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} />
      </label>
      <NewPasswordField label="Password" value={password} onChange={setPassword} />
      {error && <p role="alert">{error}</p>}
      <button type="submit" disabled={!isAcceptable(password)}>
        Create account
      </button>
      <BackToLogIn />
    </form>
  );
}

export function VerifyEmail({ token }: { token: string }) {
  const [state, setState] = useState<"working" | "done" | string>("working");
  // A link works once, so it must only be sent once, even when React runs effects twice in development.
  const sent = useRef(false);
  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    verifyEmail(token)
      .then(() => setState("done"))
      .catch((failure: Error) => setState(failure.message));
  }, [token]);
  return (
    <section className="card">
      <h1>Confirm your email</h1>
      {state === "working" && <p className="status">Confirming…</p>}
      {state === "done" && <p>Thank you. Your email is confirmed, and you can log in now.</p>}
      {state !== "working" && state !== "done" && <p role="alert">{state}</p>}
      <BackToLogIn />
    </section>
  );
}

export function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await forgotPassword(email);
      setSent(true);
    } catch (failure) {
      setError((failure as Error).message);
    }
  }

  return (
    <form className="card" onSubmit={submit}>
      <h1>Reset your password</h1>
      {sent ? (
        <p role="status">If {email} has an account, we have sent it a link to reset the password.</p>
      ) : (
        <>
          <label>
            Email
            <input type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} />
          </label>
          {error && <p role="alert">{error}</p>}
          <button type="submit">Send a reset link</button>
        </>
      )}
      <BackToLogIn />
    </form>
  );
}

export function ResetPassword({ token }: { token: string }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await resetPassword(token, password);
      setDone(true);
    } catch (failure) {
      setError((failure as Error).message);
    }
  }

  return (
    <form className="card" onSubmit={submit}>
      <h1>Choose a new password</h1>
      {done ? (
        <p role="status">Your password has changed. Any other sessions have been logged out.</p>
      ) : (
        <>
          <NewPasswordField value={password} onChange={setPassword} />
          {error && <p role="alert">{error}</p>}
          <button type="submit" disabled={!isAcceptable(password)}>
            Save the new password
          </button>
        </>
      )}
      <BackToLogIn />
    </form>
  );
}

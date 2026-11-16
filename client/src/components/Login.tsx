import { useState, type FormEvent } from "react";

import { ApiError, logIn, logInWithCode, resendVerification, type Account } from "../api.ts";
import { navigate } from "../navigation.ts";

type Step = "password" | "code" | "unverified";

export function Login({ onLogIn }: { onLogIn: (account: Account) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<Step>("password");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      if (step === "code") {
        onLogIn(await logInWithCode(code));
        return;
      }
      const result = await logIn(email, password);
      if ("twoFactor" in result && result.twoFactor === true && !("email" in result)) setStep("code");
      else onLogIn(result as Account);
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 403) setStep("unverified");
      else setError((failure as Error).message);
    }
  }

  async function resend() {
    setError("");
    try {
      await resendVerification(email);
      setNotice("We have sent a new link. Please check your email.");
    } catch (failure) {
      setError((failure as Error).message);
    }
  }

  if (step === "unverified") {
    return (
      <section className="card">
        <h1>Confirm your email</h1>
        <p>Please open the link we emailed to {email} to confirm your address, then log in again.</p>
        {notice && <p role="status">{notice}</p>}
        {error && <p role="alert">{error}</p>}
        <button type="button" onClick={resend}>
          Send the link again
        </button>
        <button type="button" className="link" onClick={() => setStep("password")}>
          Back to log in
        </button>
      </section>
    );
  }

  return (
    <form className="card" onSubmit={submit}>
      <h1>Manchu Labelling</h1>
      {step === "password" ? (
        <>
          <label>
            Email
            <input
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <label>
            Password
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
        </>
      ) : (
        <label>
          Code from your authenticator app, or a recovery code
          <input
            autoComplete="one-time-code"
            inputMode="text"
            required
            autoFocus
            value={code}
            onChange={(event) => setCode(event.target.value)}
          />
        </label>
      )}
      {error && <p role="alert">{error}</p>}
      <button type="submit">{step === "code" ? "Continue" : "Log in"}</button>
      {step === "password" && (
        <button type="button" className="link" onClick={() => navigate("/forgot-password")}>
          Forgot your password?
        </button>
      )}
    </form>
  );
}

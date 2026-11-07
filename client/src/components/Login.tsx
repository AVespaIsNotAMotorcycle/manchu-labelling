import { useState, type FormEvent } from "react";

import { logIn, type Account } from "../api.ts";

export function Login({ onLogIn }: { onLogIn: (account: Account) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      onLogIn(await logIn(email, password));
    } catch (failure) {
      setError((failure as Error).message);
    }
  }

  return (
    <form className="card" onSubmit={submit}>
      <h1>Manchu Labelling</h1>
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
      {error && <p role="alert">{error}</p>}
      <button type="submit">Log in</button>
    </form>
  );
}

import { useEffect, useState } from "react";

import { acceptLicense, getAccount, logOut, type Account } from "./api.ts";
import { Labelling } from "./components/Labelling.tsx";
import { LicensePrompt } from "./components/LicensePrompt.tsx";
import { Login } from "./components/Login.tsx";

export function App() {
  const [account, setAccount] = useState<Account | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getAccount()
      .then(setAccount)
      .catch(() => setAccount(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="status">Loading…</p>;
  if (!account) return <Login onLogIn={setAccount} />;

  return (
    <>
      <header className="top-bar">
        <strong>Manchu Labelling</strong>
        <span>
          {account.email}{" "}
          <button
            type="button"
            className="link"
            onClick={() => logOut().then(() => setAccount(null))}
          >
            Log out
          </button>
        </span>
      </header>
      {account.licenseAccepted ? (
        <Labelling />
      ) : (
        <LicensePrompt onAccept={() => acceptLicense().then(setAccount)} />
      )}
    </>
  );
}

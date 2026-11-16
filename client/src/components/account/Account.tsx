import QRCode from "qrcode";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";

import {
  changePassword,
  deleteAccount,
  disableTwoFactor,
  enableTwoFactor,
  getProfile,
  newRecoveryCodes,
  setCreditName,
  startTwoFactor,
  type Account as AccountData,
} from "../../api.ts";
import { PasswordInput as ShownPasswordInput } from "../PasswordInput.tsx";
import { isAcceptable, NewPasswordField } from "./PasswordField.tsx";

/** A small form that shows its own error and success messages. */
function ActionForm(props: {
  submitLabel: string;
  disabled?: boolean;
  danger?: boolean;
  onSubmit: () => Promise<string | void>;
  children: ReactNode;
}) {
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      setMessage((await props.onSubmit()) ?? "");
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="account-form" onSubmit={submit}>
      {props.children}
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      <div className="actions">
        <button type="submit" className={props.danger ? "danger" : undefined} disabled={busy || props.disabled}>
          {props.submitLabel}
        </button>
      </div>
    </form>
  );
}

function PasswordInput(props: { value: string; onChange: (value: string) => void; label?: string }) {
  return (
    <ShownPasswordInput
      label={props.label ?? "Your password"}
      autoComplete="current-password"
      value={props.value}
      onChange={props.onChange}
    />
  );
}

/** Lets the user opt in to being credited by name in releases, or opt out again. */
function CreditName() {
  const [name, setName] = useState("");
  const [saved, setSaved] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    getProfile().then(({ creditName }) => {
      setSaved(creditName);
      setName(creditName ?? "");
    });
  }, []);

  return (
    <section>
      <h2>Credit</h2>
      <p className="hint">
        Releases list contributors who ask to be named. Names are listed on their own and are not linked
        to your labels or your accuracy. A name in a past release stays there.
      </p>
      <ActionForm
        submitLabel="Save"
        disabled={saved === undefined || (name.trim() || null) === saved}
        onSubmit={async () => {
          const result = await setCreditName(name.trim() || null);
          setSaved(result.creditName);
          setName(result.creditName ?? "");
          return result.creditName ? `You will be credited as ${result.creditName}.` : "You will not be credited by name.";
        }}
      >
        <label>
          Name to credit (leave empty to stay anonymous)
          <input value={name} maxLength={100} onChange={(event) => setName(event.target.value)} />
        </label>
        <p className="hint">{saved ? `Currently credited as ${saved}.` : "Currently not credited by name."}</p>
      </ActionForm>
    </section>
  );
}

function ChangePassword() {
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  return (
    <section>
      <h2>Password</h2>
      <ActionForm
        submitLabel="Change password"
        disabled={!isAcceptable(password)}
        onSubmit={async () => {
          await changePassword(current, password);
          setCurrent("");
          setPassword("");
          return "Your password has changed. Your other sessions have been logged out.";
        }}
      >
        <PasswordInput label="Current password" value={current} onChange={setCurrent} />
        <NewPasswordField value={password} onChange={setPassword} />
      </ActionForm>
    </section>
  );
}

function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  return (
    <div className="recovery-codes">
      <p>
        <strong>Save these recovery codes somewhere safe.</strong> Each one lets you log in once if you lose
        your device. They will not be shown again.
      </p>
      <ul>
        {codes.map((code) => (
          <li key={code}>
            <code>{code}</code>
          </li>
        ))}
      </ul>
      <button type="button" onClick={onDone}>
        I have saved them
      </button>
    </div>
  );
}

function TwoFactor({ account, onChange }: { account: AccountData; onChange: () => void }) {
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [setup, setSetup] = useState<{ secret: string; uri: string; qr: string } | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);

  if (codes) {
    return (
      <section>
        <h2>Two-factor authentication</h2>
        <RecoveryCodes
          codes={codes}
          onDone={() => {
            setCodes(null);
            onChange();
          }}
        />
      </section>
    );
  }

  if (account.twoFactor) {
    return (
      <section>
        <h2>Two-factor authentication</h2>
        <p>Two-factor authentication is on. You need a code from your authenticator app to log in.</p>
        <PasswordInput value={password} onChange={setPassword} />
        <ActionForm
          submitLabel="Make new recovery codes"
          onSubmit={async () => {
            setCodes((await newRecoveryCodes(password)).recoveryCodes);
            setPassword("");
          }}
        >
          <p className="hint">This replaces your old recovery codes.</p>
        </ActionForm>
        <ActionForm
          submitLabel="Turn off two-factor authentication"
          danger
          onSubmit={async () => {
            await disableTwoFactor(password, code);
            setPassword("");
            setCode("");
            onChange();
          }}
        >
          <label>
            A code from your app, or a recovery code
            <input autoComplete="one-time-code" value={code} onChange={(event) => setCode(event.target.value)} />
          </label>
          {account.role !== "labeler" && (
            <p className="hint">Reviewers and admins cannot use their tools without it.</p>
          )}
        </ActionForm>
      </section>
    );
  }

  return (
    <section>
      <h2>Two-factor authentication</h2>
      <p>
        Two-factor authentication asks for a code from an app on your phone, such as an authenticator app,
        each time you log in. {account.role !== "labeler" ? "Reviewers and admins must use it." : ""}
      </p>
      {setup ? (
        <ActionForm
          submitLabel="Turn on"
          onSubmit={async () => {
            setCodes((await enableTwoFactor(code)).recoveryCodes);
            setSetup(null);
            setCode("");
          }}
        >
          <p>Scan this code with your authenticator app, or type the key into it.</p>
          <img className="qr" src={setup.qr} alt="A QR code to scan with your authenticator app" />
          <p>
            Key: <code className="secret">{setup.secret.match(/.{1,4}/g)?.join(" ")}</code>
          </p>
          <label>
            The 6-digit code the app shows
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
          </label>
        </ActionForm>
      ) : (
        <ActionForm
          submitLabel="Set up two-factor authentication"
          onSubmit={async () => {
            const result = await startTwoFactor(password);
            setSetup({ ...result, qr: await QRCode.toDataURL(result.uri, { margin: 1, width: 200 }) });
            setPassword("");
          }}
        >
          <PasswordInput value={password} onChange={setPassword} />
        </ActionForm>
      )}
    </section>
  );
}

function DeleteAccount({ onDeleted }: { onDeleted: () => void }) {
  const [password, setPassword] = useState("");
  return (
    <section>
      <h2>Delete your account</h2>
      <p className="hint">
        This removes your email, password, and credit name, and logs you out. The labels you made stay in
        the dataset without your name, since they are already shared under CC BY 4.0. This cannot be
        undone.
      </p>
      <ActionForm
        submitLabel="Delete my account"
        danger
        onSubmit={async () => {
          if (!window.confirm("Delete your account? This cannot be undone.")) return;
          await deleteAccount(password);
          onDeleted();
        }}
      >
        <PasswordInput label="Your password, to confirm" value={password} onChange={setPassword} />
      </ActionForm>
    </section>
  );
}

export function Account(props: { account: AccountData; onChange: () => void; onDeleted: () => void }) {
  return (
    <main className="account">
      {props.account.twoFactorRequired && (
        <p className="notice" role="status">
          Reviewers and admins must turn on two-factor authentication before using their tools.
        </p>
      )}
      <TwoFactor account={props.account} onChange={props.onChange} />
      <ChangePassword />
      <CreditName />
      <DeleteAccount onDeleted={props.onDeleted} />
    </main>
  );
}

import { useEffect, useState } from "react";

import {
  acceptLicense,
  getAccount,
  getTrainingStatus,
  logOut,
  type Account,
  type TrainingStatus,
} from "./api.ts";
import { Account as AccountPage } from "./components/account/Account.tsx";
import { ForgotPassword, Register, ResetPassword, VerifyEmail } from "./components/account/PublicPages.tsx";
import { FontPicker } from "./components/FontPicker.tsx";
import { Invites } from "./components/Invites.tsx";
import { Labelling } from "./components/Labelling.tsx";
import { LicensePrompt } from "./components/LicensePrompt.tsx";
import { Login } from "./components/Login.tsx";
import { Profile } from "./components/Profile.tsx";
import { Reference } from "./components/Reference.tsx";
import { Review } from "./components/Review.tsx";
import { Training } from "./components/Training.tsx";
import { navigate, useLocation } from "./navigation.ts";

type View = "label" | "train" | "progress" | "review" | "admin" | "account";

function Workspace(props: {
  account: Account;
  onAccountChange: () => void;
  onDeleted: () => void;
  status: TrainingStatus;
  view: View | null;
  onViewChange: (view: View) => void;
  onQualified: () => void;
  onStatusChange: () => void;
}) {
  const { status, onViewChange, onQualified, onStatusChange } = props;
  const canReview = props.account.role === "admin" || props.account.role === "reviewer";
  const isAdmin = props.account.role === "admin";
  const canLabel = status.qualified.length > 0;
  const view = props.view ?? (canLabel ? "label" : "train");
  const scriptClass = status.classes[0]?.scriptClass;

  return (
    <div className="workspace">
      <div className="work">
        <nav className="tabs" aria-label="Work">
          <button
            type="button"
            aria-current={view === "label"}
            disabled={!canLabel}
            title={canLabel ? undefined : "Complete training to start labelling"}
            onClick={() => onViewChange("label")}
          >
            Label
          </button>
          <button type="button" aria-current={view === "train"} onClick={() => onViewChange("train")}>
            Training
          </button>
          <button type="button" aria-current={view === "progress"} onClick={() => onViewChange("progress")}>
            Progress
          </button>
          {canReview && (
            <button type="button" aria-current={view === "review"} onClick={() => onViewChange("review")}>
              Review
            </button>
          )}
          {isAdmin && (
            <button type="button" aria-current={view === "admin"} onClick={() => onViewChange("admin")}>
              Admin
            </button>
          )}
        </nav>
        {props.account.twoFactorRequired && view !== "account" && (canReview || isAdmin) && (
          <p className="notice" role="status">
            Reviewers and admins must turn on two-factor authentication before using their tools.{" "}
            <button type="button" className="link" onClick={() => onViewChange("account")}>
              Set it up in your account
            </button>
          </p>
        )}
        {view === "label" && (
          <Labelling
            onNotQualified={() => {
              onStatusChange();
              onViewChange("train");
            }}
          />
        )}
        {view === "progress" && <Profile />}
        {view === "review" && canReview && <Review />}
        {view === "admin" && isAdmin && <Invites />}
        {view === "account" && (
          <AccountPage account={props.account} onChange={props.onAccountChange} onDeleted={props.onDeleted} />
        )}
        {view === "train" &&
          (scriptClass ? (
            <Training scriptClass={scriptClass} onQualified={onQualified} onReset={onStatusChange} />
          ) : (
            <p className="status">There are no quizzes yet.</p>
          ))}
      </div>
      <Reference />
    </div>
  );
}

/** Pages reached from links in emails, shown whether or not someone is logged in. */
function PublicPage({ location }: { location: URL }) {
  const token = location.searchParams.get("token") ?? "";
  switch (location.pathname) {
    case "/register":
      return <Register invite={location.searchParams.get("invite") ?? ""} />;
    case "/verify-email":
      return <VerifyEmail token={token} />;
    case "/forgot-password":
      return <ForgotPassword />;
    case "/reset-password":
      return <ResetPassword token={token} />;
    default:
      return null;
  }
}

const PUBLIC_PATHS = new Set(["/register", "/verify-email", "/forgot-password", "/reset-password"]);

export function App() {
  const location = useLocation();
  const [account, setAccount] = useState<Account | null>(null);
  const [loading, setLoading] = useState(true);
  const [training, setTraining] = useState<TrainingStatus | null>(null);
  const [view, setView] = useState<View | null>(null);

  useEffect(() => {
    getAccount()
      .then(setAccount)
      .catch(() => setAccount(null))
      .finally(() => setLoading(false));
  }, []);

  const licenseAccepted = account?.licenseAccepted;
  useEffect(() => {
    if (!licenseAccepted) return;
    getTrainingStatus().then(setTraining);
  }, [licenseAccepted]);

  function signedOut() {
    setAccount(null);
    setTraining(null);
    setView(null);
  }

  if (PUBLIC_PATHS.has(location.pathname)) return <PublicPage location={location} />;
  if (loading) return <p className="status">Loading…</p>;
  if (!account) {
    return (
      <Login
        onLogIn={(next) => {
          setAccount(next);
          navigate("/");
        }}
      />
    );
  }

  return (
    <>
      <header className="top-bar">
        <strong>Manchu Labelling</strong>
        <FontPicker />
        <span>
          {account.email}{" "}
          {account.licenseAccepted && (
            <button type="button" className="link" onClick={() => setView("account")}>
              Account
            </button>
          )}{" "}
          <button type="button" className="link" onClick={() => logOut().then(signedOut)}>
            Log out
          </button>
        </span>
      </header>
      {!account.licenseAccepted && (
        <LicensePrompt onAccept={() => acceptLicense().then(setAccount)} />
      )}
      {account.licenseAccepted && !training && <p className="status">Loading…</p>}
      {account.licenseAccepted && training && (
        <Workspace
          account={account}
          onAccountChange={() => {
            getAccount().then(setAccount);
          }}
          onDeleted={signedOut}
          status={training}
          view={view}
          onViewChange={setView}
          onStatusChange={() => {
            getTrainingStatus().then(setTraining);
          }}
          onQualified={() => {
            getTrainingStatus().then((status) => {
              setTraining(status);
              setView("label");
            });
          }}
        />
      )}
    </>
  );
}

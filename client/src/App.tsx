import { useEffect, useState } from "react";

import {
  acceptLicense,
  getAccount,
  getTrainingStatus,
  logOut,
  type Account,
  type TrainingStatus,
} from "./api.ts";
import { FontPicker } from "./components/FontPicker.tsx";
import { Labelling } from "./components/Labelling.tsx";
import { LicensePrompt } from "./components/LicensePrompt.tsx";
import { Login } from "./components/Login.tsx";
import { Training } from "./components/Training.tsx";

function Workspace(props: {
  status: TrainingStatus;
  view: "label" | "train" | null;
  onViewChange: (view: "label" | "train") => void;
  onQualified: () => void;
}) {
  const { status, onViewChange, onQualified } = props;
  const canLabel = status.qualified.length > 0;
  const view = props.view ?? (canLabel ? "label" : "train");
  const scriptClass = status.classes[0]?.scriptClass;

  return (
    <>
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
      </nav>
      {view === "label" && <Labelling />}
      {view === "train" &&
        (scriptClass ? (
          <Training scriptClass={scriptClass} onQualified={onQualified} />
        ) : (
          <p className="status">There are no quizzes yet.</p>
        ))}
    </>
  );
}

export function App() {
  const [account, setAccount] = useState<Account | null>(null);
  const [loading, setLoading] = useState(true);
  const [training, setTraining] = useState<TrainingStatus | null>(null);
  const [view, setView] = useState<"label" | "train" | null>(null);

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

  if (loading) return <p className="status">Loading…</p>;
  if (!account) return <Login onLogIn={setAccount} />;

  return (
    <>
      <header className="top-bar">
        <strong>Manchu Labelling</strong>
        <FontPicker />
        <span>
          {account.email}{" "}
          <button
            type="button"
            className="link"
            onClick={() =>
              logOut().then(() => {
                setAccount(null);
                setTraining(null);
                setView(null);
              })
            }
          >
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
          status={training}
          view={view}
          onViewChange={setView}
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

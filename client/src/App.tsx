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
import { Profile } from "./components/Profile.tsx";
import { Reference } from "./components/Reference.tsx";
import { Review } from "./components/Review.tsx";
import { Training } from "./components/Training.tsx";

type View = "label" | "train" | "progress" | "review";

function Workspace(props: {
  canReview: boolean;
  status: TrainingStatus;
  view: View | null;
  onViewChange: (view: View) => void;
  onQualified: () => void;
  onStatusChange: () => void;
}) {
  const { status, onViewChange, onQualified, onStatusChange } = props;
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
          {props.canReview && (
            <button type="button" aria-current={view === "review"} onClick={() => onViewChange("review")}>
              Review
            </button>
          )}
        </nav>
        {view === "label" && (
          <Labelling
            onNotQualified={() => {
              onStatusChange();
              onViewChange("train");
            }}
          />
        )}
        {view === "progress" && <Profile />}
        {view === "review" && props.canReview && <Review />}
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

export function App() {
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
          canReview={account.role === "admin" || account.role === "reviewer"}
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

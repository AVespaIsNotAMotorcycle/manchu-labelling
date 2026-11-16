import { useCallback, useEffect, useState } from "react";

import { getProfile, setCreditName, type DisputeStatus, type PastCheck, type Profile as ProfileData } from "../api.ts";
import { AnswerText } from "./AnswerText.tsx";
import { DisputeForm } from "./DisputeForm.tsx";

const percent = (value: number) => `${Math.round(value * 1000) / 10}%`;

const OUTCOMES: Record<DisputeStatus, string> = {
  open: "Waiting for a reviewer",
  upheld: "Reviewed: the answer stands",
  corrected: "Reviewed: the answer was corrected",
  withdrawn: "Reviewed: the image no longer counts",
};

const CLASS_NAMES: Record<string, string> = {
  regular: "Regular script",
  running: "Running script",
  memorial: "Memorial script",
  seal: "Seal script",
  other: "Other script",
};

function PastCheckRow({ check, onDisputed }: { check: PastCheck; onDisputed: () => void }) {
  const [disputing, setDisputing] = useState(false);
  return (
    <li className="past-check">
      <img className="thumbnail" src={check.imageUrl} alt="A past test image" />
      <dl>
        <dt>You said</dt>
        <dd>
          <AnswerText answer={check.label} />
        </dd>
        <dt>Expected</dt>
        <dd>
          <AnswerText answer={check.answer} />
        </dd>
      </dl>
      <div className="past-check-result">
        <p className={check.passed ? "result right" : "result wrong"}>
          {check.passed ? "Correct" : `Not quite (${percent(check.accuracy)} of letters)`}
        </p>
        {check.dispute ? (
          <p className="hint">{OUTCOMES[check.dispute]}</p>
        ) : disputing ? (
          <DisputeForm
            kind="check"
            id={check.id}
            initial={{ category: check.label.category, abkai: check.label.abkai }}
            onCancel={() => setDisputing(false)}
            onDone={onDisputed}
          />
        ) : (
          <button type="button" className="secondary" onClick={() => setDisputing(true)}>
            Dispute
          </button>
        )}
      </div>
    </li>
  );
}

/** Lets the user opt in to being credited by name in releases, or opt out again. */
function CreditName({ initial }: { initial: string | null }) {
  const [name, setName] = useState(initial ?? "");
  const [saved, setSaved] = useState(initial);
  const [error, setError] = useState("");

  async function save(next: string | null) {
    setError("");
    try {
      const result = await setCreditName(next);
      setSaved(result.creditName);
      setName(result.creditName ?? "");
    } catch (failure) {
      setError((failure as Error).message);
    }
  }

  return (
    <section className="credit">
      <h2>Credit</h2>
      <p className="hint">
        Releases list contributors who ask to be named. Names are listed on their own and are not linked
        to your labels or your accuracy. A name in a past release stays there.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          save(name.trim() || null);
        }}
      >
        <label>
          Name to credit
          <input value={name} maxLength={100} onChange={(event) => setName(event.target.value)} />
        </label>
        {error && <p role="alert">{error}</p>}
        <div className="actions">
          <button type="submit" disabled={(name.trim() || null) === saved}>
            Save
          </button>
          {saved && (
            <button type="button" className="secondary" onClick={() => save(null)}>
              Do not credit me
            </button>
          )}
        </div>
        <p className="hint" role="status">
          {saved ? `You will be credited as ${saved}.` : "You will not be credited by name."}
        </p>
      </form>
    </section>
  );
}

/**
 * The user's accuracy on hidden checks and their past test images, each of which can be disputed.
 * Images only appear after the user has labelled 25 more, so this cannot reveal a check in a session.
 */
export function Profile() {
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    getProfile()
      .then(setProfile)
      .catch((failure: Error) => setError(failure.message));
  }, []);
  useEffect(load, [load]);

  if (error) return <p role="alert">{error}</p>;
  if (!profile) return <p className="status">Loading…</p>;

  return (
    <main className="profile">
      <h2>Your accuracy</h2>
      <p className="hint">
        Some images have answers we already know. They appear here after you have labelled 25 more
        images, so that you cannot tell which ones they were while you work.
      </p>
      {profile.accuracy.length === 0 ? (
        <p>No test images to show yet.</p>
      ) : (
        <table className="accuracy">
          <thead>
            <tr>
              <th scope="col">Script</th>
              <th scope="col">Test images</th>
              <th scope="col">Exactly right</th>
              <th scope="col">Letters right</th>
            </tr>
          </thead>
          <tbody>
            {profile.accuracy.map((row) => (
              <tr key={row.scriptClass}>
                <th scope="row">{CLASS_NAMES[row.scriptClass] ?? row.scriptClass}</th>
                <td>{row.answered}</td>
                <td>{percent(row.passed / row.answered)}</td>
                <td>{percent(row.accuracy)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {profile.checks.length > 0 && (
        <>
          <h2>Past test images</h2>
          <p className="hint">
            If you think an expected answer is wrong, dispute it. A reviewer will look, and if they agree
            your accuracy is worked out again.
          </p>
          <ul className="past-checks">
            {profile.checks.map((check) => (
              <PastCheckRow key={check.id} check={check} onDisputed={load} />
            ))}
          </ul>
        </>
      )}

      {profile.disputes.length > 0 && (
        <>
          <h2>Your disputes</h2>
          <ul className="past-checks">
            {profile.disputes.map((dispute) => (
              <li key={dispute.id} className="past-check">
                <img className="thumbnail" src={dispute.imageUrl} alt="A disputed image" />
                <dl>
                  <dt>{dispute.kind === "quiz" ? "Quiz answer" : "Expected"}</dt>
                  <dd>
                    <AnswerText answer={dispute.answer} />
                  </dd>
                  <dt>You suggested</dt>
                  <dd>
                    <AnswerText answer={dispute.proposed} />
                  </dd>
                </dl>
                <div className="past-check-result">
                  <p>{OUTCOMES[dispute.outcome]}</p>
                  {dispute.reviewerNote && <p className="hint">Reviewer: {dispute.reviewerNote}</p>}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      <CreditName initial={profile.creditName} />
    </main>
  );
}

import { abkaiToManchu } from "@manchu-labelling/script";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

import {
  ApiError,
  changeLabel,
  getLastLabel,
  getNextImage,
  getUpcomingImage,
  submitLabel,
  type Label,
  type LabelImage,
  type LastLabel,
} from "../api.ts";
import { AbkaiField } from "./AbkaiField.tsx";
import { CategoryField } from "./CategoryField.tsx";
import { CropImage, CropViewControls, useCropView, type CropView } from "./CropImage.tsx";
import { ManchuText } from "./ManchuText.tsx";
import { PageView } from "./PageView.tsx";

const PRODUCTION = [
  ["manuscript", "Manuscript"],
  ["woodblock", "Woodblock"],
  ["movable_type", "Movable type"],
  ["other", "Other"],
] as const;

const SCRIPT = [
  ["regular", "Regular"],
  ["running", "Running"],
  ["memorial", "Memorial"],
  ["seal", "Seal"],
  ["other", "Other"],
] as const;

/** After this many images in a session, the user is reminded that a break helps accuracy. */
const BREAK_EVERY = 50;
const SESSION_KEY = "labelled-this-session";

const confidence = (unsure: boolean) => (unsure ? "unconfident" : "confident");

/** Keys pressed with Alt, so that they never clash with typing Abkai. */
const SHORTCUTS: [string, string][] = [
  ["Enter", "Save and go to the next image"],
  ["Alt+M", "Manchu"],
  ["Alt+N", "Not Manchu"],
  ["Alt+U", "Not sure about this answer"],
  ["Alt+P", "Show the page larger, or smaller"],
  ["Alt+Z", "Change your last answer"],
  ["Alt+= and Alt+−", "Zoom in and out"],
];

function readSessionCount(): number {
  try {
    return Number(sessionStorage.getItem(SESSION_KEY)) || 0;
  } catch {
    return 0;
  }
}

function LabelForm(props: {
  image: LabelImage;
  /** A previous answer to start from, when changing it. */
  initial?: LastLabel["label"];
  submitLabel: string;
  onSubmit: (label: Label) => Promise<void>;
  onCancel?: () => void;
  view: CropView;
  onViewChange: (view: CropView) => void;
}) {
  const { image, initial, view } = props;
  const [category, setCategory] = useState(initial?.category ?? "manchu");
  const [transcription, setTranscription] = useState(initial?.transcription ?? "");
  const [intendedWord, setIntendedWord] = useState(initial?.intendedWord ?? "");
  const [production, setProduction] = useState(initial?.production ?? image.style.production);
  const [script, setScript] = useState(initial?.script ?? image.style.script);
  const [unsureCategory, setUnsureCategory] = useState(initial?.confidence?.category === "unconfident");
  const [unsureTranscription, setUnsureTranscription] = useState(
    initial?.confidence?.transcription === "unconfident",
  );
  const [unsureStyle, setUnsureStyle] = useState(initial?.confidence?.style === "unconfident");
  const [largePage, setLargePage] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const form = useRef<HTMLFormElement>(null);

  const isManchu = category === "manchu";
  const preview = abkaiToManchu(transcription);
  const intended = abkaiToManchu(intendedWord);
  const invalid = isManchu && (preview.invalid.length > 0 || intended.invalid.length > 0);
  const ready = !invalid && (isManchu ? preview.text !== "" : category !== "");

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    try {
      await props.onSubmit({
        category,
        ...(isManchu ? { transcription } : {}),
        ...(isManchu && intendedWord ? { intendedWord } : {}),
        ...(production !== image.style.production ? { production } : {}),
        ...(script !== image.style.script ? { script } : {}),
        confidence: {
          category: confidence(unsureCategory),
          transcription: confidence(unsureTranscription),
          style: confidence(unsureStyle),
        },
      });
    } catch (failure) {
      setError((failure as Error).message);
      setBusy(false);
    }
  }

  // Shortcuts use Alt, so that they never clash with typing Abkai into a field.
  const submitRef = useRef(submit);
  submitRef.current = submit;
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        submitRef.current();
        return;
      }
      if (!event.altKey || event.ctrlKey || event.metaKey) return;
      const action: Record<string, () => void> = {
        KeyM: () => setCategory("manchu"),
        KeyN: () => {
          setCategory("");
          requestAnimationFrame(() => form.current?.querySelector<HTMLSelectElement>(".not-manchu select")?.focus());
        },
        KeyU: () =>
          category === "manchu" ? setUnsureTranscription((value) => !value) : setUnsureCategory((value) => !value),
        KeyP: () => setLargePage((value) => !value),
        Equal: () => props.onViewChange({ ...view, zoom: Math.min(3, view.zoom * 1.25) }),
        Minus: () => props.onViewChange({ ...view, zoom: Math.max(0.5, view.zoom / 1.25) }),
      };
      const run = action[event.code];
      if (run) {
        event.preventDefault();
        run();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [category, view, props]);

  return (
    <form className="labelling" onSubmit={submit} ref={form}>
      <div className="comparison">
        <figure>
          <figcaption>Image</figcaption>
          <CropImage src={image.imageUrl} alt="The word to label" view={view} />
          <CropViewControls view={view} onChange={props.onViewChange} />
        </figure>
        {/* Kept when the image is not Manchu, so that the fields do not move. */}
        <figure>
          <figcaption>Your reading</figcaption>
          <ManchuText text={isManchu ? preview.text : ""} className="preview" />
        </figure>
        <figure className="page-thumbnail">
          <figcaption>
            On the page{" "}
            <button type="button" className="link" onClick={() => setLargePage(!largePage)}>
              {largePage ? "smaller" : "larger"}
            </button>
          </figcaption>
          {!largePage && <PageView imageId={image.id} small />}
        </figure>
      </div>

      <div className="fields">
        {initial && <p className="notice">You are changing your last answer.</p>}
        <CategoryField value={category} onChange={setCategory}>
          <label className="unsure">
            <input
              type="checkbox"
              checked={unsureCategory}
              onChange={(event) => setUnsureCategory(event.target.checked)}
            />
            Not sure
          </label>
        </CategoryField>

        {isManchu && (
          <>
            <AbkaiField
              id="transcription"
              label="What is written (Abkai)"
              value={transcription}
              onChange={setTranscription}
              autoFocus
            />
            <p className="hint">
              Type exactly what is written. Use ? for a letter you cannot read. You can also click a letter in
              the letter forms to type it.
            </p>
            <label className="unsure">
              <input
                type="checkbox"
                checked={unsureTranscription}
                onChange={(event) => setUnsureTranscription(event.target.checked)}
              />
              Not sure
            </label>
            <details open={Boolean(initial?.intendedWord)}>
              <summary>The intended word is different</summary>
              <AbkaiField id="intended" label="Intended word (Abkai)" value={intendedWord} onChange={setIntendedWord} />
            </details>
          </>
        )}

        <details open>
          <summary>
            Style: {production.replace("_", " ")}, {script}
          </summary>
          <label>
            Production
            <select value={production} onChange={(event) => setProduction(event.target.value)}>
              {PRODUCTION.map(([value, name]) => (
                <option key={value} value={value}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Script
            <select value={script} onChange={(event) => setScript(event.target.value)}>
              {SCRIPT.map(([value, name]) => (
                <option key={value} value={value}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label className="unsure">
            <input type="checkbox" checked={unsureStyle} onChange={(event) => setUnsureStyle(event.target.checked)} />
            Not sure
          </label>
        </details>

        {error && <p role="alert">{error}</p>}
        <div className="actions">
          <button type="submit" disabled={!ready || busy}>
            {props.submitLabel}
          </button>
          {props.onCancel && (
            <button type="button" className="secondary" onClick={props.onCancel}>
              Cancel
            </button>
          )}
        </div>
        <details className="shortcuts">
          <summary>Keyboard shortcuts</summary>
          <dl>
            {SHORTCUTS.map(([keys, action]) => (
              <div key={keys}>
                <dt>
                  <kbd>{keys}</kbd>
                </dt>
                <dd>{action}</dd>
              </div>
            ))}
          </dl>
        </details>
      </div>

      {largePage && <PageView imageId={image.id} />}
    </form>
  );
}

/**
 * Shows one image at a time. The next image is fetched and its crop loaded while the user labels the
 * current one, so that saving moves straight on. For 30 minutes after an answer, the user can go back
 * and change it. `onNotQualified` is called if the user can no longer label, so that the app can send
 * them to training.
 */
export function Labelling({ onNotQualified }: { onNotQualified: () => void }) {
  const [image, setImage] = useState<LabelImage | null | undefined>(undefined);
  const [error, setError] = useState("");
  const [view, setView] = useCropView();
  const [changing, setChanging] = useState<LastLabel | null>(null);
  const [lastSaved, setLastSaved] = useState<number | null>(null);
  const [count, setCount] = useState(readSessionCount);
  const [breakDismissed, setBreakDismissed] = useState(0);
  const [announcement, setAnnouncement] = useState("");
  const upcoming = useRef<LabelImage | null>(null);
  /** Counts requests for the next image, so that an answer that arrives too late is ignored. */
  const generation = useRef(0);

  function fail(failure: Error) {
    if (failure instanceof ApiError && failure.status === 403) onNotQualified();
    else setError(failure.message);
  }

  function prepareUpcoming(current: LabelImage) {
    upcoming.current = null;
    const mine = ++generation.current;
    getUpcomingImage()
      .then(({ image: next }) => {
        if (mine !== generation.current || next?.id === current.id) return;
        upcoming.current = next;
        // Loading the crop now means the browser has it by the time it is shown.
        if (next) new Image().src = next.imageUrl;
      })
      .catch(() => {
        // The next image is only a head start, so a failure here waits until it is needed.
      });
  }

  function show(next: LabelImage | null) {
    setImage(next);
    if (next) setAnnouncement(`New image. ${readSessionCount()} labelled this session.`);
  }

  function loadNext() {
    const ready = upcoming.current;
    if (ready) {
      show(ready);
      prepareUpcoming(ready);
      return;
    }
    generation.current += 1;
    setImage(undefined);
    getNextImage()
      .then(({ image: next }) => {
        show(next);
        if (next) prepareUpcoming(next);
      })
      .catch(fail);
  }

  useEffect(loadNext, []);

  // After a reload, the last answer can still be changed if it is recent enough.
  useEffect(() => {
    getLastLabel()
      .then(({ last }) => {
        if (last) setLastSaved(new Date(last.changeableUntil).getTime() - 30 * 60 * 1000);
      })
      .catch(() => {});
  }, []);

  function saved() {
    const next = readSessionCount() + 1;
    try {
      sessionStorage.setItem(SESSION_KEY, String(next));
    } catch {
      // The count just restarts if the browser blocks storage.
    }
    setCount(next);
    setLastSaved(Date.now());
  }

  const startChange = useCallback(async () => {
    try {
      const { last } = await getLastLabel();
      if (last) setChanging(last);
      else {
        setLastSaved(null);
        setError("Your last answer can no longer be changed. Answers can be changed for 30 minutes.");
      }
    } catch (failure) {
      setError((failure as Error).message);
    }
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.altKey && !event.ctrlKey && !event.metaKey && event.code === "KeyZ" && lastSaved && !changing) {
        event.preventDefault();
        startChange();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [lastSaved, changing, startChange]);

  // The link to change an answer disappears once the 30 minutes are up.
  useEffect(() => {
    if (!lastSaved) return;
    const timer = setTimeout(() => setLastSaved(null), lastSaved + 30 * 60 * 1000 - Date.now());
    return () => clearTimeout(timer);
  }, [lastSaved]);

  const needsBreak = count > 0 && count % BREAK_EVERY === 0 && breakDismissed !== count;

  return (
    <main>
      <p className="visually-hidden" aria-live="polite">
        {announcement}
      </p>
      <div className="session-bar">
        <span>{count} labelled this session</span>
        {lastSaved && !changing && (
          <button type="button" className="link" onClick={startChange}>
            Change my last answer (Alt+Z)
          </button>
        )}
      </div>
      {needsBreak && (
        <p className="notice" role="status">
          You have labelled {count} images. A short break helps keep your readings accurate.{" "}
          <button type="button" className="link" onClick={() => setBreakDismissed(count)}>
            Carry on
          </button>
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {changing ? (
        <LabelForm
          key={`change-${changing.image.id}`}
          image={changing.image}
          initial={changing.label}
          submitLabel="Save the change"
          view={view}
          onViewChange={setView}
          onCancel={() => setChanging(null)}
          onSubmit={async (label) => {
            await changeLabel(changing.image.id, label);
            setChanging(null);
            setLastSaved(Date.now());
            setAnnouncement("Your answer was changed. Back to the image you were on.");
          }}
        />
      ) : (
        <>
          {image === undefined && !error && <p className="status">Loading…</p>}
          {image === null && <p className="status">There are no more images to label. Thank you!</p>}
          {image && (
            <LabelForm
              key={image.id}
              image={image}
              submitLabel="Save and next"
              view={view}
              onViewChange={setView}
              onSubmit={async (label) => {
                await submitLabel(image.id, label);
                saved();
                loadNext();
              }}
            />
          )}
        </>
      )}
    </main>
  );
}

import { abkaiToManchu, manchuToMollendorff } from "@manchu-labelling/script";
import { useEffect, useState, type FormEvent } from "react";

import { getNextImage, submitLabel, type LabelImage } from "../api.ts";
import { CropImage } from "./CropImage.tsx";
import { ManchuText } from "./ManchuText.tsx";
import { PageView } from "./PageView.tsx";
import { Reference } from "./Reference.tsx";

const CATEGORIES = [
  ["manchu", "Manchu"],
  ["chinese", "Chinese"],
  ["mongolian", "Mongolian"],
  ["other_script", "Other script"],
  ["non_text", "Not text"],
  ["illegible", "Illegible"],
  ["bad_crop", "Bad crop"],
] as const;

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

const confidence = (unsure: boolean) => (unsure ? "unconfident" : "confident");

function AbkaiField(props: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoFocus?: boolean;
}) {
  const { text, invalid } = abkaiToManchu(props.value);
  return (
    <div className="abkai-field">
      <label htmlFor={props.id}>{props.label}</label>
      <input
        id={props.id}
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        autoFocus={props.autoFocus}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
      />
      {invalid.length > 0 && <p role="alert">Not Abkai: {invalid.join(" ")}</p>}
      {text && (
        <p className="romanization">Möllendorff: {manchuToMollendorff(text).text}</p>
      )}
    </div>
  );
}

function LabelForm({ image, onDone }: { image: LabelImage; onDone: () => void }) {
  const [category, setCategory] = useState("manchu");
  const [transcription, setTranscription] = useState("");
  const [intendedWord, setIntendedWord] = useState("");
  const [production, setProduction] = useState(image.style.production);
  const [script, setScript] = useState(image.style.script);
  const [unsureCategory, setUnsureCategory] = useState(false);
  const [unsureTranscription, setUnsureTranscription] = useState(false);
  const [unsureStyle, setUnsureStyle] = useState(false);
  const [showPage, setShowPage] = useState(false);
  const [error, setError] = useState("");

  const isManchu = category === "manchu";
  const preview = abkaiToManchu(transcription);
  const intended = abkaiToManchu(intendedWord);
  const invalid = isManchu && (preview.invalid.length > 0 || intended.invalid.length > 0);
  const ready = !invalid && (!isManchu || preview.text !== "");

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready) return;
    try {
      await submitLabel(image.id, {
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
      onDone();
    } catch (failure) {
      setError((failure as Error).message);
    }
  }

  return (
    <form className="labelling" onSubmit={submit}>
      <div className="comparison">
        <figure>
          <figcaption>Image</figcaption>
          <CropImage src={image.imageUrl} />
        </figure>
        {isManchu && (
          <figure>
            <figcaption>Your reading</figcaption>
            <ManchuText text={preview.text} className="preview" />
          </figure>
        )}
      </div>

      <div className="fields">
        <fieldset>
          <legend>What is in this image?</legend>
          <div className="choices">
            {CATEGORIES.map(([value, name]) => (
              <label key={value}>
                <input
                  type="radio"
                  name="category"
                  value={value}
                  checked={category === value}
                  onChange={() => setCategory(value)}
                />
                {name}
              </label>
            ))}
          </div>
          <label className="unsure">
            <input
              type="checkbox"
              checked={unsureCategory}
              onChange={(event) => setUnsureCategory(event.target.checked)}
            />
            Not sure
          </label>
        </fieldset>

        {isManchu && (
          <>
            <AbkaiField
              id="transcription"
              label="What is written (Abkai)"
              value={transcription}
              onChange={setTranscription}
              autoFocus
            />
            <p className="hint">Type exactly what is written. Use ? for a letter you cannot read.</p>
            <label className="unsure">
              <input
                type="checkbox"
                checked={unsureTranscription}
                onChange={(event) => setUnsureTranscription(event.target.checked)}
              />
              Not sure
            </label>
            <details>
              <summary>The intended word is different</summary>
              <AbkaiField
                id="intended"
                label="Intended word (Abkai)"
                value={intendedWord}
                onChange={setIntendedWord}
              />
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
            <input
              type="checkbox"
              checked={unsureStyle}
              onChange={(event) => setUnsureStyle(event.target.checked)}
            />
            Not sure
          </label>
        </details>

        {error && <p role="alert">{error}</p>}
        <div className="actions">
          <button type="submit" disabled={!ready}>
            Save and next
          </button>
          <button type="button" className="secondary" onClick={() => setShowPage(!showPage)}>
            {showPage ? "Hide page" : "Show page"}
          </button>
        </div>
      </div>

      {showPage && <PageView imageId={image.id} />}
    </form>
  );
}

export function Labelling() {
  const [image, setImage] = useState<LabelImage | null | undefined>(undefined);
  const [error, setError] = useState("");

  function loadNext() {
    setImage(undefined);
    getNextImage()
      .then(({ image: next }) => setImage(next))
      .catch((failure: Error) => setError(failure.message));
  }

  useEffect(loadNext, []);

  return (
    <div className="workspace">
      <main>
        {error && <p role="alert">{error}</p>}
        {image === undefined && !error && <p className="status">Loading…</p>}
        {image === null && <p className="status">There are no more images to label. Thank you!</p>}
        {image && <LabelForm key={image.id} image={image} onDone={loadNext} />}
      </main>
      <Reference />
    </div>
  );
}

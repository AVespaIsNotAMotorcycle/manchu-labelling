import { abkaiToManchu } from "@manchu-labelling/script";
import { useEffect, useState, type FormEvent } from "react";

import {
  answerQuiz,
  getQuizItem,
  type QuizFeedback,
  type QuizItem,
  type QuizProgress,
} from "../api.ts";
import { AbkaiField } from "./AbkaiField.tsx";
import { categoryName, CategoryField } from "./CategoryField.tsx";
import { CropImage } from "./CropImage.tsx";
import { ManchuText } from "./ManchuText.tsx";

function Introduction({ onStart }: { onStart: () => void }) {
  return (
    <section className="panel introduction">
      <h1>Training</h1>
      <p>
        Before you label, this quiz checks that you can read the script. For each image, say what it
        shows. If it is Manchu, type exactly what is written, using Abkai. The letter reference and its
        links are there to help, so use them whenever you like.
      </p>
      <p>
        You will see the answer after each image. Keep going until your <strong>last 20 answers</strong>{" "}
        are all correct. At least 10 of those 20 must be real scans, not generated images.
      </p>
      <h2>Hidden checks</h2>
      <p>
        Once you start labelling, some images will have answers we already know. We will not tell you
        which ones they are. If your accuracy on them is too low, your labels will not be counted until
        it improves. Later labels can still count, so a bad patch is not permanent.
      </p>
      <p>
        You can see your overall accuracy. Past test images appear on your profile after a delay, and
        you can dispute any answer that you think is wrong.
      </p>
      <button type="button" onClick={onStart} autoFocus>
        Start the quiz
      </button>
    </section>
  );
}

function AnswerMark({ correct }: { correct: boolean | undefined }) {
  if (correct === undefined) return <li className="mark" aria-label="Not answered yet" />;
  return (
    <li className={correct ? "mark right" : "mark wrong"}>
      <svg viewBox="0 0 16 16" role="img" aria-label={correct ? "Correct" : "Wrong"}>
        <path d={correct ? "M3 8.5 6.5 12 13 4.5" : "M4 4 12 12M12 4 4 12"} />
      </svg>
    </li>
  );
}

function ProgressMeter({ progress }: { progress: QuizProgress }) {
  const { recent, real, windowSize, minReal } = progress;
  // The answers after the last wrong one, or all of them if none were wrong.
  const streak = recent.length - 1 - recent.lastIndexOf(false);
  const needed = windowSize - streak;
  const slots = Array.from({ length: windowSize }, (_, index) => recent[index]);
  return (
    <div className="progress">
      <p>
        <strong>
          {needed === 0
            ? `${windowSize} correct in a row`
            : `${needed} more correct in a row to qualify`}
        </strong>{" "}
        · At least {minReal} of the {windowSize} must be real scans ({real} so far)
      </p>
      <ol className="marks" aria-label={`Your last ${windowSize} answers, oldest first`}>
        {slots.map((correct, index) => (
          <AnswerMark key={index} correct={correct} />
        ))}
      </ol>
    </div>
  );
}

function Feedback(props: {
  item: QuizItem;
  given: { category: string; abkai: string };
  result: QuizFeedback;
  onNext: () => void;
  onFinish: () => void;
}) {
  const { item, given, result, onNext, onFinish } = props;
  const { answer, correct, progress } = result;
  const givenManchu = abkaiToManchu(given.abkai).text;
  return (
    <div className="labelling">
      <div className="comparison">
        <figure>
          <figcaption>Image</figcaption>
          <CropImage src={item.imageUrl} />
        </figure>
        {answer.manchu && (
          <figure>
            <figcaption>Correct reading</figcaption>
            <ManchuText text={answer.manchu} className="preview" />
          </figure>
        )}
        {!correct && given.category === "manchu" && (
          <figure>
            <figcaption>Your reading</figcaption>
            <ManchuText text={givenManchu} className="preview" />
          </figure>
        )}
      </div>
      <div className="fields">
        <p className={correct ? "result right" : "result wrong"} role="status">
          {correct ? "Correct" : "Not quite"}
        </p>
        <dl>
          <dt>Answer</dt>
          <dd>{categoryName(answer.category)}</dd>
          {answer.abkai && (
            <>
              <dt>Abkai</dt>
              <dd>{answer.abkai}</dd>
              <dt>Möllendorff</dt>
              <dd>{answer.mollendorff}</dd>
            </>
          )}
          {!correct && (
            <>
              <dt>You said</dt>
              <dd>{given.category === "manchu" ? given.abkai : categoryName(given.category)}</dd>
            </>
          )}
        </dl>
        <p className="hint">Source: {result.source}</p>
        {progress.qualified ? (
          <>
            <p className="result right">You are ready to label.</p>
            <button type="button" onClick={onFinish} autoFocus>
              Start labelling
            </button>
          </>
        ) : (
          <button type="button" onClick={onNext} autoFocus>
            Next image
          </button>
        )}
      </div>
    </div>
  );
}

function Question(props: {
  item: QuizItem;
  onAnswered: (given: { category: string; abkai: string }, result: QuizFeedback) => void;
  scriptClass: string;
}) {
  const { item, onAnswered, scriptClass } = props;
  const [category, setCategory] = useState("manchu");
  const [abkai, setAbkai] = useState("");
  const [error, setError] = useState("");

  const isManchu = category === "manchu";
  const preview = abkaiToManchu(abkai);
  const ready = !isManchu || (preview.text !== "" && preview.invalid.length === 0);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready) return;
    try {
      const result = await answerQuiz(scriptClass, {
        category,
        ...(isManchu ? { transcription: abkai } : {}),
      });
      onAnswered({ category, abkai }, result);
    } catch (failure) {
      setError((failure as Error).message);
    }
  }

  return (
    <form className="labelling" onSubmit={submit}>
      <div className="comparison">
        <figure>
          <figcaption>Image</figcaption>
          <CropImage src={item.imageUrl} />
        </figure>
        {isManchu && (
          <figure>
            <figcaption>Your reading</figcaption>
            <ManchuText text={preview.text} className="preview" />
          </figure>
        )}
      </div>
      <div className="fields">
        <CategoryField value={category} onChange={setCategory} />
        {isManchu && (
          <>
            <AbkaiField
              id="quiz-answer"
              label="What is written (Abkai)"
              value={abkai}
              onChange={setAbkai}
              autoFocus
            />
            <p className="hint">Type exactly what is written.</p>
          </>
        )}
        {error && <p role="alert">{error}</p>}
        <div className="actions">
          <button type="submit" disabled={!ready}>
            Check answer
          </button>
        </div>
      </div>
    </form>
  );
}

export function Training(props: { scriptClass: string; onQualified: () => void }) {
  const { scriptClass, onQualified } = props;
  const [item, setItem] = useState<QuizItem | null | undefined>(undefined);
  const [progress, setProgress] = useState<QuizProgress | null>(null);
  const [started, setStarted] = useState(false);
  const [answered, setAnswered] = useState<{
    given: { category: string; abkai: string };
    result: QuizFeedback;
  } | null>(null);
  const [error, setError] = useState("");

  function loadNext() {
    setAnswered(null);
    setItem(undefined);
    getQuizItem(scriptClass)
      .then((next) => {
        setItem(next.item);
        setProgress(next.progress);
      })
      .catch((failure: Error) => setError(failure.message));
  }

  useEffect(loadNext, [scriptClass]);

  const isNew = progress?.answered === 0;

  return (
    <main>
      {error && <p role="alert">{error}</p>}
      {progress && isNew && !started ? (
        <Introduction onStart={() => setStarted(true)} />
      ) : (
        <>
          {progress && (
            <ProgressMeter progress={answered?.result.progress ?? progress} />
          )}
          {item === undefined && !error && <p className="status">Loading…</p>}
          {item === null && <p className="status">There are no quiz images yet.</p>}
          {item && answered && (
            <Feedback
              item={item}
              given={answered.given}
              result={answered.result}
              onNext={loadNext}
              onFinish={onQualified}
            />
          )}
          {item && !answered && (
            <Question
              key={item.id}
              item={item}
              scriptClass={scriptClass}
              onAnswered={(given, result) => setAnswered({ given, result })}
            />
          )}
        </>
      )}
    </main>
  );
}

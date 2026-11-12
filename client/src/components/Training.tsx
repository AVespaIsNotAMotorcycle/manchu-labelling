import { abkaiToManchu } from "@manchu-labelling/script";
import { useEffect, useState, type FormEvent } from "react";

import {
  answerQuiz,
  getQuizItem,
  type QuizFeedback,
  type QuizItem,
  type QuizPhase,
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
        You will see the answer after each image. The quiz has three phases, and each one needs{" "}
        <strong>8 correct answers in a row</strong>:
      </p>
      <ol>
        <li>
          <strong>Synthetic:</strong> words rendered in Manchu fonts.
        </li>
        <li>
          <strong>Printed:</strong> photos of printed Manchu words.
        </li>
        <li>
          <strong>Manuscript:</strong> images from handwritten volumes. Some of these are not Manchu.
        </li>
      </ol>
      <p>
        Once you pass a phase, you will not need to repeat it. After the synthetic phase, you can go back
        and practise on synthetic images whenever you like, and those answers will not affect your
        progress.
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

const CHECK = "M3 8.5 6.5 12 13 4.5";
const CROSS = "M4 4 12 12M12 4 4 12";

function AnswerMark({ correct }: { correct: boolean | undefined }) {
  if (correct === undefined) return <li className="mark" aria-label="Not answered yet" />;
  return (
    <li className={correct ? "mark right" : "mark wrong"}>
      <svg viewBox="0 0 16 16" role="img" aria-label={correct ? "Correct" : "Wrong"}>
        <path d={correct ? CHECK : CROSS} />
      </svg>
    </li>
  );
}

const PHASE_NAMES: Record<string, string> = {
  synthetic: "Synthetic",
  printed: "Printed",
  manuscript: "Manuscript",
};

function PhaseSteps({ phases, current }: { phases: QuizPhase[]; current: number }) {
  return (
    <ol className="phases" aria-label="Quiz phases">
      {phases.map(({ phase, passed }, index) => (
        <li
          key={phase}
          className={passed ? "done" : index === current ? "active" : undefined}
          aria-current={index === current ? "step" : undefined}
        >
          <span className="phase-number" aria-hidden="true">
            {passed ? (
              <svg viewBox="0 0 16 16">
                <path d={CHECK} />
              </svg>
            ) : (
              index + 1
            )}
          </span>
          <span className="phase-name">
            {PHASE_NAMES[phase] ?? phase}
            {passed && <span className="visually-hidden"> (passed)</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}

function ProgressMeter(props: {
  progress: QuizProgress;
  practice: boolean;
  onPracticeChange: (practice: boolean) => void;
}) {
  const { progress, practice, onPracticeChange } = props;
  const { phases } = progress;
  const current = phases.findIndex(({ passed }) => !passed);
  const phase = phases[current];
  const next = phases[current + 1];

  let detail;
  if (practice) {
    detail = (
      <>
        <p>
          <strong>Practice with synthetic images.</strong> These answers do not affect your progress.
        </p>
        <button type="button" onClick={() => onPracticeChange(false)}>
          Back to the quiz
        </button>
      </>
    );
  } else if (!phase) {
    detail = <p><strong>You have passed every phase.</strong></p>;
  } else {
    const goal = next ? `to move on to ${PHASE_NAMES[next.phase]?.toLowerCase()}` : "to qualify";
    const slots = Array.from({ length: phase.length }, (_, index) => phase.recent[index]);
    detail = (
      <>
        <p>
          <strong>
            {phase.needed} more correct in a row {goal}
          </strong>
        </p>
        <ol className="marks" aria-label={`Your last ${phase.length} answers in this phase, oldest first`}>
          {slots.map((correct, index) => (
            <AnswerMark key={index} correct={correct} />
          ))}
        </ol>
      </>
    );
  }

  return (
    <div className="progress">
      <PhaseSteps phases={phases} current={current} />
      {detail}
      {!practice && phases[0]?.passed && (
        <button type="button" onClick={() => onPracticeChange(true)}>
          Practise with synthetic images
        </button>
      )}
    </div>
  );
}

function Feedback(props: {
  item: QuizItem;
  given: { category: string; abkai: string };
  result: QuizFeedback;
  practice: boolean;
  onNext: () => void;
  onFinish: () => void;
}) {
  const { item, given, result, practice, onNext, onFinish } = props;
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
        {progress.qualified && !practice ? (
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
  practice: boolean;
}) {
  const { item, onAnswered, scriptClass, practice } = props;
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
      const result = await answerQuiz(
        scriptClass,
        { category, ...(isManchu ? { transcription: abkai } : {}) },
        practice,
      );
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
  const [practice, setPractice] = useState(false);
  const [answered, setAnswered] = useState<{
    given: { category: string; abkai: string };
    result: QuizFeedback;
  } | null>(null);
  const [error, setError] = useState("");

  function loadNext() {
    setAnswered(null);
    setItem(undefined);
    getQuizItem(scriptClass, practice)
      .then((next) => {
        setItem(next.item);
        setProgress(next.progress);
      })
      .catch((failure: Error) => setError(failure.message));
  }

  useEffect(loadNext, [scriptClass, practice]);

  const isNew = progress?.answered === 0;

  return (
    <main>
      {error && <p role="alert">{error}</p>}
      {progress && isNew && !started ? (
        <Introduction onStart={() => setStarted(true)} />
      ) : (
        <>
          {progress && (
            <ProgressMeter
              progress={answered?.result.progress ?? progress}
              practice={practice}
              onPracticeChange={setPractice}
            />
          )}
          {item === undefined && !error && <p className="status">Loading…</p>}
          {item === null && <p className="status">There are no quiz images yet.</p>}
          {item && answered && (
            <Feedback
              item={item}
              given={answered.given}
              result={answered.result}
              practice={practice}
              onNext={loadNext}
              onFinish={onQualified}
            />
          )}
          {item && !answered && (
            <Question
              key={item.id}
              item={item}
              scriptClass={scriptClass}
              practice={practice}
              onAnswered={(given, result) => setAnswered({ given, result })}
            />
          )}
        </>
      )}
    </main>
  );
}

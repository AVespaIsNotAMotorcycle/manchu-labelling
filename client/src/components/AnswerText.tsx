import { categoryName } from "./CategoryField.tsx";
import { ManchuText } from "./ManchuText.tsx";

/** An answer in Manchu script with its Abkai, or the name of its category. */
export function AnswerText(props: { answer: { category?: string; manchu?: string; abkai?: string } }) {
  const { category, manchu, abkai } = props.answer;
  if (category === "manchu" && manchu) {
    return (
      <span className="answer-text">
        <ManchuText text={manchu} className="small-preview" />
        <span>{abkai}</span>
      </span>
    );
  }
  return <span className="answer-text">{categoryName(category ?? "")}</span>;
}

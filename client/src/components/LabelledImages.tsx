import { useEffect, useState } from "react";

import { getLabelled, type LabelledImage } from "../api.ts";
import { AnswerText } from "./AnswerText.tsx";
import { PageImage } from "./PageView.tsx";

const STATUSES: [string, string][] = [
  ["", "All"],
  ["single", "One label"],
  ["pending", "Waiting for a third label"],
  ["agreed", "Agreed"],
  ["needs_review", "Waiting for a reviewer"],
  ["reviewed", "Reviewed"],
  ["unlabelled", "Only labels that do not count"],
];

const statusName = (status: string) => STATUSES.find(([value]) => value === status)?.[1] ?? status;

function LabelledRow({ item }: { item: LabelledImage }) {
  const [showPage, setShowPage] = useState(false);
  return (
    <li className="labelled">
      <img className="thumbnail" src={item.imageUrl} alt="A labelled word" />
      <div>
        <p>
          <strong>{statusName(item.status)}</strong>
          {item.answer && (
            <>
              {": "}
              <AnswerText answer={item.answer} />
            </>
          )}
          {item.reviewer && <span className="hint"> (by {item.reviewer})</span>}
        </p>
        <p className="hint">
          {item.volume}, page {item.pageIndex}, {item.position.side} side, column {item.position.column + 1}, word{" "}
          {item.position.word + 1}
          {item.heldBack && " · held back"}
        </p>
        <table className="accuracy">
          <thead>
            <tr>
              <th scope="col">Labeler</th>
              <th scope="col">Reading</th>
              <th scope="col">Counts</th>
              <th scope="col">Sure</th>
              <th scope="col">Date</th>
            </tr>
          </thead>
          <tbody>
            {item.labels.map((label) => (
              <tr key={`${label.labeler}:${label.createdAt}`}>
                <td>{label.labeler}</td>
                <td>
                  <AnswerText answer={label} />
                  {(label.production || label.script) && (
                    <span className="hint"> {[label.production, label.script].filter(Boolean).join(", ")}</span>
                  )}
                </td>
                <td>{label.trusted ? "Yes" : "No, not trusted"}</td>
                <td>{label.sure ? "Yes" : "No"}</td>
                <td>{new Date(label.createdAt).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <button type="button" className="link" onClick={() => setShowPage(!showPage)}>
          {showPage ? "Hide page" : "Show page"}
        </button>
        {showPage && <PageImage context={item.context} />}
      </div>
    </li>
  );
}

/**
 * Every labelled image that no release has published yet, with its labels, newest first. Hidden checks
 * and words moved to the quiz are left out.
 */
export function LabelledImages() {
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(0);
  const [data, setData] = useState<Awaited<ReturnType<typeof getLabelled>> | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    setData(null);
    getLabelled(status, page)
      .then(setData)
      .catch((failure: Error) => setError(failure.message));
  }, [status, page]);

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const all = data ? Object.values(data.counts).reduce((sum, count) => sum + count, 0) : 0;

  return (
    <section className="labelled-images">
      <h2>Labelled images</h2>
      <p className="hint">Images with labels that no release has published yet. Hidden checks are not shown.</p>
      <label>
        Show
        <select
          value={status}
          onChange={(event) => {
            setStatus(event.target.value);
            setPage(0);
          }}
        >
          {STATUSES.map(([value, name]) => (
            <option key={value} value={value}>
              {name} ({value ? (data?.counts[value] ?? 0) : all})
            </option>
          ))}
        </select>
      </label>
      {error && <p role="alert">{error}</p>}
      {!data && !error && <p className="status">Loading…</p>}
      {data?.items.length === 0 && <p className="status">No images to show.</p>}
      {data && data.items.length > 0 && (
        <>
          <ul className="past-checks">
            {data.items.map((item) => (
              <LabelledRow key={item.id} item={item} />
            ))}
          </ul>
          <nav className="pager" aria-label="Pages">
            <button type="button" disabled={page === 0} onClick={() => setPage(page - 1)}>
              Newer
            </button>
            <span>
              Page {page + 1} of {pages}
            </span>
            <button type="button" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>
              Older
            </button>
          </nav>
        </>
      )}
    </section>
  );
}

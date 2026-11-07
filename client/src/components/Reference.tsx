import { REFERENCE_LETTERS } from "@manchu-labelling/script";

export function Reference() {
  return (
    <aside className="reference" aria-label="Letter reference">
      <h2>Letter forms</h2>
      <ul className="resources">
        <li>
          <a
            href="https://www.manchustudiesgroup.org/wp-content/uploads/2020/06/Manchu-script-Roth-Li.pdf"
            target="_blank"
            rel="noreferrer"
          >
            The Manchu script (Roth Li, PDF)
          </a>
        </li>
        <li>
          <a
            href="https://www.manchustudiesgroup.org/introduction-to-manchu-in-21-lessons/"
            target="_blank"
            rel="noreferrer"
          >
            Introduction to Manchu in 21 Lessons
          </a>
        </li>
      </ul>
      <table>
        <thead>
          <tr>
            <th>Abkai</th>
            <th>Initial</th>
            <th>Medial</th>
            <th>Final</th>
          </tr>
        </thead>
        <tbody>
          {REFERENCE_LETTERS.map(({ abkai, initial, medial, final }) => (
            <tr key={abkai}>
              <th scope="row">{abkai}</th>
              {[initial, medial, final].map((form) => (
                <td key={form}>
                  <span className="manchu letter" lang="mnc">
                    {form}
                  </span>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </aside>
  );
}

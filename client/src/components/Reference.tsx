import { REFERENCE_LETTERS } from "@manchu-labelling/script";

export function Reference() {
  return (
    <aside className="reference" aria-label="Letter reference">
      <h2>Letter forms</h2>
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

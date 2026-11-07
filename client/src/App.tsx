import { useState } from "react";

import { abkaiToManchu, manchuToMollendorff } from "@manchu-labelling/script";

export function App() {
  const [abkai, setAbkai] = useState("manju");
  const { text: manchu, invalid } = abkaiToManchu(abkai);

  return (
    <main>
      <h1>Manchu Labelling</h1>
      <label htmlFor="abkai">Abkai</label>
      <input
        id="abkai"
        autoComplete="off"
        spellCheck={false}
        value={abkai}
        onChange={(event) => setAbkai(event.target.value)}
      />
      {invalid.length > 0 && <p role="alert">Not Abkai: {invalid.join(" ")}</p>}
      <p>Möllendorff: {manchuToMollendorff(manchu).text}</p>
      <p className="manchu" lang="mnc">
        {manchu}
      </p>
    </main>
  );
}

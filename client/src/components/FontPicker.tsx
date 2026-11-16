import { useRef, useState } from "react";

import { addOwnFont, useFonts, useManchuFont } from "../fonts.ts";

/** Chooses the Manchu font, and lets the user add a font file of their own. */
export function FontPicker() {
  const fonts = useFonts();
  const [fontId, setFontId] = useManchuFont();
  const file = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState("");

  async function add(chosen: File | undefined) {
    if (!chosen) return;
    setMessage("");
    try {
      const { id, savedForLater } = await addOwnFont(chosen);
      setFontId(id);
      if (!savedForLater) setMessage("This browser will forget the font when you close it.");
    } catch (failure) {
      setMessage((failure as Error).message);
    } finally {
      if (file.current) file.current.value = "";
    }
  }

  return (
    <div className="font-picker">
      <label>
        Manchu font
        <select value={fontId} onChange={(event) => setFontId(event.target.value)}>
          {fonts.map(({ id, name, own }) => (
            <option key={id} value={id}>
              {name}
              {own ? " (yours)" : ""}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="link"
        title="Use a font file you have. It stays in this browser."
        onClick={() => file.current?.click()}
      >
        Add a font
      </button>
      <input
        ref={file}
        type="file"
        accept=".ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2"
        hidden
        onChange={(event) => add(event.target.files?.[0])}
      />
      {message && (
        <span role="status" className="font-message">
          {message}
        </span>
      )}
    </div>
  );
}

import { useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";

import { addOwnFont, FONT_SOURCE_URL, useFonts, useManchuFont } from "../fonts.ts";

/**
 * Explains where to get Manchu fonts and that added fonts stay in this browser, then takes a font file.
 * `onAdded` receives the new font's ID.
 */
function AddFontDialog({ dialog, onAdded }: { dialog: RefObject<HTMLDialogElement | null>; onAdded: (id: string) => void }) {
  const file = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function add(chosen: File | undefined) {
    if (!chosen) return;
    setMessage("");
    setBusy(true);
    try {
      const { id, savedForLater } = await addOwnFont(chosen);
      onAdded(id);
      if (savedForLater) dialog.current?.close();
      else setMessage(`Added ${chosen.name}, but this browser will forget it when you close it.`);
    } catch (failure) {
      setMessage((failure as Error).message);
    } finally {
      setBusy(false);
      if (file.current) file.current.value = "";
    }
  }

  // Rendered at the end of the page, so that the top bar's styles do not reach it.
  return createPortal(
    <dialog
      ref={dialog}
      className="font-dialog"
      aria-labelledby="font-dialog-title"
      onClose={() => setMessage("")}
      onClick={(event) => {
        // Clicking the backdrop, outside the dialog's box, closes it.
        if (event.target === event.currentTarget) dialog.current?.close();
      }}
    >
      <div className="font-dialog-body">
        <h2 id="font-dialog-title">Add a Manchu font</h2>
        <p>
          Manchu looks different from font to font, and a font close to the scans can make reading easier.
          You can download Manchu fonts from the{" "}
          <a href={FONT_SOURCE_URL} target="_blank" rel="noreferrer">
            Manchu Studies Group
          </a>
          , then add the file here.
        </p>
        <p>
          <strong>Fonts you add stay on this device.</strong> They are kept in this browser and never sent to
          our server, so only you can use them. To use a font in another browser or on another device, add it
          there too.
        </p>
        <label className="font-file">
          Font file (.ttf, .otf, .woff, or .woff2)
          <input
            ref={file}
            type="file"
            accept=".ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2"
            disabled={busy}
            onChange={(event) => add(event.target.files?.[0])}
          />
        </label>
        {message && <p role="status">{message}</p>}
        <div className="actions">
          <button type="button" className="secondary" onClick={() => dialog.current?.close()}>
            Close
          </button>
        </div>
      </div>
    </dialog>,
    document.body,
  );
}

/** Chooses the Manchu font, and lets the user add a font file of their own. */
export function FontPicker() {
  const fonts = useFonts();
  const [fontId, setFontId] = useManchuFont();
  const dialog = useRef<HTMLDialogElement>(null);

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
      <button type="button" className="link" onClick={() => dialog.current?.showModal()}>
        Add a font
      </button>
      <AddFontDialog dialog={dialog} onAdded={setFontId} />
    </div>
  );
}

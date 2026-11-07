import { FONTS, useManchuFont } from "../fonts.ts";

export function FontPicker() {
  const [fontId, setFontId] = useManchuFont();
  return (
    <label className="font-picker">
      Manchu font
      <select value={fontId} onChange={(event) => setFontId(event.target.value)}>
        {FONTS.map(({ id, name }) => (
          <option key={id} value={id}>
            {name}
          </option>
        ))}
      </select>
    </label>
  );
}

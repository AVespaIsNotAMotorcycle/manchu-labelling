import { useEffect, useState } from "react";

/**
 * Manchu fonts are all rights reserved, so they are kept out of git in `client/src/fonts/`. Only the files
 * that are present are offered, so a fresh clone still works with the bundled Noto font.
 */
const FILES = import.meta.glob<string>("./fonts/*.ttf", {
  eager: true,
  query: "?url",
  import: "default",
});

export interface FontOption {
  id: string;
  name: string;
  url?: string;
}

const NOTO: FontOption = { id: "noto", name: "Noto Sans Mongolian" };
const DEFAULT_FONT = "XM_WenQin";
const STORAGE_KEY = "manchu-font";

export const FONTS: readonly FontOption[] = [
  ...Object.entries(FILES)
    .map(([path, url]) => {
      const id = path.replace("./fonts/", "").replace(".ttf", "");
      return { id, name: id.replace("_", " "), url };
    })
    .sort((a, b) => a.name.localeCompare(b.name)),
  NOTO,
];

function readSavedFont(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function saveFont(id: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // The choice just lasts for this visit if the browser blocks storage.
  }
}

function initialFont(): string {
  const saved = readSavedFont();
  if (FONTS.some(({ id }) => id === saved)) return saved as string;
  return FONTS.some(({ id }) => id === DEFAULT_FONT) ? DEFAULT_FONT : NOTO.id;
}

async function applyFont(font: FontOption): Promise<void> {
  const root = document.documentElement.style;
  if (!font.url) {
    root.removeProperty("--manchu-font");
    return;
  }
  const family = `Manchu ${font.id}`;
  if (![...document.fonts].some((face) => face.family === family)) {
    document.fonts.add(await new FontFace(family, `url(${font.url})`).load());
  }
  root.setProperty("--manchu-font", `"${family}"`);
}

/** Returns the chosen font and a setter. The choice is kept in this browser. */
export function useManchuFont(): [string, (id: string) => void] {
  const [fontId, setFontId] = useState(initialFont);

  useEffect(() => {
    const font = FONTS.find(({ id }) => id === fontId);
    if (font) applyFont(font).catch(console.error);
  }, [fontId]);

  return [
    fontId,
    (id) => {
      saveFont(id);
      setFontId(id);
    },
  ];
}

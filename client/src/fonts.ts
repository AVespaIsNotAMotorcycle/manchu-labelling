import { useEffect, useState, useSyncExternalStore } from "react";

/**
 * Manchu fonts. Noto Sans Mongolian is bundled. The Abkai and XM fonts are all rights reserved, so the
 * app does not hand them out. Instead, each user can add font files they have themselves, such as the
 * XM fonts from the Manchu Studies Group. Those files stay in the user's own browser, in IndexedDB, and
 * are never sent to the server, so nobody else can use them.
 *
 * In development only, any fonts in `client/src/fonts/` are offered too. That folder is not in git, and
 * the production images leave it out.
 */
const DEVELOPMENT_FILES = import.meta.glob<string>("./fonts/*.ttf", {
  eager: true,
  query: "?url",
  import: "default",
});

export const FONT_SOURCE_URL = "https://www.manchustudiesgroup.org/typing-manchu/";

export interface FontOption {
  id: string;
  name: string;
  /** A bundled file, in development. */
  url?: string;
  /** A font the user added, held only in this browser. */
  data?: ArrayBuffer;
  own?: boolean;
}

const NOTO: FontOption = { id: "noto", name: "Noto Sans Mongolian" };
const DEFAULT_FONT = "XM_WenQin";
const STORAGE_KEY = "manchu-font";
const DATABASE = "manchu-labelling-fonts";
const STORE = "fonts";
/** Larger files are refused, since no Manchu font needs this much. */
const MAX_FONT_BYTES = 20 * 1024 * 1024;
const FONT_FILE = /\.(ttf|otf|woff2?)$/i;

const developmentFonts: FontOption[] = Object.entries(DEVELOPMENT_FILES).map(([path, url]) => {
  const id = path.replace("./fonts/", "").replace(".ttf", "");
  return { id, name: id.replace("_", " "), url };
});

/** The fonts the user added, kept in memory and in IndexedDB when the browser allows it. */
let ownFonts: FontOption[] = [];
const listeners = new Set<() => void>();
let snapshot: readonly FontOption[] = [];

function publish() {
  snapshot = [
    ...[...developmentFonts, ...ownFonts].sort((a, b) => a.name.localeCompare(b.name)),
    NOTO,
  ];
  for (const listener of listeners) listener();
}
publish();

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const database = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = action(database.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    database.close();
  }
}

/** Loads the user's fonts from this browser. If storage is blocked, there are simply none yet. */
const loaded: Promise<void> = (async () => {
  try {
    const stored = await withStore<{ id: string; name: string; data: ArrayBuffer }[]>("readonly", (store) =>
      store.getAll(),
    );
    ownFonts = stored.map((font) => ({ ...font, own: true }));
    publish();
  } catch {
    // Private windows and some settings block IndexedDB. Added fonts then last for this visit only.
  }
})();

const familyFor = (font: FontOption) => `Manchu ${font.id}`;

/**
 * Adds a font file the user has. It is checked by loading it, and kept only in this browser. Returns the
 * new font's ID. A font with the same name replaces the old one.
 */
export async function addOwnFont(file: File): Promise<{ id: string; savedForLater: boolean }> {
  if (!FONT_FILE.test(file.name)) throw new Error("Please choose a font file ending in .ttf, .otf, .woff, or .woff2");
  if (file.size > MAX_FONT_BYTES) throw new Error("This file is too large to be a font");
  const data = await file.arrayBuffer();
  const name = file.name.replace(FONT_FILE, "").replaceAll("_", " ").trim();
  const id = `own:${name}`;
  try {
    await new FontFace(`Check ${Date.now()}`, data).load();
  } catch {
    throw new Error("This file could not be read as a font");
  }
  const font: FontOption = { id, name, data, own: true };
  let savedForLater = true;
  try {
    await withStore("readwrite", (store) => store.put({ id, name, data }));
  } catch {
    savedForLater = false;
  }
  ownFonts = [...ownFonts.filter((existing) => existing.id !== id), font];
  publish();
  return { id, savedForLater };
}

export async function removeOwnFont(id: string): Promise<void> {
  try {
    await withStore("readwrite", (store) => store.delete(id));
  } catch {
    // Nothing was stored, so there is nothing to remove.
  }
  ownFonts = ownFonts.filter((font) => font.id !== id);
  publish();
}

/** Every font on offer: the user's own, any development fonts, and Noto Sans Mongolian. */
export function useFonts(): readonly FontOption[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => snapshot,
  );
}

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

async function applyFont(font: FontOption): Promise<void> {
  const root = document.documentElement.style;
  if (!font.url && !font.data) {
    root.removeProperty("--manchu-font");
    return;
  }
  const family = familyFor(font);
  if (![...document.fonts].some((face) => face.family === family)) {
    const source = font.data ?? `url(${font.url})`;
    document.fonts.add(await new FontFace(family, source).load());
  }
  root.setProperty("--manchu-font", `"${family}"`);
}

/** Returns the chosen font and a setter. The choice is kept in this browser. */
export function useManchuFont(): [string, (id: string) => void] {
  const fonts = useFonts();
  const [fontId, setFontId] = useState(() => readSavedFont() ?? DEFAULT_FONT);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    loaded.then(() => setReady(true));
  }, []);

  // A saved choice whose font is gone, such as one removed or from another browser, falls back.
  const available =
    fonts.find(({ id }) => id === fontId) ??
    fonts.find(({ id, name }) => id === DEFAULT_FONT || name === DEFAULT_FONT.replace("_", " ")) ??
    NOTO;

  useEffect(() => {
    if (ready) applyFont(available).catch(console.error);
  }, [available, ready]);

  return [
    available.id,
    (id) => {
      saveFont(id);
      setFontId(id);
    },
  ];
}

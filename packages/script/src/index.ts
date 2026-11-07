/**
 * Conversion between Manchu Unicode, Abkai, and Möllendorff.
 *
 * Manchu Unicode is the stored form (see SPEC.md). Abkai is the input method, and both romanizations are
 * derived for display and export. Neither romanization is one-to-one with the script, so only
 * `abkaiToManchu` should ever create stored text.
 */

/** Stands for a letter that cannot be read. */
export const UNREADABLE = "?";

const MODIFIER = "ʻ";
const MOLLENDORFF_MODIFIER = "῾";

/** Characters that users may type for the Abkai modifier. */
const MODIFIER_INPUTS = /['’ʼ`´]/g;

/** Mongolian free variation selectors. Stored text leaves these out. */
const VARIATION_SELECTORS = /[᠋-᠍᠏]/g;

type Letter = readonly [manchu: string, abkai: string, mollendorff: string];

/** Single letters, and the sequences whose romanization differs from their parts. */
const LETTERS: readonly Letter[] = [
  ["ᠠ", "a", "a"],
  ["ᡝ", "e", "e"],
  ["ᡳ", "i", "i"],
  ["ᡟ", `y${MODIFIER}`, "y"],
  ["ᠣ", "o", "o"],
  ["ᡠ", "u", "u"],
  ["ᡡ", "v", "ū"],
  ["ᠨ", "n", "n"],
  ["ᠩ", "ng", "ng"],
  ["ᡴ", "k", "k"],
  ["ᡤ", "g", "g"],
  ["ᡥ", "h", "h"],
  ["ᠪ", "b", "b"],
  ["ᡦ", "p", "p"],
  ["ᠰ", "s", "s"],
  ["ᡧ", "x", "š"],
  ["ᡨ", "t", "t"],
  ["ᡩ", "d", "d"],
  ["ᠯ", "l", "l"],
  ["ᠮ", "m", "m"],
  ["ᠴ", "q", "c"],
  ["ᠵ", "j", "j"],
  ["ᠶ", "y", "y"],
  ["ᡵ", "r", "r"],
  ["ᡶ", "f", "f"],
  ["ᠸ", "w", "w"],
  ["ᠺ", `k${MODIFIER}`, `k${MOLLENDORFF_MODIFIER}`],
  ["ᡬ", `g${MODIFIER}`, `g${MOLLENDORFF_MODIFIER}`],
  ["ᡭ", `h${MODIFIER}`, `h${MOLLENDORFF_MODIFIER}`],
  ["ᡮ", "c", `ts${MOLLENDORFF_MODIFIER}`],
  ["ᡮᡟ", `cy${MODIFIER}`, "ts"],
  ["ᡯ", "z", "dz"],
  ["ᡰ", `r${MODIFIER}`, "ž"],
  ["ᠰᡟ", `sy${MODIFIER}`, "sy"],
  ["ᡱ", "q", `c${MOLLENDORFF_MODIFIER}`],
  ["ᡱᡳ", `qy${MODIFIER}`, `c${MOLLENDORFF_MODIFIER}y`],
  ["ᡷ", "zh", "j"],
  ["ᡷᡳ", `jy${MODIFIER}`, "jy"],
];

/** Abkai `q` alone always means ᠴ. ᡱ is only entered through the sequence `qyʻ`. */
const ABKAI_INPUT = new Map(
  LETTERS.filter(([manchu]) => manchu !== "ᡱ").map(([manchu, abkai]) => [abkai, manchu]),
);

const longestFirst = (keys: Iterable<string>): string[] =>
  [...keys].sort((a, b) => b.length - a.length);

const ABKAI_KEYS = longestFirst(ABKAI_INPUT.keys());
const MANCHU_KEYS = longestFirst(LETTERS.map(([manchu]) => manchu));
const TO_ABKAI = new Map(LETTERS.map(([manchu, abkai]) => [manchu, abkai]));
const TO_MOLLENDORFF = new Map(LETTERS.map(([manchu, , mollendorff]) => [manchu, mollendorff]));

export interface Conversion {
  text: string;
  /** Input characters that could not be converted, in order. They are left out of `text`. */
  invalid: string[];
}

function convert(input: string, keys: string[], lookup: (key: string) => string): Conversion {
  let text = "";
  const invalid: string[] = [];
  let index = 0;
  while (index < input.length) {
    const key = keys.find((candidate) => input.startsWith(candidate, index));
    if (key !== undefined) {
      text += lookup(key);
      index += key.length;
    } else if (input[index] === UNREADABLE) {
      text += UNREADABLE;
      index += 1;
    } else {
      invalid.push(input[index] as string);
      index += 1;
    }
  }
  return { text, invalid };
}

/** Removes the variation selectors that stored text leaves out. */
export function stripVariationSelectors(manchu: string): string {
  return manchu.replace(VARIATION_SELECTORS, "");
}

/** Converts typed Abkai to Manchu Unicode. */
export function abkaiToManchu(abkai: string): Conversion {
  const normalized = abkai.trim().toLowerCase().replace(MODIFIER_INPUTS, MODIFIER);
  return convert(normalized, ABKAI_KEYS, (key) => ABKAI_INPUT.get(key) as string);
}

/** Converts Manchu Unicode to Abkai. */
export function manchuToAbkai(manchu: string): Conversion {
  return convert(stripVariationSelectors(manchu), MANCHU_KEYS, (key) => TO_ABKAI.get(key) as string);
}

/** Converts Manchu Unicode to Möllendorff. */
export function manchuToMollendorff(manchu: string): Conversion {
  return convert(
    stripVariationSelectors(manchu),
    MANCHU_KEYS,
    (key) => TO_MOLLENDORFF.get(key) as string,
  );
}

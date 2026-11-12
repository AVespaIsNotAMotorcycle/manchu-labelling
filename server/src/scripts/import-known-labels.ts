/**
 * Imports known answers for crops, which makes those crops hidden checks.
 *
 * Usage:
 *   npm run import-known-labels -w server -- --volume URN-3:FHCL:10499177 --origin "<who supplied them>" <file>
 *
 * The file has one JSON record per line. `crop` is the crop's file name from the segmentation, without
 * or with `.jpg`: page, side, column, and word.
 *
 *   {"crop": "0030_left_04_08", "category": "manchu", "abkai": "manju"}
 *   {"crop": "0031_right_02_00", "category": "chinese"}
 *
 * Every line is checked before anything is imported. A crop that already has a known answer is refused,
 * since answers are only changed through disputes.
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { abkaiToManchu } from "@manchu-labelling/script";
import mongoose, { type Types } from "mongoose";

import { connectDatabase } from "../db.ts";
import { WordImage, WordInstance } from "../models/crops.ts";
import { CATEGORIES, KnownLabel } from "../models/labels.ts";
import { Page, Volume } from "../models/sources.ts";

const CROP_NAME = /^(\d+)_(left|right)_(\d+)_(\d+)(?:\.jpg)?$/;
/** The parts of a crop name that CROP_NAME captures. */
type Position = [name: string, page: string, side: "left" | "right", column: string, word: string];

interface Line {
  crop: string;
  category: string;
  abkai?: string;
}

/** Finds the crop used for the word at a position: the canonical crop of a word that is still in use. */
async function findCrop(volume: Types.ObjectId, name: string): Promise<Types.ObjectId> {
  const match = CROP_NAME.exec(name);
  if (!match) throw new Error(`${name} is not a crop name like 0030_left_04_08`);
  const [, page, side, column, word] = match as unknown as Position;
  const pageRecord = await Page.findOne({ volume, index: Number(page) }, "_id").lean();
  if (!pageRecord) throw new Error(`${name}: there is no page ${Number(page)}`);
  const crops = await WordImage.find(
    { page: pageRecord._id, side, column: Number(column), word: Number(word) },
    "_id instance",
  ).lean();
  for (const crop of crops) {
    const instance = await WordInstance.findById(crop.instance, "canonicalCrop retired").lean();
    if (instance && !instance.retired && String(instance.canonicalCrop) === String(crop._id)) {
      return crop._id;
    }
  }
  throw new Error(`${name}: no crop in use at that position`);
}

export async function importKnownLabels(
  volumeSourceId: string,
  origin: string,
  lines: readonly Line[],
): Promise<number> {
  const volume = await Volume.findOne({ sourceId: volumeSourceId }, "_id").lean();
  if (!volume) throw new Error(`No volume ${volumeSourceId}`);
  if (!origin.trim()) throw new Error("Say who supplied the answers with --origin");

  const records = [];
  const seen = new Set<string>();
  for (const line of lines) {
    if (!(CATEGORIES as readonly string[]).includes(line.category)) {
      throw new Error(`${line.crop}: unknown category ${line.category}`);
    }
    let manchu: string | undefined;
    if (line.category === "manchu") {
      const converted = abkaiToManchu(line.abkai ?? "");
      if (!converted.text || converted.invalid.length > 0 || converted.text.includes("?")) {
        throw new Error(`${line.crop}: ${JSON.stringify(line.abkai)} is not a complete Abkai answer`);
      }
      manchu = converted.text;
    } else if (line.abkai !== undefined) {
      throw new Error(`${line.crop}: only Manchu answers have Abkai`);
    }
    const wordImage = await findCrop(volume._id, line.crop);
    if (seen.has(String(wordImage))) throw new Error(`${line.crop} appears twice`);
    seen.add(String(wordImage));
    if (await KnownLabel.exists({ wordImage })) throw new Error(`${line.crop} already has a known answer`);
    records.push({ wordImage, category: line.category, manchu, origin });
  }
  await KnownLabel.insertMany(records);
  return records.length;
}

async function main(): Promise<void> {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { volume: { type: "string" }, origin: { type: "string" } },
  });
  const [file] = positionals;
  if (!file || !values.volume || !values.origin) {
    throw new Error('Usage: import-known-labels --volume <sourceId> --origin "<who>" <file>');
  }
  const lines: Line[] = (await readFile(resolve(import.meta.dirname, "../../..", file), "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  await connectDatabase();
  const count = await importKnownLabels(values.volume, values.origin, lines);
  console.log(`Imported ${count} known answers`);
  await mongoose.disconnect();
}

if (process.argv[1] === import.meta.filename) await main();

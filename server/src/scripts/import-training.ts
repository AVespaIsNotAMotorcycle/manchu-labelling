/**
 * Imports the quiz image bank made by pipeline/build_training_bank.py.
 *
 * Usage: npm run import-training -w server -- --script regular
 *
 * A bank can only be imported once.
 */

import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { parseArgs } from "node:util";

import { abkaiToManchu, manchuToAbkai } from "@manchu-labelling/script";
import mongoose from "mongoose";

import { connectDatabase } from "../db.ts";
import { isScriptClass, SCRIPT_TYPES } from "../models/sources.ts";
import { TrainingItem } from "../models/training.ts";

const ROOT = resolve(import.meta.dirname, "../../..");

interface BankItem {
  file: string;
  kind: "real" | "synthetic";
  category: "manchu" | "chinese";
  datasetWord?: string;
  manchu?: string;
  source: string;
}

const DATASET_SPELLINGS: Record<string, string> = {
  "c'y": "qy'",
  "ts'": "c",
  dz: "z",
  sy: "sy'",
  c: "q",
  z: "zh",
};

/**
 * Converts the Sun et al. dataset's spelling to Abkai. It is Möllendorff written in ASCII, with x for š and
 * v for ū.
 */
export function datasetWordToAbkai(word: string): string {
  return word.replace(/c'y|ts'|dz|sy(?![aeiou])|c|z/g, (match) => DATASET_SPELLINGS[match] as string);
}

function answerFor(item: BankItem): { abkai?: string; manchu?: string } {
  if (item.category !== "manchu") return {};
  if (item.datasetWord !== undefined) {
    const abkai = datasetWordToAbkai(item.datasetWord);
    const { text, invalid } = abkaiToManchu(abkai);
    if (invalid.length > 0) throw new Error(`Cannot convert ${item.datasetWord}`);
    return { abkai, manchu: text };
  }
  const manchu = item.manchu as string;
  return { abkai: manchuToAbkai(manchu).text, manchu };
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { script: { type: "string" } } });
  const scriptClass = values.script;
  if (!isScriptClass(scriptClass)) {
    throw new Error(`Usage: import-training --script ${SCRIPT_TYPES.join("|")}`);
  }

  const bank = join(ROOT, "data/training");
  const storage = join(ROOT, "data/storage");
  await mkdir(storage, { recursive: true });
  const items: BankItem[] = (await readFile(join(bank, "items.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));

  await connectDatabase();
  await mongoose.connection.syncIndexes();

  if (await TrainingItem.exists({ scriptClass })) {
    throw new Error(`The ${scriptClass} bank is already imported`);
  }

  for (const item of items) {
    const imageKey = `${randomUUID()}${extname(item.file)}`;
    await copyFile(join(bank, item.file), join(storage, imageKey));
    await TrainingItem.create({
      scriptClass,
      kind: item.kind,
      category: item.category,
      imageKey,
      source: item.source,
      ...answerFor(item),
    });
  }
  console.log(`Imported ${items.length} quiz images into ${scriptClass}`);
  await mongoose.disconnect();
}

if (process.argv[1] === import.meta.filename) await main();

/**
 * Imports a segmented volume into the database and copies its images into local storage.
 *
 * Usage: npm run import-segments -w server -- 10499177 --production manuscript --script regular
 *
 * Each import adds a new segmentation run. A crop joins an existing word instance if it shows the same
 * word as a crop from an earlier run, and conflicts with earlier crops are reported for review.
 */

import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

import mongoose, { Types } from "mongoose";

import { connectDatabase } from "../db.ts";
import { compareCrops, type Box } from "../instances.ts";
import { SegmentationRun, WordImage, WordInstance } from "../models/crops.ts";
import { Page, Volume, PRODUCTION_TYPES, SCRIPT_TYPES } from "../models/sources.ts";

const ROOT = resolve(import.meta.dirname, "../../..");

interface PageRecord {
  index: number;
  file: string;
  canvas: string;
  service: string;
  width: number;
  height: number;
}

interface WordRecord {
  file: string;
  image: number;
  side: "left" | "right";
  column: number;
  word: number;
  type: "manchu" | "chinese";
  box: [number, number, number, number];
}

function toBox([x, y, width, height]: WordRecord["box"]): Box {
  return { x, y, width, height };
}

function isOneOf<T extends string>(values: readonly T[], value: string | undefined): value is T {
  return (values as readonly string[]).includes(value ?? "");
}

async function store(source: string, directory: string): Promise<string> {
  const key = `${randomUUID()}.jpg`;
  await copyFile(source, join(directory, key));
  return key;
}

async function main(): Promise<void> {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { production: { type: "string" }, script: { type: "string" } },
  });
  const [volumeId] = positionals;
  const { production, script } = values;
  if (
    !volumeId ||
    !isOneOf(PRODUCTION_TYPES, production) ||
    !isOneOf(SCRIPT_TYPES, script)
  ) {
    throw new Error(
      `Usage: import-segments <id> --production ${PRODUCTION_TYPES.join("|")} --script ${SCRIPT_TYPES.join("|")}`,
    );
  }

  const volumeDirectory = join(ROOT, "data/volumes", volumeId);
  const storage = join(ROOT, "data/storage");
  await mkdir(storage, { recursive: true });
  const manifest = JSON.parse(await readFile(join(volumeDirectory, "manifest.json"), "utf8"));
  const pages: PageRecord[] = JSON.parse(await readFile(join(volumeDirectory, "pages.json"), "utf8"));
  const words: WordRecord[] = (await readFile(join(volumeDirectory, "segments/words.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));

  await connectDatabase();
  await mongoose.connection.syncIndexes();

  const sourceId = `URN-3:FHCL:${volumeId}`;
  const volume =
    (await Volume.findOne({ sourceId })) ??
    (await Volume.create({
      sourceId,
      title: manifest.label,
      manifestUrl: manifest["@id"],
      production,
      script,
      rights: {
        statement: manifest.attribution,
        attribution: "Harvard-Yenching Library, Harvard University",
        permanentLink: `https://nrs.harvard.edu/urn-3:FHCL:${volumeId}`,
      },
    }));

  const pageIds = new Map<number, Types.ObjectId>();
  for (const page of pages) {
    const existing = await Page.findOne({ volume: volume._id, index: page.index });
    const record =
      existing ??
      (await Page.create({
        volume: volume._id,
        index: page.index,
        canvasId: page.canvas,
        imageServiceUrl: page.service,
        imageKey: await store(join(volumeDirectory, "pages", page.file), storage),
        width: page.width,
        height: page.height,
      }));
    pageIds.set(page.index, record._id);
  }

  const pipelineCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT }).toString().trim();
  const run = await SegmentationRun.create({ volume: volume._id, pipelineCommit });

  let reused = 0;
  let conflicts = 0;
  for (const word of words) {
    const page = pageIds.get(word.image);
    if (!page) throw new Error(`No page for image ${word.image}`);
    const box = toBox(word.box);

    const earlierCrops = await WordImage.find({ page, run: { $ne: run._id } }, "box instance").lean();
    const relations = earlierCrops.map((crop) => ({ crop, relation: compareCrops(box, crop.box) }));
    const same = relations.find(({ relation }) => relation === "same");
    if (relations.some(({ relation }) => relation === "conflict")) conflicts += 1;

    const instanceId = same ? same.crop.instance : new Types.ObjectId();
    const crop = await WordImage.create({
      run: run._id,
      page,
      instance: instanceId,
      box,
      side: word.side,
      column: word.column,
      word: word.word,
      columnType: word.type,
      imageKey: await store(join(volumeDirectory, "segments/crops", word.file), storage),
    });

    if (same) reused += 1;
    else await WordInstance.create({ _id: instanceId, page, canonicalCrop: crop._id });
  }

  console.log(
    `Imported ${words.length} crops: ${words.length - reused} new words, ${reused} matched earlier crops, ${conflicts} conflicts`,
  );
  await mongoose.disconnect();
}

await main();

/**
 * Records the DOI of a release once its files are uploaded. It can only be set once.
 *
 * Usage: npm run set-release-doi -w server -- 0.1.0 10.5281/zenodo.1234567 [--url <landing page>]
 */

import { parseArgs } from "node:util";

import mongoose from "mongoose";

import { connectDatabase } from "../db.ts";
import { Release, ReleaseDoi } from "../models/releases.ts";

const { positionals, values } = parseArgs({ allowPositionals: true, options: { url: { type: "string" } } });
const [version, doi] = positionals;
if (!version || !doi || !/^10\.\d{4,9}\/\S+$/.test(doi)) {
  throw new Error("Usage: set-release-doi <version> <doi, such as 10.5281/zenodo.1234567> [--url <url>]");
}

await connectDatabase();
if (!(await Release.exists({ version }))) throw new Error(`No release ${version}`);
if (await ReleaseDoi.exists({ version })) throw new Error(`Release ${version} already has a DOI`);
await ReleaseDoi.create({ version, doi, url: values.url });
console.log(`Release ${version} has DOI ${doi}`);
await mongoose.disconnect();

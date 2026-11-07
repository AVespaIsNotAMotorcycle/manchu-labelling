import type { Schema } from "mongoose";

const BLOCKED_QUERIES = [
  "updateOne",
  "updateMany",
  "replaceOne",
  "findOneAndUpdate",
  "findOneAndReplace",
  "findOneAndDelete",
  "deleteOne",
  "deleteMany",
] as const;

/** Rejects every change to a document after it is created. */
export function appendOnly(schema: Schema): void {
  const reject = (): never => {
    throw new Error("This collection is append-only");
  };

  schema.pre("save", function () {
    if (!this.isNew) reject();
  });
  for (const query of BLOCKED_QUERIES) schema.pre(query, reject);
  schema.pre("deleteOne", { document: true, query: false }, reject);
  schema.pre("bulkWrite", reject);
}

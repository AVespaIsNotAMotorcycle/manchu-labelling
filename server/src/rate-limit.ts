import type { ClientRateLimitInfo, Options, Store } from "express-rate-limit";
import { model, Schema } from "mongoose";

/** A rate limit counter. MongoDB deletes it once its window ends. */
const rateLimitSchema = new Schema({
  _id: { type: String, required: true },
  hits: { type: Number, required: true },
  resetAt: { type: Date, required: true },
});
rateLimitSchema.index({ resetAt: 1 }, { expireAfterSeconds: 0 });

export const RateLimit = model("RateLimit", rateLimitSchema);

/**
 * Keeps rate limit counts in MongoDB, so that they survive a restart and are shared if the API ever runs
 * as more than one process. Each limiter needs its own prefix.
 */
export class MongoRateLimitStore implements Store {
  readonly prefix: string;
  readonly localKeys = false;
  private windowMs = 60_000;

  constructor(prefix: string) {
    this.prefix = `${prefix}:`;
  }

  init(options: Options): void {
    this.windowMs = options.windowMs;
  }

  private id(key: string) {
    return `${this.prefix}${key}`;
  }

  async get(key: string): Promise<ClientRateLimitInfo | undefined> {
    const record = await RateLimit.findById(this.id(key)).lean();
    if (!record || record.resetAt <= new Date()) return undefined;
    return { totalHits: record.hits, resetTime: record.resetAt };
  }

  /** Counts a hit in one atomic update, starting a new window if the old one has ended. */
  async increment(key: string): Promise<ClientRateLimitInfo> {
    const now = new Date();
    const expired = { $lte: [{ $ifNull: ["$resetAt", new Date(0)] }, now] };
    const record = await RateLimit.findOneAndUpdate(
      { _id: this.id(key) },
      [
        {
          $set: {
            hits: { $cond: [expired, 1, { $add: ["$hits", 1] }] },
            resetAt: { $cond: [expired, new Date(now.getTime() + this.windowMs), "$resetAt"] },
          },
        },
      ],
      { upsert: true, returnDocument: "after", updatePipeline: true },
    ).lean();
    return { totalHits: record?.hits ?? 1, resetTime: record?.resetAt };
  }

  async decrement(key: string): Promise<void> {
    await RateLimit.updateOne({ _id: this.id(key), hits: { $gt: 0 } }, { $inc: { hits: -1 } });
  }

  async resetKey(key: string): Promise<void> {
    await RateLimit.deleteOne({ _id: this.id(key) });
  }
}

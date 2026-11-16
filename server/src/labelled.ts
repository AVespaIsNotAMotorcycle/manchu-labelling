import { manchuToAbkai } from "@manchu-labelling/script";
import { Types } from "mongoose";

import { canSettle, settleImages, UNDO_WINDOW_MS, type Status } from "./consensus.ts";
import { WordImage, WordInstance } from "./models/crops.ts";
import { KnownLabel, LabelReview } from "./models/labels.ts";
import { ReleasedWord } from "./models/releases.ts";
import { Page, Volume } from "./models/sources.ts";
import { User } from "./models/users.ts";

export const LABELLED_PAGE_SIZE = 25;

const withAbkai = (manchu?: string | null) => (manchu ? { manchu, abkai: manchuToAbkai(manchu).text } : {});

/**
 * Labelled images that no release has published yet, newest label first, with every user's latest label,
 * for admins. Active hidden checks and words moved to the quiz are left out, since their answers are
 * known and they are not crowd work.
 */
export async function labelledImages(options: { status?: Status; page?: number }) {
  const [settlements, hidden, released] = await Promise.all([
    settleImages(),
    KnownLabel.distinct("wordImage", { state: { $in: ["active", "quiz"] } }),
    ReleasedWord.distinct("instance"),
  ]);
  const hiddenIds = new Set(hidden.map(String));
  const candidates = [...settlements].filter(([id, { labels }]) => labels.length > 0 && !hiddenIds.has(id));
  const crops = await WordImage.find(
    { _id: { $in: candidates.map(([id]) => new Types.ObjectId(id)) } },
    "instance",
  ).lean();
  const instanceOf = new Map(crops.map(({ _id, instance }) => [String(_id), String(instance)]));
  const releasedIds = new Set(released.map(String));
  const unpublished = candidates.filter(([id]) => !releasedIds.has(instanceOf.get(id) ?? ""));

  const counts: Record<string, number> = {};
  for (const [, { status }] of unpublished) counts[status] = (counts[status] ?? 0) + 1;

  const latest = (labels: { createdAt: Date }[]) => Math.max(...labels.map(({ createdAt }) => createdAt.getTime()));
  const matching = unpublished
    .filter(([, { status }]) => !options.status || status === options.status)
    .sort(([, a], [, b]) => latest(b.labels) - latest(a.labels));
  const page = Math.max(0, options.page ?? 0);
  const shown = matching.slice(page * LABELLED_PAGE_SIZE, (page + 1) * LABELLED_PAGE_SIZE);
  const shownIds = shown.map(([id]) => new Types.ObjectId(id));

  const [images, reviews] = await Promise.all([
    WordImage.find({ _id: { $in: shownIds } }).lean(),
    LabelReview.find({ wordImage: { $in: shownIds } }).sort({ createdAt: 1 }).lean(),
  ]);
  const imageById = new Map(images.map((image) => [String(image._id), image]));
  const [pages, instances] = await Promise.all([
    Page.find({ _id: { $in: images.map(({ page }) => page) } }).lean(),
    WordInstance.find({ _id: { $in: images.map(({ instance }) => instance) } }, "heldBack").lean(),
  ]);
  const pageById = new Map(pages.map((record) => [String(record._id), record]));
  const heldBack = new Set(instances.filter(({ heldBack: held }) => held).map(({ _id }) => String(_id)));
  const volumes = await Volume.find({ _id: { $in: pages.map(({ volume }) => volume) } }, "sourceId title").lean();
  const volumeById = new Map(volumes.map((volume) => [String(volume._id), volume]));
  const userIds = [
    ...shown.flatMap(([, { labels }]) => labels.map(({ user }) => user)),
    ...reviews.map(({ reviewer }) => reviewer),
  ];
  const users = await User.find({ _id: { $in: userIds } }, "email").lean();
  const emailOf = new Map(users.map(({ _id, email }) => [String(_id), email]));
  const reviewOf = new Map(reviews.map((review) => [String(review.wordImage), review]));

  return {
    total: matching.length,
    page,
    pageSize: LABELLED_PAGE_SIZE,
    counts,
    items: shown.map(([id, settlement]) => {
      const image = imageById.get(id);
      const pageRecord = pageById.get(String(image?.page));
      if (!image || !pageRecord) throw new Error(`Missing crop or page for ${id}`);
      const volume = volumeById.get(String(pageRecord.volume));
      const review = reviewOf.get(id);
      return {
        id,
        imageUrl: `/api/images/${image.imageKey}`,
        context: {
          pageImageUrl: `/api/images/${pageRecord.imageKey}`,
          width: pageRecord.width,
          height: pageRecord.height,
          box: image.box,
        },
        volume: volume?.title ?? volume?.sourceId,
        pageIndex: pageRecord.index,
        position: { side: image.side, column: image.column, word: image.word },
        heldBack: heldBack.has(String(image.instance)),
        status: settlement.status,
        settled: settlement.settled,
        /** When an agreement or a disagreement waiting for review stops changing, if it has not yet. */
        quietAt:
          !settlement.quiet && settlement.lastLabelAt
            ? new Date(settlement.lastLabelAt.getTime() + UNDO_WINDOW_MS)
            : undefined,
        answer: settlement.answer
          ? { category: settlement.answer.category, ...withAbkai(settlement.answer.manchu) }
          : undefined,
        reviewer: review ? emailOf.get(String(review.reviewer)) : undefined,
        labels: [...settlement.labels]
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
          .map((label) => ({
            labeler: emailOf.get(String(label.user)) ?? "deleted account",
            createdAt: label.createdAt,
            category: label.category,
            ...withAbkai(label.transcription?.manchu),
            trusted: label.trusted,
            sure: canSettle(label),
            production: label.production ?? undefined,
            script: label.script ?? undefined,
          })),
      };
    }),
  };
}

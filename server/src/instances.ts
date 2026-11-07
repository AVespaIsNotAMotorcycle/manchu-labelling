export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Crops this similar show the same word. */
const SAME_WORD_OVERLAP = 0.6;
/** A crop with this much of its area inside another crop cannot be a separate word. */
const CONFLICT_OVERLAP = 0.5;

function intersectionArea(a: Box, b: Box): number {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return width > 0 && height > 0 ? width * height : 0;
}

/**
 * Compares two crops of the same page from different segmentation runs.
 *
 * `same` crops are one word. `conflict` means they overlap too much to be separate words but are not the
 * same word, such as a merged crop and one of the words inside it. A person needs to resolve these.
 */
export function compareCrops(a: Box, b: Box): "same" | "conflict" | "separate" {
  const intersection = intersectionArea(a, b);
  const areaA = a.width * a.height;
  const areaB = b.width * b.height;
  if (intersection / (areaA + areaB - intersection) >= SAME_WORD_OVERLAP) return "same";
  if (intersection / Math.min(areaA, areaB) >= CONFLICT_OVERLAP) return "conflict";
  return "separate";
}

export interface EarlierCrop<Instance, Id = unknown> {
  _id: Id;
  box: Box;
  instance: Instance;
}

/**
 * Decides how a new crop relates to crops from earlier runs. A crop that matches a word has no conflict,
 * even if it also overlaps a neighbour, because small words often sit inside a neighbour's rectangle.
 */
export function matchCrop<Crop extends EarlierCrop<unknown>>(
  box: Box,
  earlierCrops: readonly Crop[],
): { same: Crop[]; conflicts: Crop[] } {
  const same = earlierCrops.filter((crop) => compareCrops(box, crop.box) === "same");
  if (same.length > 0) return { same, conflicts: [] };
  return {
    same,
    conflicts: earlierCrops.filter((crop) => compareCrops(box, crop.box) === "conflict"),
  };
}

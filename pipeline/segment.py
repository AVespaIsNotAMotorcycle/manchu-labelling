"""Segment a downloaded volume's page images into candidate word crops.

Usage: python pipeline/segment.py 10499177 [--pages 3 40 80]

Steps for each image: find the paper, split the spread at the fold, binarize, group connected strokes into
columns, classify each column as Manchu or Chinese, then build words. A Manchu word is one continuous
stem, so words come from connected components, which keeps a word's tail even where it overlaps the next
word. Chinese characters break into several components, so they are grouped by vertical gaps.

Output goes to data/volumes/<id>/segments/:
  crops/        word crops, cut from the original image
  overlays/     images with detected words drawn on (red: Manchu, green: Chinese, blue: fold)
  words.jsonl   one record per crop, with bounding box, column type, and reading order
"""

import argparse
import json
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

DATA_DIR = Path(__file__).resolve().parent.parent / "data" / "volumes"

# Sizes are fractions of the paper height, so they hold across scan resolutions.
BACKGROUND_KERNEL = 0.02
MIN_COMPONENT_AREA = 0.000003
STROKE_BRIDGE = 0.0015
PAGE_MARGIN = 0.02
CROP_PADDING = 0.003
COLUMN_GAP = 0.018
TALL_COMPONENT = 0.05
MIN_MAIN_HEIGHT = 0.012
CHINESE_CHARACTER_GAP = 0.006
ATTACH_DISTANCE = 0.02

# A stroke this narrow and this tall is the page edge or fold rather than writing.
EDGE_MAX_WIDTH = 0.012
EDGE_MIN_HEIGHT = 0.05

# A column is Manchu if at least this share of its ink is in tall connected strokes.
MANCHU_TALL_INK_SHARE = 0.5
# Two strokes are one word if they overlap vertically by this share of the shorter one.
SAME_WORD_OVERLAP = 0.6
# Red ink is marked by how much the red channel exceeds green.
RED_INK_MARGIN = 50


@dataclass
class Box:
    x0: int
    y0: int
    x1: int
    y1: int

    @property
    def height(self) -> int:
        return self.y1 - self.y0

    def union(self, other: "Box") -> "Box":
        return Box(
            min(self.x0, other.x0),
            min(self.y0, other.y0),
            max(self.x1, other.x1),
            max(self.y1, other.y1),
        )


@dataclass
class Component:
    box: Box
    center_x: float
    area: int


def paper_box(gray: np.ndarray) -> Box:
    """Return the bounding box of the paper, which is lighter than the dark scan background."""
    blurred = cv2.GaussianBlur(gray, (0, 0), 9)
    _, mask = cv2.threshold(blurred, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    _, _, stats, _ = cv2.connectedComponentsWithStats(mask)
    largest = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    x, y, width, height, _ = (int(value) for value in stats[largest])
    return Box(x, y, x + width, y + height)


def find_fold(gray: np.ndarray) -> int:
    """Return the x position of the fold.

    Each column's median brightness is used, because text only darkens part of a column while the fold
    runs the full height.
    """
    width = gray.shape[1]
    start, end = int(width * 0.35), int(width * 0.65)
    medians = np.median(gray[:, start:end], axis=0).astype(np.float32)
    smoothed = cv2.blur(medians.reshape(1, -1), (5, 1)).ravel()
    return start + int(np.argmin(smoothed))


def binarize(image: np.ndarray, gray: np.ndarray) -> np.ndarray:
    """Return a mask of black ink, strict enough to drop show-through and excluding red marks."""
    height = gray.shape[0]
    kernel_size = int(height * BACKGROUND_KERNEL) | 1
    small = cv2.resize(gray, None, fx=0.25, fy=0.25, interpolation=cv2.INTER_AREA)
    background = cv2.morphologyEx(
        small,
        cv2.MORPH_CLOSE,
        cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (kernel_size, kernel_size)),
    )
    background = cv2.resize(background, (gray.shape[1], gray.shape[0]))
    normalized = np.clip(gray.astype(np.float32) / np.maximum(background, 1) * 255, 0, 255)
    normalized = normalized.astype(np.uint8)
    threshold, _ = cv2.threshold(normalized, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)

    blue, green, red = cv2.split(image.astype(np.int16))
    red_ink = (red - green) > RED_INK_MARGIN
    red_ink = cv2.dilate(red_ink.astype(np.uint8), np.ones((5, 5), np.uint8)).astype(bool)
    return (normalized < threshold * 0.85) & ~red_ink


def find_components(ink: np.ndarray, paper_height: int) -> list[Component]:
    """Return connected strokes, bridging the small vertical breaks left by a dry pen."""
    bridge = max(1, int(paper_height * STROKE_BRIDGE))
    kernel = np.ones((2 * bridge + 1, 1), np.uint8)
    bridged = cv2.dilate(ink.astype(np.uint8), kernel)
    count, labels, stats, _ = cv2.connectedComponentsWithStats(bridged, connectivity=8)
    min_area = MIN_COMPONENT_AREA * paper_height * paper_height

    components = []
    for label in range(1, count):
        x, y, width, height, _ = (int(value) for value in stats[label])
        window = (labels[y : y + height, x : x + width] == label) & ink[y : y + height, x : x + width]
        area = int(window.sum())
        if area < min_area:
            continue
        ys, xs = np.nonzero(window)
        box = Box(x + int(xs.min()), y + int(ys.min()), x + int(xs.max()) + 1, y + int(ys.max()) + 1)
        is_edge = (
            box.x1 - box.x0 < paper_height * EDGE_MAX_WIDTH
            and box.height > paper_height * EDGE_MIN_HEIGHT
        )
        if not is_edge:
            components.append(Component(box, x + float(np.median(xs)), area))
    return components


def group_columns(components: list[Component], paper_height: int) -> list[list[Component]]:
    """Group components into columns from left to right, by each one's median ink position.

    The median ignores a word's tail, which sweeps sideways into the neighbouring column. Columns are
    formed from main strokes only, because small marks between columns would chain them together.
    """
    gap = paper_height * COLUMN_GAP
    min_height = paper_height * MIN_MAIN_HEIGHT
    main = [item for item in components if item.box.height >= min_height]
    small = [item for item in components if item.box.height < min_height]

    columns: list[list[Component]] = []
    for component in sorted(main, key=lambda item: item.center_x):
        if columns and component.center_x - columns[-1][-1].center_x < gap:
            columns[-1].append(component)
        else:
            columns.append([component])

    if columns:
        centers = [float(np.median([item.center_x for item in column])) for column in columns]
        for item in small:
            nearest = int(np.argmin([abs(item.center_x - center) for center in centers]))
            columns[nearest].append(item)
    return columns


def is_manchu_column(column: list[Component], paper_height: int) -> bool:
    total = sum(item.area for item in column)
    tall = sum(item.area for item in column if item.box.height >= paper_height * TALL_COMPONENT)
    return tall >= total * MANCHU_TALL_INK_SHARE


def vertical_overlap(a: Box, b: Box) -> int:
    return min(a.y1, b.y1) - max(a.y0, b.y0)


def manchu_words(column: list[Component], paper_height: int) -> list[Box]:
    """Build words from a column's strokes, attaching dots and circles to the word beside them."""
    main = [item for item in column if item.box.height >= paper_height * MIN_MAIN_HEIGHT]
    small = [item for item in column if item.box.height < paper_height * MIN_MAIN_HEIGHT]

    words: list[Box] = []
    for item in sorted(main, key=lambda value: value.box.y0):
        box = item.box
        if words:
            shorter = min(words[-1].height, box.height)
            if vertical_overlap(words[-1], box) >= shorter * SAME_WORD_OVERLAP:
                words[-1] = words[-1].union(box)
                continue
        words.append(box)

    # Marks below or between words are punctuation, so they are left out.
    attach_distance = paper_height * ATTACH_DISTANCE
    for item in small:
        for index, word in enumerate(words):
            inside = word.y0 <= item.box.y0 and item.box.y1 <= word.y1
            if inside and item.box.x0 - word.x1 < attach_distance:
                words[index] = word.union(item.box)
                break
    return words


def chinese_characters(column: list[Component], paper_height: int) -> list[Box]:
    """Group a column's components into characters, split at vertical gaps."""
    gap = paper_height * CHINESE_CHARACTER_GAP
    characters: list[Box] = []
    for item in sorted(column, key=lambda value: value.box.y0):
        if characters and item.box.y0 - characters[-1].y1 < gap:
            characters[-1] = characters[-1].union(item.box)
        else:
            characters.append(item.box)
    min_height = paper_height * MIN_MAIN_HEIGHT
    return [box for box in characters if box.height >= min_height]


def segment_side(image: np.ndarray, gray: np.ndarray, paper_height: int) -> list[dict]:
    """Return the word boxes on one side of a spread, in that side's coordinates."""
    ink = binarize(image, gray)
    height, width = ink.shape
    margin = int(paper_height * PAGE_MARGIN)
    ink[:margin] = False
    ink[height - margin :] = False
    ink[:, :margin] = False
    ink[:, width - margin :] = False

    results = []
    for column_index, column in enumerate(group_columns(find_components(ink, paper_height), paper_height)):
        manchu = is_manchu_column(column, paper_height)
        boxes = manchu_words(column, paper_height) if manchu else chinese_characters(column, paper_height)
        for word_index, box in enumerate(boxes):
            results.append(
                {
                    "column": column_index,
                    "word": word_index,
                    "type": "manchu" if manchu else "chinese",
                    "box": box,
                }
            )
    return results


def process_image(path: Path, output: Path, record: dict) -> list[dict]:
    image = cv2.imread(str(path))
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    paper = paper_box(gray)
    paper_height = paper.height
    paper_image = image[paper.y0 : paper.y1, paper.x0 : paper.x1]
    paper_gray = gray[paper.y0 : paper.y1, paper.x0 : paper.x1]
    fold = find_fold(paper_gray)

    overlay = image.copy()
    cv2.line(overlay, (paper.x0 + fold, 0), (paper.x0 + fold, image.shape[0]), (255, 0, 0), 4)
    padding = int(paper_height * CROP_PADDING)
    colors = {"manchu": (0, 0, 255), "chinese": (0, 160, 0)}
    records = []
    for side, start, end in (("left", 0, fold), ("right", fold, paper_image.shape[1])):
        for item in segment_side(paper_image[:, start:end], paper_gray[:, start:end], paper_height):
            box = item["box"]
            x0 = max(paper.x0 + start + box.x0 - padding, 0)
            y0 = max(paper.y0 + box.y0 - padding, 0)
            x1 = min(paper.x0 + start + box.x1 + padding, image.shape[1])
            y1 = min(paper.y0 + box.y1 + padding, image.shape[0])
            name = f"{record['index']:04d}_{side}_{item['column']:02d}_{item['word']:02d}.jpg"
            cv2.imwrite(str(output / "crops" / name), image[y0:y1, x0:x1])
            cv2.rectangle(overlay, (x0, y0), (x1, y1), colors[item["type"]], 3)
            records.append(
                {
                    "file": name,
                    "image": record["index"],
                    "canvas": record["canvas"],
                    "side": side,
                    "column": item["column"],
                    "word": item["word"],
                    "type": item["type"],
                    "box": [x0, y0, x1 - x0, y1 - y0],
                }
            )
    cv2.imwrite(str(output / "overlays" / f"{record['index']:04d}.jpg"), overlay)
    return records


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("volume_id")
    parser.add_argument("--pages", type=int, nargs="*", help="Image numbers to process (default: all)")
    args = parser.parse_args()

    volume_dir = DATA_DIR / args.volume_id
    output = volume_dir / "segments"
    (output / "crops").mkdir(parents=True, exist_ok=True)
    (output / "overlays").mkdir(parents=True, exist_ok=True)

    pages = json.loads((volume_dir / "pages.json").read_text())
    selected = [page for page in pages if not args.pages or page["index"] in args.pages]
    with (output / "words.jsonl").open("w") as words_file:
        for page in selected:
            records = process_image(volume_dir / "pages" / page["file"], output, page)
            for item in records:
                words_file.write(json.dumps(item) + "\n")
            manchu = sum(item["type"] == "manchu" for item in records)
            print(f"image {page['index']}: {manchu} Manchu, {len(records) - manchu} Chinese", flush=True)


if __name__ == "__main__":
    main()

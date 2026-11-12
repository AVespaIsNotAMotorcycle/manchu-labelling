"""Pair a volume's word crops with an existing transcription, to make candidates for review.

Usage:
  python pipeline/align_transcription.py PPN3306132969 --image-offset 1 --reference 10499177

Reads data/volumes/<id>/transcription.txt, in the form manc.hu's reader gives: "Page N" headings, then
one numbered line per column. Each transcription page N is matched to image N + offset. Manchu columns
are read from left to right, so a page's lines are paired with its columns in that order.

Within a column, crops are lined up with words from top to bottom by size: a crop's height should fit
the word's length. Crops can be skipped, since a column may also hold Chinese, and words can be skipped,
since segmentation misses some. A classifier trained on a reference volume with unmixed columns says how
Chinese each crop looks, which makes Chinese crops cheap to skip and costly to match. Merged and split words are allowed for but never become candidates. Only
confident one-to-one matches are written, to data/volumes/<id>/candidates.jsonl, for review with
review_candidates.py. A candidate is a guess until someone confirms it.
"""

import argparse
import json
import math
import re
import subprocess
from collections import defaultdict
from pathlib import Path

from script_classifier import ScriptClassifier, reference_crops

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data" / "volumes"

# Tokens in manc.hu's text that are not words: "[]" marks a break, where this volume has Chinese.
NOT_WORDS = re.compile(r"^(\[\s*\]|\[|\]|•|\[\d+\])$")
# Expected height in letters, plus a constant for the start and the final tail.
WORD_OVERHEAD = 1.0
# How far a crop's height may stray from the expected height, as a log ratio.
SPREAD = 0.35
# A candidate's match must be at least this close.
MAX_CANDIDATE_COST = 1.0
# Skipping a crop costs this much when it looks Manchu, and nothing when it looks Chinese.
SKIP_MANCHU_CROP = 3.0
# Matching a word to a crop costs this much more when the crop looks Chinese.
CHINESE_MATCH_PENALTY = 6.0
SKIP_WORD = 3.0
MERGE_PENALTY = 1.5
# Columns with less ink than this share of the fullest column are marks or noise.
MIN_COLUMN_SHARE = 0.15


def parse_transcription(path: Path) -> dict[int, list[tuple[int, list[str]]]]:
    """Returns each page's lines, as (line number, words)."""
    pages: dict[int, list[tuple[int, list[str]]]] = defaultdict(list)
    page = None
    for raw in path.read_text().splitlines():
        line = raw.strip()
        heading = re.fullmatch(r"Page (\d+)", line)
        if heading:
            page = int(heading.group(1))
            continue
        numbered = re.fullmatch(r"(\d+)\s+(.*)", line)
        if page is None or not numbered:
            continue
        words = [token for token in numbered.group(2).split() if not NOT_WORDS.match(token)]
        pages[page].append((int(numbered.group(1)), words))
    return pages


def to_manchu(words: list[str]) -> dict[str, str | None]:
    """Converts Abkai with the project's own converter, so candidates match what the app would store."""
    script = (
        "import { abkaiToManchu } from './packages/script/src/index.ts';"
        "let input = '';"
        "process.stdin.on('data', (chunk) => (input += chunk));"
        "process.stdin.on('end', () => {"
        "  const out = {};"
        "  for (const word of JSON.parse(input)) {"
        "    const { text, invalid } = abkaiToManchu(word);"
        "    out[word] = invalid.length || !text ? null : text;"
        "  }"
        "  console.log(JSON.stringify(out));"
        "});"
    )
    result = subprocess.run(
        ["node", "--input-type=module", "-e", script],
        input=json.dumps(sorted(set(words))),
        capture_output=True,
        text=True,
        cwd=ROOT,
        check=True,
    )
    return json.loads(result.stdout)


def letters(word: str) -> int:
    return len(re.sub(r"[^a-z]", "", word.replace("ng", "N")))


def expected(unit: float, length: int) -> float:
    return unit * (length + WORD_OVERHEAD)


def fit(height: float, unit: float, length: int) -> float:
    return (math.log(height / expected(unit, length)) / SPREAD) ** 2


def align(crops: list[dict], words: list[str], unit: float) -> list[tuple[int, int, float]]:
    """Lines up a column's crops with its words. Returns one-to-one matches as (crop, word, cost)."""
    n, m = len(crops), len(words)
    heights = [crop["box"][3] for crop in crops]
    chinese = [crop["chinese"] for crop in crops]
    lengths = [letters(word) for word in words]
    inf = float("inf")
    cost = [[inf] * (m + 1) for _ in range(n + 1)]
    back: list[list[tuple | None]] = [[None] * (m + 1) for _ in range(n + 1)]
    cost[0][0] = 0.0

    def relax(i: int, j: int, value: float, step: tuple) -> None:
        if value < cost[i][j]:
            cost[i][j] = value
            back[i][j] = step

    for i in range(n + 1):
        for j in range(m + 1):
            here = cost[i][j]
            if here == inf:
                continue
            if i < n:
                relax(i + 1, j, here + SKIP_MANCHU_CROP * (1 - chinese[i]), ("skip-crop",))
            if j < m:
                relax(i, j + 1, here + SKIP_WORD, ("skip-word",))
            if i < n and j < m:
                match = fit(heights[i], unit, lengths[j]) + CHINESE_MATCH_PENALTY * chinese[i]
                relax(i + 1, j + 1, here + match, ("match",))
            if i + 1 < n and j < m:
                merged = heights[i] + heights[i + 1]
                penalty = MERGE_PENALTY + CHINESE_MATCH_PENALTY * max(chinese[i], chinese[i + 1])
                relax(i + 2, j + 1, here + fit(merged, unit, lengths[j]) + penalty, ("split",))
            if i < n and j + 1 < m:
                both = lengths[j] + lengths[j + 1] + WORD_OVERHEAD
                penalty = MERGE_PENALTY + CHINESE_MATCH_PENALTY * chinese[i]
                relax(i + 1, j + 2, here + fit(heights[i], unit, both) + penalty, ("merged",))

    matches = []
    i, j = n, m
    while i or j:
        step = back[i][j]
        if step is None:
            break
        kind = step[0]
        if kind == "skip-crop":
            i -= 1
        elif kind == "skip-word":
            j -= 1
        elif kind == "match":
            i, j = i - 1, j - 1
            matches.append((i, j, fit(heights[i], unit, lengths[j]) + CHINESE_MATCH_PENALTY * chinese[i]))
        elif kind == "split":
            i, j = i - 2, j - 1
        else:
            i, j = i - 1, j - 2
    return list(reversed(matches))


def page_columns(records: list[dict]) -> list[list[dict]]:
    """A page's columns from left to right, leaving out ones too faint to be text."""
    columns: dict[int, list[dict]] = defaultdict(list)
    for record in records:
        columns[record["column"]].append(record)
    ordered = [sorted(columns[key], key=lambda item: item["box"][1]) for key in sorted(columns)]
    ink = [sum(item["box"][3] for item in column) for column in ordered]
    biggest = max(ink, default=0)
    return [column for column, total in zip(ordered, ink) if total >= biggest * MIN_COLUMN_SHARE]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("volume_id")
    parser.add_argument("--image-offset", type=int, required=True, help="Image number minus page number")
    parser.add_argument("--reference", required=True, help="A volume with unmixed columns, to train on")
    args = parser.parse_args()
    classifier = ScriptClassifier.train(*reference_crops(DATA_DIR / args.reference, 5000))

    volume_dir = DATA_DIR / args.volume_id
    transcription = parse_transcription(volume_dir / "transcription.txt")
    words_by_image: dict[int, list[dict]] = defaultdict(list)
    for line in (volume_dir / "segments" / "words.jsonl").read_text().splitlines():
        record = json.loads(line)
        record["chinese"] = classifier.chinese_probability(volume_dir / "segments" / "crops" / record["file"])
        words_by_image[record["image"]].append(record)
    manchu = to_manchu([word for lines in transcription.values() for _, words in lines for word in words])

    candidates = []
    for page, lines in sorted(transcription.items()):
        image = page + args.image_offset
        columns = page_columns(words_by_image.get(image, []))
        if len(columns) != len(lines):
            print(f"page {page} (image {image}): {len(columns)} columns but {len(lines)} lines, skipped")
            continue

        # A letter's height on this page, refined from the matches each round.
        pairs = list(zip(columns, lines))
        all_heights = sorted(crop["box"][3] for column in columns for crop in column)
        all_lengths = sorted(letters(word) for _, words in lines for word in words)
        unit = all_heights[len(all_heights) // 2] / (all_lengths[len(all_lengths) // 2] + WORD_OVERHEAD)
        for _ in range(3):
            ratios = []
            for column, (_, words) in pairs:
                for i, j, _cost in align(column, words, unit):
                    ratios.append(column[i]["box"][3] / (letters(words[j]) + WORD_OVERHEAD))
            if ratios:
                unit = sorted(ratios)[len(ratios) // 2]

        page_candidates = 0
        for column, (line_number, words) in pairs:
            for i, j, cost in align(column, words, unit):
                if cost > MAX_CANDIDATE_COST or not manchu.get(words[j]):
                    continue
                crop = column[i]
                candidates.append(
                    {
                        "crop": crop["file"].removesuffix(".jpg"),
                        "box": crop["box"],
                        "abkai": words[j],
                        "manchu": manchu[words[j]],
                        "page": page,
                        "line": line_number,
                        "position": j,
                        "words": words,
                        "cost": round(cost, 3),
                    }
                )
                page_candidates += 1
        print(f"page {page} (image {image}): {page_candidates} candidates")

    with (volume_dir / "candidates.jsonl").open("w") as output:
        for candidate in candidates:
            output.write(json.dumps(candidate, ensure_ascii=False) + "\n")
    print(f"{len(candidates)} candidates")


if __name__ == "__main__":
    main()

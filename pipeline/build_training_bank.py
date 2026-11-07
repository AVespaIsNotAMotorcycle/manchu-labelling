"""Build the bank of quiz images for one script class.

Usage:
  python pipeline/build_training_bank.py \\
    --photos ../dots-and-circles/ocr/non_synthetic_data \\
    --lexicon ../dots-and-circles/ocr/training_data/lexicon.json \\
    --fonts client/src/fonts \\
    --volume 10499177

Output goes to data/training/: images, and items.jsonl with one record per image.

The bank mixes three kinds of image:
  - printed words from Sun et al. (2026), with one photo per word
  - Chinese crops from a volume's Chinese columns, as images that are not Manchu
  - synthetic words rendered from a lexicon, which can be made in any number

Every Chinese crop was reviewed by eye, and pipeline/chinese_exclusions.txt lists the ones rejected.
"""

import argparse
import json
import random
import re
import shutil
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "data" / "training"
EXCLUSIONS = Path(__file__).resolve().parent / "chinese_exclusions.txt"

SEED = 1906
RENDER_SIZE = 96
PADDING = 12
SYNTHETIC_WORDS = 600
CHINESE_CROPS = 70
# Chinese characters are about square, so this drops crops holding several characters or stray strokes.
MIN_CHINESE_ASPECT, MAX_CHINESE_ASPECT = 0.7, 1.4

SUN_SOURCE = "Sun, Tao & Bi (2026), doi:10.57760/sciencedb.25676, CC BY 4.0"
VARIATION_SELECTORS = re.compile("[᠋-᠍᠏]")
MANCHU_WORD = re.compile("[ᠠ-ᡷ]+")


def add_sun_photos(photos: Path, rng: random.Random) -> list[dict]:
    items = []
    destination = OUTPUT / "sun"
    destination.mkdir(parents=True, exist_ok=True)
    for folder in sorted(path for path in photos.iterdir() if path.is_dir()):
        photo = rng.choice(sorted(folder.glob("*.png")))
        name = f"{len(items):05d}.png"
        shutil.copyfile(photo, destination / name)
        items.append(
            {
                "file": f"sun/{name}",
                "kind": "real",
                "category": "manchu",
                "datasetWord": folder.name,
                "source": SUN_SOURCE,
            }
        )
    return items


def add_chinese_crops(volume: str, rng: random.Random) -> list[dict]:
    segments = ROOT / "data" / "volumes" / volume / "segments"
    words = [json.loads(line) for line in (segments / "words.jsonl").read_text().splitlines()]
    excluded = set(EXCLUSIONS.read_text().split()) if EXCLUSIONS.exists() else set()

    def is_candidate(word: dict) -> bool:
        _, _, width, height = word["box"]
        return (
            word["type"] == "chinese"
            and MIN_CHINESE_ASPECT <= width / height <= MAX_CHINESE_ASPECT
        )

    destination = OUTPUT / "chinese"
    destination.mkdir(parents=True, exist_ok=True)
    items = []
    # Exclusions are dropped after sampling, so that the images already reviewed stay the same.
    for word in rng.sample([word for word in words if is_candidate(word)], CHINESE_CROPS):
        if word["file"] in excluded:
            continue
        shutil.copyfile(segments / "crops" / word["file"], destination / word["file"])
        items.append(
            {
                "file": f"chinese/{word['file']}",
                "kind": "real",
                "category": "chinese",
                "source": f"Harvard-Yenching Library, URN-3:FHCL:{volume}",
            }
        )
    return items


def render(word: str, font_path: Path) -> Image.Image:
    """Render a word so that it reads from top to bottom."""
    font = ImageFont.truetype(str(font_path), RENDER_SIZE)
    left, top, right, bottom = font.getbbox(word)
    margin = RENDER_SIZE // 2
    canvas = Image.new("L", (right - left + 2 * margin, bottom - top + 2 * margin), 255)
    ImageDraw.Draw(canvas).text((margin - left, margin - top), word, font=font, fill=0)
    blank = Image.new("L", canvas.size, 255)
    ink = ImageChops.difference(canvas, blank).getbbox()
    word_image = canvas.crop(ink).rotate(-90, expand=True)
    padded = Image.new(
        "L", (word_image.width + 2 * PADDING, word_image.height + 2 * PADDING), 255
    )
    padded.paste(word_image, (PADDING, PADDING))
    return padded


def add_synthetic_words(lexicon: Path, fonts: Path, rng: random.Random) -> list[dict]:
    entries = {VARIATION_SELECTORS.sub("", entry) for entry in json.loads(lexicon.read_text())}
    words = sorted(entry for entry in entries if MANCHU_WORD.fullmatch(entry))
    font_paths = sorted(fonts.glob("*.ttf"))

    destination = OUTPUT / "synthetic"
    destination.mkdir(parents=True, exist_ok=True)
    items = []
    for index, word in enumerate(rng.sample(words, SYNTHETIC_WORDS)):
        name = f"{index:05d}.png"
        render(word, font_paths[index % len(font_paths)]).save(destination / name)
        items.append(
            {
                "file": f"synthetic/{name}",
                "kind": "synthetic",
                "category": "manchu",
                "manchu": word,
                "source": "Rendered from a lexicon",
            }
        )
    return items


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--photos", type=Path, required=True)
    parser.add_argument("--lexicon", type=Path, required=True)
    parser.add_argument("--fonts", type=Path, required=True)
    parser.add_argument("--volume", required=True)
    args = parser.parse_args()

    if OUTPUT.exists():
        shutil.rmtree(OUTPUT)
    OUTPUT.mkdir(parents=True)

    rng = random.Random(SEED)
    items = [
        *add_sun_photos(args.photos, rng),
        *add_chinese_crops(args.volume, rng),
        *add_synthetic_words(args.lexicon, args.fonts, rng),
    ]
    with (OUTPUT / "items.jsonl").open("w") as file:
        for item in items:
            file.write(json.dumps(item, ensure_ascii=False) + "\n")
    print(f"Wrote {len(items)} items")


if __name__ == "__main__":
    main()

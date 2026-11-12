"""Mark each crop of a mixed-column volume as Manchu or Chinese, so that only Manchu crops are labelled.

Usage:
  python pipeline/classify_scripts.py PPN3306132969 --reference 10499177

segment.py --mixed-columns marks every crop as Manchu. This writes data/volumes/<id>/segments/scripts.jsonl,
which import-segments reads in place of those marks. Chinese crops are still imported, as in volumes
with Chinese columns, but the labelling queue leaves them out.

A classifier trained on a reference volume with unmixed columns is sure about most crops, but not about
a manuscript's own hand. Its surest crops on this volume train a second classifier, which also knows each
crop's width relative to the page's Manchu words, since Chinese characters are wider than short Manchu
words. Crops confirmed as words in review_candidates.py are always Manchu.
"""

import argparse
import json
import statistics
from pathlib import Path

import numpy as np

from script_classifier import ScriptClassifier, features, reference_crops

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data" / "volumes"
# The reference classifier's probabilities that this volume's classifier takes as certain.
SURE_MANCHU = 0.05
SURE_CHINESE = 0.97


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("volume_id")
    parser.add_argument("--reference", required=True, help="A volume with unmixed columns, to train on")
    args = parser.parse_args()
    volume_dir = DATA_DIR / args.volume_id
    crops_dir = volume_dir / "segments" / "crops"
    records = [json.loads(line) for line in (volume_dir / "segments" / "words.jsonl").read_text().splitlines()]

    confirmed = set()
    decisions = volume_dir / "decisions.jsonl"
    if decisions.exists():
        latest = {}
        for line in decisions.read_text().splitlines():
            entry = json.loads(line)
            latest[entry["crop"]] = entry["decision"]
        confirmed = {f"{crop}.jpg" for crop, decision in latest.items() if decision == "yes"}

    reference = ScriptClassifier.train(*reference_crops(DATA_DIR / args.reference, 5000))
    shapes = {record["file"]: features(crops_dir / record["file"]) for record in records}
    first = {name: reference.probability(row) for name, row in shapes.items()}

    widths: dict[int, list[int]] = {}
    for record in records:
        if first[record["file"]] < SURE_MANCHU or record["file"] in confirmed:
            widths.setdefault(record["image"], []).append(record["box"][2])
    typical = statistics.median(width for page in widths.values() for width in page)
    page_width = {image: statistics.median(values) for image, values in widths.items()}

    def row(record: dict) -> np.ndarray:
        relative = np.log(record["box"][2] / page_width.get(record["image"], typical))
        return np.concatenate([shapes[record["file"]][:-1], [relative, relative**2, 1.0]])

    rows = {record["file"]: row(record) for record in records}
    manchu = [name for name in rows if name in confirmed or first[name] < SURE_MANCHU]
    chinese = [name for name in rows if name not in confirmed and first[name] > SURE_CHINESE]
    volume = ScriptClassifier.fit(
        np.stack([rows[name] for name in manchu + chinese]),
        [False] * len(manchu) + [True] * len(chinese),
        steps=600,
    )

    counts = {"manchu": 0, "chinese": 0}
    with (volume_dir / "segments" / "scripts.jsonl").open("w") as output:
        for record in records:
            name = record["file"]
            probability = volume.probability(rows[name])
            kind = "manchu" if name in confirmed or probability < 0.5 else "chinese"
            counts[kind] += 1
            output.write(json.dumps({"file": name, "type": kind, "chinese": round(probability, 3)}) + "\n")
    print(f"Trained on {len(manchu)} Manchu and {len(chinese)} Chinese crops. "
          f"{counts['manchu']} crops look Manchu and {counts['chinese']} look Chinese.")


if __name__ == "__main__":
    main()

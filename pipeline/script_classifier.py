"""Tells Manchu word crops from Chinese character crops, for volumes whose columns mix the two.

The classifier is trained on a volume whose columns are all one or the other, such as the trial volume,
where segment.py's column types label every crop. It uses each crop's shape and ink layout, so it does
not need any reading of the text.
"""

import json
import random
from pathlib import Path

import cv2
import numpy as np

SIZE = 24


def features(path: Path) -> np.ndarray:
    gray = cv2.imread(str(path), cv2.IMREAD_GRAYSCALE)
    height, width = gray.shape
    _, ink = cv2.threshold(gray, 0, 1, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    # Pad to a square, so that a tall word and a square character keep their shapes.
    side = max(height, width)
    square = np.zeros((side, side), np.float32)
    top, left = (side - height) // 2, (side - width) // 2
    square[top : top + height, left : left + width] = ink
    small = cv2.resize(square, (SIZE, SIZE), interpolation=cv2.INTER_AREA).ravel()
    aspect = np.log(height / max(width, 1))
    return np.concatenate([small, [aspect, aspect**2, 1.0]])


class ScriptClassifier:
    def __init__(self, weights: np.ndarray, mean: np.ndarray, scale: np.ndarray):
        self.weights, self.mean, self.scale = weights, mean, scale

    @classmethod
    def train(cls, crops: list[Path], is_chinese: list[bool], steps: int = 400) -> "ScriptClassifier":
        x = np.stack([features(path) for path in crops])
        y = np.array(is_chinese, dtype=np.float32)
        mean, scale = x.mean(axis=0), x.std(axis=0) + 1e-6
        mean[-1], scale[-1] = 0.0, 1.0
        x = (x - mean) / scale
        weights = np.zeros(x.shape[1])
        for _ in range(steps):
            p = 1 / (1 + np.exp(-x @ weights))
            gradient = x.T @ (p - y) / len(y) + 1e-3 * weights
            weights -= 0.5 * gradient
        return cls(weights, mean, scale)

    def chinese_probability(self, path: Path) -> float:
        x = (features(path) - self.mean) / self.scale
        return float(1 / (1 + np.exp(-x @ self.weights)))


def reference_crops(volume_dir: Path, limit: int, seed: int = 0) -> tuple[list[Path], list[bool]]:
    """Crops from a volume with unmixed columns, labelled by their column type."""
    records = [json.loads(line) for line in (volume_dir / "segments" / "words.jsonl").read_text().splitlines()]
    random.Random(seed).shuffle(records)
    records = records[:limit]
    paths = [volume_dir / "segments" / "crops" / record["file"] for record in records]
    return paths, [record["type"] == "chinese" for record in records]

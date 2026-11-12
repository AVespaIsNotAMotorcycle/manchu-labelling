"""Review candidate labels from align_transcription.py: yes if the crop shows the word, no if not.

Usage:
  python pipeline/review_candidates.py PPN3306132969              # opens http://127.0.0.1:8765
  python pipeline/review_candidates.py PPN3306132969 --export known.jsonl

Decisions are appended to data/volumes/<id>/decisions.jsonl, and the latest one for a crop counts, so
nothing is lost. --export writes the confirmed crops in the form import-known-labels reads.

Decisions belong to this segmentation's crops. Do not re-run segment.py on the volume before its crops
are imported, or the crop names may point at different boxes.
"""

import argparse
import json
import re
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data" / "volumes"
CROP_NAME = re.compile(r"^\d{4}_(left|right)_\d{2}_\d{2}$")
FONTS = [
    ROOT / "client/src/fonts/XM_WenQin.ttf",
    ROOT / "node_modules/@fontsource/noto-sans-mongolian/files/noto-sans-mongolian-mongolian-400-normal.woff2",
]

PAGE = """<!doctype html>
<html lang="en">
<meta charset="utf-8">
<title>Review candidates</title>
<style>
  @font-face { font-family: Manchu; src: url(/font); }
  body { margin: 0; font-family: Arial, sans-serif; color: #171717; background: #fff; }
  main { display: flex; gap: 2rem; padding: 1.5rem; align-items: flex-start; }
  figure { margin: 0; }
  figcaption { color: #666; font-size: 0.85rem; margin-bottom: 0.25rem; }
  #crop { max-height: 70vh; min-height: 12rem; image-rendering: auto; }
  #context { max-height: 80vh; }
  .manchu { font-family: Manchu, serif; writing-mode: vertical-lr; font-size: 5rem; min-height: 12rem; }
  .abkai { font-size: 2rem; font-weight: 700; }
  .line { color: #666; max-width: 24rem; }
  .line b { color: #171717; text-decoration: underline; }
  button { font: inherit; font-size: 1.25rem; padding: 0.5rem 1.25rem; border: 2px solid #171717;
           border-radius: 5px; background: #fff; cursor: pointer; margin-right: 0.5rem; }
  #yes { background: #008000; border-color: #008000; color: #fff; }
  #no { background: #e00000; border-color: #e00000; color: #fff; }
  header { padding: 1rem 1.5rem 0; color: #666; }
</style>
<header id="progress"></header>
<main>
  <figure><figcaption>Crop</figcaption><img id="crop" alt="The crop"></figure>
  <figure><figcaption>Proposed label</figcaption>
    <div class="abkai" id="abkai"></div>
    <div class="manchu" id="manchu" lang="mnc"></div>
  </figure>
  <div>
    <p class="line" id="line"></p>
    <p>Does the crop show exactly this word, and nothing more?</p>
    <p>
      <button id="yes" type="button">Yes (Y)</button>
      <button id="no" type="button">No (N)</button>
      <button id="undo" type="button">Undo (U)</button>
    </p>
  </div>
  <figure><figcaption>On the page</figcaption><img id="context" alt="The crop on its page"></figure>
</main>
<script>
let current = null;
async function load() {
  const state = await (await fetch("/api/state")).json();
  document.getElementById("progress").textContent =
    `${state.decided} of ${state.total} reviewed: ${state.yes} yes, ${state.no} no`;
  current = state.current;
  for (const id of ["yes", "no"]) document.getElementById(id).disabled = !current;
  if (!current) {
    document.querySelector("main").firstElementChild.textContent = "All candidates are reviewed.";
    return;
  }
  document.getElementById("crop").src = `/crop/${current.crop}`;
  document.getElementById("context").src = `/context/${current.crop}`;
  document.getElementById("abkai").textContent = current.abkai;
  document.getElementById("manchu").textContent = current.manchu;
  const line = document.getElementById("line");
  line.replaceChildren(`Page ${current.page}, line ${current.line}: `);
  current.words.forEach((word, index) => {
    const part = index === current.position ? document.createElement("b") : document.createElement("span");
    part.textContent = word + " ";
    line.append(part);
  });
}
async function send(path, body) {
  await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  load();
}
const decide = (decision) => current && send("/api/decision", { crop: current.crop, decision });
document.getElementById("yes").onclick = () => decide("yes");
document.getElementById("no").onclick = () => decide("no");
document.getElementById("undo").onclick = () => send("/api/undo", {});
document.addEventListener("keydown", (event) => {
  const key = event.key.toLowerCase();
  if (key === "y") decide("yes");
  else if (key === "n") decide("no");
  else if (key === "u") send("/api/undo", {});
});
load();
</script>
</html>
"""


class Review:
    def __init__(self, volume_dir: Path):
        self.volume_dir = volume_dir
        lines = (volume_dir / "candidates.jsonl").read_text().splitlines()
        candidates = sorted((json.loads(line) for line in lines), key=lambda item: item["cost"])
        self.candidates = {item["crop"]: item for item in candidates}
        self.order = [item["crop"] for item in candidates]
        self.log = volume_dir / "decisions.jsonl"
        self.decisions: dict[str, str | None] = {}
        self.history: list[str] = []
        if self.log.exists():
            for line in self.log.read_text().splitlines():
                entry = json.loads(line)
                self.decisions[entry["crop"]] = entry["decision"]
                if entry["decision"]:
                    self.history.append(entry["crop"])
                elif entry["crop"] in self.history:
                    self.history.remove(entry["crop"])

    def record(self, crop: str, decision: str | None) -> None:
        candidate = self.candidates[crop]
        entry = {
            "crop": crop,
            "box": candidate["box"],
            "abkai": candidate["abkai"],
            "manchu": candidate["manchu"],
            "decision": decision,
            "at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        }
        with self.log.open("a") as log:
            log.write(json.dumps(entry, ensure_ascii=False) + "\n")
        self.decisions[crop] = decision
        if decision:
            self.history.append(crop)
        elif crop in self.history:
            self.history.remove(crop)

    def state(self) -> dict:
        values = [self.decisions.get(crop) for crop in self.order]
        current = next((crop for crop in self.order if not self.decisions.get(crop)), None)
        return {
            "total": len(self.order),
            "decided": sum(value is not None for value in values),
            "yes": values.count("yes"),
            "no": values.count("no"),
            "current": self.candidates[current] if current else None,
        }

    def context(self, crop: str) -> bytes:
        candidate = self.candidates[crop]
        x, y, width, height = candidate["box"]
        page = Image.open(self.volume_dir / "pages" / f"{crop[:4]}.jpg").convert("RGB")
        top, bottom = max(0, y - 3 * height), min(page.height, y + 4 * height)
        left, right = max(0, x - 2 * width), min(page.width, x + 3 * width)
        draw = ImageDraw.Draw(page)
        draw.rectangle((x, y, x + width, y + height), outline=(224, 48, 30), width=4)
        output = BytesIO()
        page.crop((left, top, right, bottom)).save(output, "JPEG", quality=85)
        return output.getvalue()


def serve(review: Review, port: int) -> None:
    font = next((path for path in FONTS if path.exists()), None)

    class Handler(BaseHTTPRequestHandler):
        def send(self, status: int, body: bytes, content_type: str) -> None:
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def json(self, value: object) -> None:
            self.send(200, json.dumps(value, ensure_ascii=False).encode(), "application/json")

        def crop_name(self, prefix: str) -> str | None:
            name = self.path.removeprefix(prefix)
            return name if CROP_NAME.match(name) and name in review.candidates else None

        def do_GET(self) -> None:
            if self.path == "/":
                self.send(200, PAGE.encode(), "text/html; charset=utf-8")
            elif self.path == "/api/state":
                self.json(review.state())
            elif self.path == "/font" and font:
                self.send(200, font.read_bytes(), "font/ttf" if font.suffix == ".ttf" else "font/woff2")
            elif self.path.startswith("/crop/") and (name := self.crop_name("/crop/")):
                path = review.volume_dir / "segments" / "crops" / f"{name}.jpg"
                self.send(200, path.read_bytes(), "image/jpeg")
            elif self.path.startswith("/context/") and (name := self.crop_name("/context/")):
                self.send(200, review.context(name), "image/jpeg")
            else:
                self.send(404, b"Not found", "text/plain")

        def do_POST(self) -> None:
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length) or b"{}")
            if self.path == "/api/decision" and body.get("crop") in review.candidates:
                if body.get("decision") in ("yes", "no"):
                    review.record(body["crop"], body["decision"])
                    return self.json({"ok": True})
            if self.path == "/api/undo":
                if review.history:
                    review.record(review.history[-1], None)
                return self.json({"ok": True})
            self.send(400, b"Bad request", "text/plain")

        def log_message(self, *args: object) -> None:
            pass

    # Only this computer can reach the page.
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"Reviewing {len(review.order)} candidates at http://127.0.0.1:{port}")
    server.serve_forever()


def export(review: Review, path: Path) -> None:
    confirmed = [crop for crop in review.order if review.decisions.get(crop) == "yes"]
    with path.open("w") as output:
        for crop in confirmed:
            line = {"crop": crop, "category": "manchu", "abkai": review.candidates[crop]["abkai"]}
            output.write(json.dumps(line, ensure_ascii=False) + "\n")
    print(f"Wrote {len(confirmed)} confirmed crops to {path}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("volume_id")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--data", type=Path, default=DATA_DIR, help="Folder that holds the volumes")
    parser.add_argument("--export", type=Path, help="Write confirmed crops for import-known-labels")
    args = parser.parse_args()
    review = Review(args.data / args.volume_id)
    if args.export:
        export(review, args.export)
    else:
        serve(review, args.port)


if __name__ == "__main__":
    main()

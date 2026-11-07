"""Download a volume's page images and IIIF manifest from Harvard Library.

Usage: python pipeline/fetch_volume.py 10499177 [--limit N]

Files go to data/volumes/<id>/. Existing images are skipped, so the script can be re-run.
"""

import argparse
import json
import time
from pathlib import Path

import requests

MANIFEST_URL = "https://nrs.harvard.edu/URN-3:FHCL:{id}:MANIFEST:2"
DATA_DIR = Path(__file__).resolve().parent.parent / "data" / "volumes"
HEADERS = {"User-Agent": "manchu-labelling-pipeline/0.1"}
REQUEST_DELAY_SECONDS = 1.0


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("volume_id", help="Numeric part of the volume's URN, e.g. 10499177")
    parser.add_argument("--limit", type=int, help="Only download the first N pages")
    args = parser.parse_args()

    volume_dir = DATA_DIR / args.volume_id
    pages_dir = volume_dir / "pages"
    pages_dir.mkdir(parents=True, exist_ok=True)

    session = requests.Session()
    session.headers.update(HEADERS)

    response = session.get(MANIFEST_URL.format(id=args.volume_id), timeout=60)
    response.raise_for_status()
    manifest = response.json()
    (volume_dir / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2))

    canvases = manifest["sequences"][0]["canvases"][: args.limit]
    pages = []
    for index, canvas in enumerate(canvases, start=1):
        service = canvas["images"][0]["resource"]["service"]["@id"]
        filename = f"{index:04d}.jpg"
        path = pages_dir / filename
        if not path.exists():
            image = session.get(f"{service}/full/full/0/default.jpg", timeout=120)
            image.raise_for_status()
            path.write_bytes(image.content)
            time.sleep(REQUEST_DELAY_SECONDS)
        pages.append(
            {
                "index": index,
                "file": filename,
                "label": canvas.get("label"),
                "canvas": canvas["@id"],
                "service": service,
                "width": canvas["width"],
                "height": canvas["height"],
            }
        )
        print(f"{index}/{len(canvases)} {filename} {path.stat().st_size // 1024} KB", flush=True)

    (volume_dir / "pages.json").write_text(json.dumps(pages, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

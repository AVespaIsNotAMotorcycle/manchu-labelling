"""Download a volume's page images and IIIF manifest.

Usage:
  python pipeline/fetch_volume.py 10499177 [--limit N]                      # Harvard Library
  python pipeline/fetch_volume.py PPN3306132969 --source stabi [--limit N]  # Staatsbibliothek zu Berlin

Files go to data/volumes/<id>/: the manifest, pages.json, page images, and volume.json, which records
the source's identifier, title, rights, and permanent link for import-segments. Existing images are
skipped, so the script can be re-run.
"""

import argparse
import json
import time
from pathlib import Path

import requests

DATA_DIR = Path(__file__).resolve().parent.parent / "data" / "volumes"
HEADERS = {"User-Agent": "manchu-labelling-pipeline/0.1"}
MAX_RETRIES = 5


def metadata_value(manifest: dict, label: str) -> str | None:
    for entry in manifest.get("metadata", []):
        if entry.get("label") == label:
            return str(entry.get("value"))
    return None


def harvard_volume(volume_id: str, manifest: dict) -> dict:
    return {
        "sourceId": f"URN-3:FHCL:{volume_id}",
        "title": manifest["label"],
        "manifestUrl": manifest["@id"],
        "rights": {
            "statement": manifest.get("attribution"),
            "attribution": "Harvard-Yenching Library, Harvard University",
            "permanentLink": f"https://nrs.harvard.edu/urn-3:FHCL:{volume_id}",
        },
    }


def stabi_volume(volume_id: str, manifest: dict) -> dict:
    shelfmark = metadata_value(manifest, "Signatur")
    link = metadata_value(manifest, "Persistente URL")
    if not link:
        raise ValueError("The manifest has no permanent URL")
    return {
        "sourceId": f"SBB:{volume_id}",
        "title": manifest["label"],
        "manifestUrl": manifest["@id"],
        "rights": {
            # The item's metadata states no licence. Stabi Berlin's terms of use say that its digitisations
            # of public-domain originals stay public domain, under the Public Domain Mark 1.0.
            "statement": "Public domain: a digitisation of a public-domain original (Public Domain Mark 1.0)",
            # Stabi Berlin asks reusers to name it in this form, with the permanent link.
            "attribution": f"Stabi Berlin, {shelfmark}" if shelfmark else "Stabi Berlin",
            "permanentLink": link,
        },
    }


SOURCES = {
    "harvard": {
        "manifest": "https://nrs.harvard.edu/URN-3:FHCL:{id}:MANIFEST:2",
        "volume": harvard_volume,
        "delay": 1.0,
    },
    "stabi": {
        "manifest": "https://content.staatsbibliothek-berlin.de/dc/{id}/manifest",
        "volume": stabi_volume,
        # Stabi Berlin's image server rate-limits quick requests.
        "delay": 3.0,
    },
}


def get(session: requests.Session, url: str, timeout: int) -> requests.Response:
    """Fetches a URL, waiting and retrying when the server asks us to slow down."""
    for attempt in range(MAX_RETRIES):
        response = session.get(url, timeout=timeout)
        if response.status_code != 429:
            response.raise_for_status()
            return response
        wait = int(response.headers.get("Retry-After", 0)) or 10 * 2**attempt
        print(f"Rate limited, waiting {wait} s", flush=True)
        time.sleep(wait)
    raise RuntimeError(f"Still rate limited after {MAX_RETRIES} tries: {url}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("volume_id", help="Harvard URN number, e.g. 10499177, or Stabi PPN")
    parser.add_argument("--source", choices=SOURCES, default="harvard")
    parser.add_argument("--limit", type=int, help="Only download the first N pages")
    args = parser.parse_args()
    source = SOURCES[args.source]

    volume_dir = DATA_DIR / args.volume_id
    pages_dir = volume_dir / "pages"
    pages_dir.mkdir(parents=True, exist_ok=True)

    session = requests.Session()
    session.headers.update(HEADERS)

    manifest = get(session, source["manifest"].format(id=args.volume_id), timeout=60).json()
    (volume_dir / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2))
    volume = source["volume"](args.volume_id, manifest)
    (volume_dir / "volume.json").write_text(json.dumps(volume, ensure_ascii=False, indent=2))

    canvases = manifest["sequences"][0]["canvases"][: args.limit]
    pages = []
    for index, canvas in enumerate(canvases, start=1):
        service = canvas["images"][0]["resource"]["service"]["@id"]
        filename = f"{index:04d}.jpg"
        path = pages_dir / filename
        if not path.exists():
            image = get(session, f"{service}/full/full/0/default.jpg", timeout=120)
            path.write_bytes(image.content)
            time.sleep(source["delay"])
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

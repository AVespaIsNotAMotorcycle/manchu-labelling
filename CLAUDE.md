# Manchu Labelling

A full-stack MERN app for crowdsourcing labels on images of words from historical scans. The labels
become training data for Manchu OCR models.

**The dataset is the product.** It must be usable by people other than the project owner, so weigh
every design decision by what it means for the published data: provenance, licensing, documentation,
and reproducibility.

**[SPEC.md](SPEC.md) is the source of truth for the design.** Read it before starting work, and keep
it up to date when a decision changes. Items marked **[Proposed]** are not yet approved, so check with
the owner before relying on them.

## Commands

```sh
npm install                  # install all workspaces
npm test                     # run all tests
npm run typecheck            # typecheck packages and server
npm run build -w client      # typecheck and build the client
docker compose up -d mongo   # MongoDB on port 27018
npm run dev -w server        # API on port 3001
npm run dev -w client        # client, proxying /api to the server

python3 -m venv .venv && .venv/bin/pip install -r pipeline/requirements.txt
.venv/bin/python pipeline/fetch_volume.py 10499177    # download a Harvard volume to data/
.venv/bin/python pipeline/segment.py 10499177         # segment it into word crops
npm run import-segments -w server -- 10499177 --production manuscript --script regular
USER_PASSWORD='...' npm run create-user -w server -- person@example.com [--admin]
```

## Layout

- `packages/script`: conversion between Manchu Unicode, Abkai, and Möllendorff, shared by client and server
- `server`: Express API, written in TypeScript and run directly by Node
- `client`: React app built with Vite. Optional fonts go in `client/src/fonts/`, which is not in git
- `pipeline`: offline Python jobs for fetching and segmenting scans
- `data`: downloaded scans, generated crops, and local image storage, not in git

## Working agreements

- **Work in small, frequent commits.** Each commit should be one logical change.
- **Commit directly to `main` for now.** This may change once a production version has users.
- **Check in with the owner often, especially on design changes.** This includes data models, label
  taxonomies, trust and scoring rules, export formats, and anything else that shapes the dataset. Do
  not settle these alone or bundle them into implementation work. Raise them first.
- Prefer stopping at a small reviewable milestone over completing a large stretch of work unreviewed.

## Rules that are easy to break

- **Never let the API reveal a hidden check image.** Responses, image URLs, and IDs must look the same
  as those for ordinary images, and the client must not receive answers.
- **Never delete or overwrite labels.** Annotations are append-only, and trust is computed at export.
- **Transcriptions record what is written,** not the intended word.
- **Do not add public registration** until the security checklist in SPEC.md is done.
- **Never commit the fonts in `client/src/fonts/`.** They are all rights reserved and this repo is public.
- **Manchu Unicode is the stored form, without variation selectors.** Abkai is only an input method.

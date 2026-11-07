# Manchu Labelling

A full-stack MERN app for crowdsourcing labels on images of words from historical scans. The labels
become training data for Manchu OCR models.

**The dataset is the product.** It must be usable by people other than the project owner, so weigh
every design decision by what it means for the published data: provenance, licensing, documentation,
and reproducibility.

**[SPEC.md](SPEC.md) is the source of truth for the design.** Read it before starting work, and keep
it up to date when a decision changes. Items marked **[Proposed]** are not yet approved, so check with
the owner before relying on them.

## Status

Pre-implementation: there is no code yet. Update this file when build, test, and run commands exist.

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
- **Manchu Unicode is the stored form.** Abkai is only an input method.

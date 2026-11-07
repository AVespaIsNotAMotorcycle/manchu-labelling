# Manchu Labelling: Specification

A web app for crowdsourcing labels on word images from historical Manchu sources, and the design of
the open dataset it produces.

**Status:** draft, last updated 2026-11-06. Items marked **[Proposed]** are suggested defaults the
owner has not yet approved. Everything else is agreed. Unresolved questions are in
[section 12](#12-open-questions).

## 1. Goals

1. Produce a public, reusable, well-documented dataset for training and evaluating Manchu OCR models.
2. Focus on **manuscripts**. Printed Manchu already has good public data, while handwriting is
   under-represented.
3. Let people who are new to Manchu make useful contributions. The script is alphabetic, so someone
   can learn to transcribe it without reading the language. Training, a letter reference, and quality
   control make that workable.

**Not goals for v1:** translation, page-level OCR, and any commercial use.

## 2. Sources and rights

- **Harvard-Yenching** is the first source. Harvard claims no copyright on openly available
  reproductions of works that are public domain in the US. Vendor-digitized items may be excluded, and
  its policy does not address bulk use or derivative datasets. Its IIIF manifests link to general terms
  and carry no per-item rights statement, so each volume must be assessed. Volumes dated after about
  1900 need extra care, because the policy only covers works that are public domain in the US.
- **Staatsbibliothek zu Berlin** is a possible later source. Its terms must be confirmed from the
  official site or the items themselves. Copies on third-party sites describe CC BY-NC-SA 3.0 DE, and
  some items carry a Public Domain Mark. If NC-SA applies, it binds everyone who reuses those images,
  not just this project. Crops from those images would have to stay under NC-SA, so they would go in a
  separate release package.
- **Sun et al. (2026)** is a [CC BY 4.0](https://doi.org/10.57760/sciencedb.25676) set of 24,280 printed
  word images with labels and page sources. It can supply labelled print images for the quiz, with
  attribution. It cannot supply hidden checks, because its print scans would stand out in manuscript
  work.
- Rights are recorded **per source volume**: rights statement, attribution text, and permanent link.
- Exports can be filtered by license, and each record carries its attribution.
- **Labels and images are licensed separately.** Contributors agree to the labels license at signup.
  **[Proposed]** CC BY 4.0 for labels. A transcription records the text of a public-domain work rather
  than adapting a photograph of it, so labels probably do not inherit ShareAlike from NC-SA images.
  This reasoning is unsettled, and it stops mattering if releases use only Harvard images.

## 3. Ingestion pipeline

1. Choose volumes and record their metadata and rights.
   Catalog records cannot be relied on for this: Harvard's manuscripts are often recorded with the form
   "print", and with Chinese as their only language in the manifest.
2. Fetch page images through IIIF where available. Harvard manifests are at
   `https://nrs.harvard.edu/URN-3:FHCL:<id>:MANIFEST:3`.
3. Segment pages into word images. Harvard images are usually two-page spreads, so they are split
   first. Pages may be bilingual, have ink showing through from the other side, and contain text that
   runs vertically in columns from left to right.
4. Store each crop with its **source page, bounding box, and reading order** (page, column, word
   index), so that others can rebuild lines and pages.
5. Set production and script style for the volume (section 4).

Segmentation is the biggest technical risk and gets an early trial (section 11).

## 4. Labels

| Field | Values | Notes |
| --- | --- | --- |
| Category | `manchu`, `chinese`, `mongolian`, `other_script`, `non_text`, `illegible`, `bad_crop` | Required |
| Transcription | Manchu Unicode | Required for `manchu`. Typed in Abkai and stored as Unicode |
| Intended word | Manchu Unicode | Optional. Used when the written form differs from the word meant |
| Production | Woodblock, movable type, manuscript, other | Set per volume, can be overridden per word |
| Script | Regular, running, memorial, seal, other | Set per volume, can be overridden per word |
| Confidence | `confident` or `unconfident` | One per field. Defaults to `confident`, so it only costs a click when unsure |

**[Proposed]** The production and script value lists above are a starting point, for review by
Manjurists.

### Transcription policy

- **Record what is written, not the intended word.** This covers misspellings and undotted forms. The
  intended word goes in its own optional field.
- **[Proposed]** An unreadable letter is entered as `?`, so that a partly legible word is not lost.

### Text representation

- Manchu Unicode is the stored form. Abkai is only an input method. Exports include Manchu Unicode,
  Abkai, and Möllendorff.
- Abkai `q` covers two letters, so the input needs a way to tell them apart.
- Handling of free variation selectors is an open question (section 12).

## 5. Labelling workflow

- The labelling screen shows the word crop and, on demand, the full page with a bounding box around
  the word.
- As the user types, the word is rendered in Manchu script next to the image, so they can compare the
  two. Rendering needs testing, because digital Manchu display is not fully settled.
- The letter-form reference is always available.
- There is **no dictionary check**. Manchu is agglutinative, so valid words may be missing from any
  dictionary, and a check would also pull labelers away from recording what is written.
- Each image is labeled independently, and labelers cannot see other people's answers.
- Common words are limited, so that they do not dominate the data.

### Reaching a final label **[Proposed]**

With few labelers expected, redundancy starts low:

1. An image needs **two matching labels** from trusted users.
2. A disagreement, or a label marked `unconfident`, sends the image to one more labeler.
3. If that does not settle it, the image goes to a reviewer.

Images that have only one label can still be exported, marked with their status (section 9).

### Queue priority **[Proposed]**

- New labelers start with **neat regular-script manuscripts**. These are valuable and easier to learn
  than running hand. Running and memorial script open up once a user qualifies for them.
- Word limits use confirmed labels. A hidden guess from `dots-and-circles` could help too, but it has
  never been trained on handwriting and would never be shown to labelers.

## 6. Training and qualification

Users complete this section before they can do real work:

- **Lessons** teach the script (planned after the first release).
- **Reference:** the letter-form reference is available throughout.
- **Quiz:** users keep working until the rolling score over their **last ~20 images reaches 100%**,
  with feedback after each answer.
- **Disclosure:** users are told that hidden checks exist and that they can review and dispute past
  test images.

**[Proposed]** quiz details:

- Qualification is per script class, since skill with one does not carry over to another.
- The quiz covers category as well as transcription, so it includes non-Manchu images.
- Transcriptions must match exactly. The intended word field is not scored.
- Quiz images are never used as hidden checks.
- Print images can come from Sun et al. (2026). Manuscript qualification needs real manuscript images
  from the same kinds of sources as the work itself.
- Synthetic images can be generated without limit, using the `dots-and-circles` generator (font
  licenses need checking). They are easier than real scans, so at least half of the 20-image window
  must be real.

Requiring 20 in a row means persistence can eventually beat skill, and the image bank must be large:

| Per-image accuracy | Expected images to reach 20 in a row |
| --- | --- |
| 95% | about 36 |
| 90% | about 72 |
| 80% | about 430 |

**[Proposed]** Each script class needs at least 300 real images at launch.

## 7. Quality control

### Hidden checks

- Known-label images are mixed into normal work without being identified as such.
- They are **real scans only**, because synthetic images would stand out.
- Each user sees a given check image at most once.
- **[Proposed]** Checks make up about 20% of a user's first 100 images and 5–10% after that.
- Nothing in the API may reveal a check image. Responses, image URLs, and IDs look the same as those
  for ordinary images, and the client receives no answers.

### Trust

- Trust is **tracked per script class**.
- It is measured with **character error rate**, and nobody is excluded until there is a minimum
  sample.
- **Every label is kept.** Trust is computed at export rather than when a label is written, so nothing
  is deleted, and thresholds can change later.
- A label counts if its author was above the threshold **at the time it was made**. If a user improves,
  their later labels count, and their earlier ones do not.
- **[Proposed]** Trust uses the user's last 30 check images, with a threshold of 95% character
  accuracy.

### Feedback and disputes

- Users can see their overall accuracy, with a delay.
- A user's profile lists their past test images, each with a **dispute/correct button**.
- **[Proposed]** An image only appears in this list after the user has done at least 25 more labels,
  so that the list cannot identify checks during a session.
- Reviewers resolve disputes. If a known label turns out to be wrong, it is corrected and the affected
  trust scores are recalculated.

### Check images and public releases

A release would otherwise expose the answers to active check images. **[Proposed]** Active checks are
left out of releases and included once retired.

## 8. Roles

| Role | Permissions |
| --- | --- |
| Labeler | Trains, labels, views own history, opens disputes |
| Reviewer | Settles disagreements and disputes, creates known labels |
| Admin | Manages sources, volumes, users, and releases |

The owner is not intended to be the reviewer. Manjurists will be approached for this role.

## 9. Dataset releases

- **Versioned releases** are immutable and have a DOI. Each has a data card covering sources, label
  definitions, the transcription policy, quality-control rules, and known limitations.
- **Splits are fixed and made by source volume**, so that one hand or printing does not appear in both
  training and test data.
- **Contents:** crops, page references and coordinates, reading order, every raw label, the final label
  with its status (for example `single`, `agreed`, `reviewed`), and attribution and rights.
- **Annotator IDs are pseudonymous in the data.** Contributors can opt in to being credited by name.
  **[Proposed]** Names are listed separately and not linked to annotator IDs, so that crediting someone
  does not publish their accuracy.
- Past releases cannot be changed, so a name that was published stays in that version.

## 10. Architecture

| Part | Choice | Reason |
| --- | --- | --- |
| Frontend | React | The owner's choice, MERN stack |
| API | Node and Express | Also runs trust and export. The Abkai converter has to run in the browser for the live preview, so domain logic stays in one language |
| Database | MongoDB | Labels are append-only records |
| Image processing | Python batch jobs | Segmentation and synthetic images run offline and connect through the database and storage, not through the API |
| Image storage | Cloudflare R2 | S3-compatible, with no egress fees |
| Local development | Docker Compose | MongoDB, plus MinIO or a local folder in place of R2 |

**Image storage:** files live in object storage and MongoDB stores only their keys. Keys are random, so
they reveal nothing about an image. Assuming 100,000 crops at 30 KB and 5,000 pages at 1 MB, the total
is about 8 GB. That fits R2's 10 GB-month free tier, and beyond it storage costs $0.015 per GB-month.
Both sizes are estimates, to be replaced with real figures from the first volume.

**Long-term dataset hosting** is separate from the app, on a DOI-issuing archive such as Zenodo or a
dataset hub such as Hugging Face.

### Main collections

| Collection | Holds |
| --- | --- |
| `volumes` | Source metadata, rights, attribution, default style |
| `pages` | Source link, image key, dimensions |
| `wordImages` | Page, bounding box, reading order, image key, status |
| `annotations` | Append-only labels with user, timestamps, and confidence |
| `knownLabels` | Answers, their origin, and their state (active, retired, corrected) |
| `trainingAttempts` | Quiz answers and qualification by script class |
| `disputes` | Disputed test images and their outcomes |
| `users` | Account, role, license agreement, credit preference |
| `releases` | Version, parameters used, DOI |

## 11. Milestones

Each milestone ends with a check-in.

1. **Trial:** take one Harvard-Yenching manuscript volume through IIIF and segmentation, then measure
   crop quality and file sizes. **[Proposed]** Use *Chao ben Man wen ce* 鈔本滿文册 (19th century, 123
   images, `URN-3:FHCL:10499177`), a neat hand with Manchu and Chinese in alternating columns.
2. **Foundations:** project scaffolding, data model, and the Abkai/Unicode converter with tests.
3. **Labelling:** labelling screen, page view, live preview, reference.
4. **Training:** quiz, rolling score, qualification.
5. **Quality control:** hidden checks, trust, profile history, disputes.
6. **Review:** consensus and the reviewer queue.
7. **Release:** export, data card, first public version.
8. **Lessons.**

## 12. Open questions

1. **Berlin terms:** what are the official terms, and do they apply to these items?
2. **Labels license:** CC BY 4.0 as proposed, or CC0 for the fewest restrictions on reuse?
3. **Free variation selectors:** does the stored form keep them? They affect how letters display, and
   they are a known weak spot in `dots-and-circles`. This needs a rendering test and expert input.
4. **Abkai `q` input:** how should users distinguish the two letters?
5. **Manuscript known labels:** print is covered by Sun et al. (2026), but who transcribes the first
   manuscript images, and can existing transcriptions be aligned to scans?
6. **Hosting:** where do the app and database run in production?

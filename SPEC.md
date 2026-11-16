# Manchu Labelling: Specification

A web app for crowdsourcing labels on word images from historical Manchu sources, and the design of
the open dataset it produces.

**Status:** draft, last updated 2026-11-16. Items marked **[Proposed]** are suggested defaults the
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
- **Staatsbibliothek zu Berlin** is the second source, from 2026-11-11. Its official terms of use say
  that its digitisations of public-domain originals stay public domain, under the Public Domain Mark
  1.0, and ask reusers to name "Stabi Berlin" with the item's permanent link. Each item's own metadata
  decides. Where it states no licence, the terms apply. An item that states another licence, such as
  CC BY-NC-SA, needs checking before use, and NC-SA crops would have to go in a separate package.
  The first volume is *Justan i bithe* (Hs. or. 10791), a bilingual Manchu–Chinese manuscript.
- **Sun et al. (2026)** is a [CC BY 4.0](https://doi.org/10.57760/sciencedb.25676) set of 24,280 printed
  word images with labels and page sources. It can supply labelled print images for the quiz, with
  attribution. A test run will also use it for hidden checks, to see whether its images work there or
  stand out from manuscript work (section 7).
- Rights are recorded **per source volume**: rights statement, attribution text, and permanent link.
- Exports can be filtered by license, and each record carries its attribution.
- **Labels and images are licensed separately.** Labels are **CC BY 4.0**, and contributors agree to
  this at signup.
- No publication is planned yet, so releases (section 9) are a design target rather than a near-term
  deadline.

## 3. Ingestion pipeline

1. Choose volumes and record their metadata and rights.
   Catalog records cannot be relied on for this: Harvard's manuscripts are often recorded with the form
   "print", and with Chinese as their only language in the manifest.
2. Fetch page images through IIIF where available. Harvard manifests are at
   `https://nrs.harvard.edu/URN-3:FHCL:<id>:MANIFEST:3`.
3. Segment pages into word images. Harvard images are usually two-page spreads, so they are split
   first, while Stabi Berlin's are single pages. Pages may be bilingual, have ink showing through from
   the other side, and contain text that runs vertically in columns from left to right. Some columns mix
   the scripts, with a Manchu phrase followed by its Chinese translation, so each column is cut into
   word-sized pieces and its Chinese characters become separate crops.
   `classify_scripts.py` then marks each crop Manchu or Chinese, and the labelling queue serves only
   the Manchu ones. It trains on a volume with unmixed columns, then retrains on the crops it is surest
   of in this volume, adding each crop's width relative to the page's Manchu words. Crops confirmed as
   words in review are always Manchu. On *Justan i bithe*, a visual check of the crops the first
   classifier was unsure of put roughly 2% of all crops on the wrong side.
4. Store each crop with its **source page, bounding box, and reading order** (page, column, word
   index), so that others can rebuild lines and pages.
5. Set production and script style for the volume (section 4).

Segmentation is the biggest technical risk and gets an early trial (section 11).

### Known labels from existing transcriptions

Where a scan already has a transcription, its words can become known labels without anyone typing them.

1. `align_transcription.py` pairs crops with the transcription's words. Lines are matched to columns,
   and within a column, crops are matched to words by size. A classifier trained on a volume with
   unmixed columns tells Chinese crops from Manchu ones, so that Chinese is skipped. The result is only
   a list of candidates.
2. A person checks each candidate with `review_candidates.py`, answering yes only if the crop shows
   exactly that word. Every decision is kept in a log.
3. Confirmed crops are imported as known labels, with the transcription and the reviewer recorded as
   their origin.

The first transcription is manc.hu's reading of *Justan i bithe*. Its reuse terms are unknown, but a
known label is a reading of a public-domain text, and each one is confirmed against the scan by eye.

### Trial results

On *Chao ben Man wen ce*, `pipeline/segment.py` produced 8,401 crops in Manchu columns, from 121 of the
123 images. In a visual check of a random 100 crops, 80 looked like one complete word and 20 were
clearly wrong. This is an estimate, with a margin of about ±8 points, and the only input from a Manchu
reader so far is the owner's identification of two shapes.

- 15 of the 20 failures were long strokes touching the next word or a Chinese column. Many of these are
  the long final slash of *be*.
- The short hook shape is the separate word *i*, so those crops are valid.
- Removing diagonal strokes before grouping did not help at any length tried. Short settings cut real
  words apart, and long settings missed most slashes, which are curved and tapered.
- Crops from Chinese columns (about 8,900 in this volume) stay out of the labelling queue. A sample
  showed no Manchu among them. Some Chinese characters do reach the Manchu queue, and labelers mark
  those as `chinese`.
- Red editorial marks are ignored, and crops are cut from the original image.
- Crops are rectangular, so parts of neighbouring words can appear in them.

## 4. Labels

| Field | Values | Notes |
| --- | --- | --- |
| Category | `manchu`, `chinese`, `other_script`, `non_text`, `illegible`, `bad_crop` | Required. Mongolian script is `other_script` |
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
- Abkai `q` always means ᠴ. ᡱ is entered through the sequence `qyʻ`, which gives ᡱᡳ. It is not known
  whether ᡱ appears outside that sequence.
- `'` is accepted in place of the Abkai `ʻ` when typing.
- **Free variation selectors are not stored**, at least for now. A label records letters, not which
  shape of a letter the page used.
- The preview uses Noto Sans Mongolian as its fallback. Without selectors, 19 of 121 dictionary words displayed
  differently in a browser test. Most differences are slight, but the standalone word *i* shows its normal
  form, so the preview adds a selector for display only when the whole word is ᡳ.

## 5. Labelling workflow

- The labelling screen shows the word crop and, on demand, the full page with a bounding box around
  the word.
- The category question asks **Manchu** or **Not Manchu** first. Not Manchu then asks which other
  category applies, with nothing preselected.
- As the user types, the word is rendered in Manchu script next to the image, so they can compare the
  two. Rendering needs testing, because digital Manchu display is not fully settled.
- The letter-form reference is always available, with links to Roth Li's *The Manchu script* and
  *Introduction to Manchu in 21 Lessons*. Its tabs group vowels, consonants, letters for transliterating
  Chinese, and syllables where a letter changes shape with its vowel. These are linked rather than reproduced because their license
  is unknown.
- Users can change the Manchu font from the top bar without leaving the page, and the choice is kept in
  their browser. It applies to the preview and the reference.
- There is **no dictionary check**. Manchu is agglutinative, so valid words may be missing from any
  dictionary, and a check would also pull labelers away from recording what is written.
- Each image is labeled independently, and labelers cannot see other people's answers.
- Common words are limited, so that they do not dominate the data.

### Reaching a final label

Decided by the owner on 2026-11-16. With few labelers expected, redundancy starts low:

1. An image needs **two matching labels** from trusted users.
2. A disagreement, or a label marked `unconfident`, sends the image to one more labeler.
3. If that does not settle it, the image goes to a reviewer.

- Each user's latest label on an image counts, so a correction replaces what it corrects.
- Labels **match** on exact category and, for Manchu, exact letters. The intended word is ignored.
- Only labels from users who were trusted when they made them count, as in the export (section 7).
- A label marked unsure about its category or transcription, or with a `?` in it, cannot settle an
  image. It still counts as a label for deciding when to ask a third labeler or a reviewer.
- Production and script come from a majority of the labels that count, falling back to the volume's
  values.
- Held-back images still need 3 labels before they leave the queue.
- **The reviewer screen** shows the image, its page, and the readings given, without names and with a
  count for each. The reviewer picks one or types their own, and the result has the status
  `reviewed`. Reviewers do not need to pass the quiz to review.
- As built: statuses are `unlabelled`, `single`, `pending` (two labels that do not settle it),
  `agreed`, `needs_review`, and `reviewed`. Two answers tied on the most labels do not agree.
  Reviewers never see an image they labelled, hidden checks, or words awaiting a crop ruling. Each
  reviewer answer is a new record in `labelReviews`, and the latest one counts.
- **[Proposed]** An image is given to at most 6 labelers, so that labels from users who are not trusted
  cannot keep it in the queue forever.
- As built, held-back agreements also only count labelers who were trusted when they labelled.

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
- **Quiz:** users pass three phases in order, **synthetic, printed, and manuscript**, each with **8
  correct answers in a row**, and get feedback after each answer.
- **Disclosure:** users are told that hidden checks exist and that they can review and dispute past
  test images.

**[Proposed]** quiz details, as built:

- Qualification is per script class, using the same `script` values as volumes. A user only receives
  images from volumes in classes they have qualified for.
- Each quiz image belongs to one phase, recorded as its `kind`: `synthetic`, `printed`, or
  `manuscript`. Each phase uses only its own images.
- The quiz covers category as well as transcription. About 10% of images in the printed and manuscript
  phases are not Manchu when the phase has enough of them.
- Transcriptions must match exactly. The intended word field is not scored.
- Passing a phase is never undone, except by a reset. An answer only counts towards the phase the user
  was in when they gave it. A phase with no images passes automatically.
- A user can reset their own quiz for a script class from the quiz page and take it again from the
  synthetic phase. A reset is an append-only record. Only answers given after the latest reset count.
  Earlier answers stay on record, and images already answered still come last. After a reset the user
  cannot label that class until they pass again. Labels already made are kept, and trust still decides
  whether they count. Losing qualification (section 7) can use the same mechanism.
- After the synthetic phase, users can practise on synthetic images whenever they like. Practice
  answers are recorded but do not affect progress, and practice has its own waiting image so that it
  cannot skip a quiz image.
- Images do not repeat until a user has answered them all, and reloading cannot skip an image.
- Quiz images are a separate collection from hidden checks and are never used as checks.
- The quiz shows the three phases as numbered steps. Below them, it shows whether each recent answer in
  the current phase was right, in order, and how many more correct answers in a row the user needs.
- Answers from before the quiz had phases say `real` and count towards no phase.

### The `regular` bank

| Phase | Images | Count | Source |
| --- | --- | --- | --- |
| Synthetic | Synthetic Manchu words | 600 | Rendered from a lexicon in the 12 local fonts |
| Printed | Printed Manchu words | 2,428 | Sun et al. (2026), one photo per word, CC BY 4.0 |
| Manuscript | Chinese characters | 64 | Chinese columns of the trial volume, each reviewed by eye |
| Manuscript | Manchu manuscript words | 3 | *Justan i bithe*, Stabi Berlin Hs. or. 10791, public domain, read against manc.hu |

- **Manuscript gap:** the manuscript phase has only 3 Manchu images, so it mostly tests the category
  question, although the labelling queue is manuscripts. More Manchu manuscript items must be added as
  Manjurists supply answers.
- Later additions are small banks in `data/training/<name>/`, imported with `--bank`. Each is marked
  as imported so that it cannot be imported twice.
- Synthetic images are rendered from all-rights-reserved fonts, so they stay out of any publication
  until the fonts' terms are known.

Requiring 8 in a row means persistence can eventually beat skill, and the image bank must be large:

| Per-image accuracy | Expected images to reach 8 in a row, in each phase |
| --- | --- |
| 95% | about 10 |
| 90% | about 13 |
| 80% | about 25 |

**[Proposed]** Each script class needs at least 300 real images at launch.

The introduction tells users about the hidden checks, their accuracy, and disputes. Those features arrive
with the quality control milestone, so the text must be true before non-test users see it.

## 7. Quality control

### Hidden checks

- Known-label images are mixed into normal work without being identified as such.
- They are **real scans only**, because synthetic images would stand out.
- A test run uses Sun et al. (2026) print images as hidden checks. Afterward, we decide whether they
  are too recognizable to keep using.
- Each user sees a given check image at most once.
- Checks make up about 20% of a user's first 100 images and 8% after that.
- Nothing in the API may reveal a check image. Responses, image URLs, and IDs look the same as those
  for ordinary images, and the client receives no answers.
- A check is a real crop from an ingested volume with a known answer, so its page view is real too.
  Answers are imported with `import-known-labels`, which names crops by their segmentation file name
  and records who supplied them. An existing answer is never overwritten.
- A check must pass the same rules as any other image, such as not being under crop review. Checks are
  only given while ordinary images remain, so that a user is never left with only checks.
- Crops with a known answer leave the ordinary queue, since they need no crowd labels.
- A check passes only on an exact match of category and letters. Each user's latest label on a check is
  graded, so a correction counts. Results are worked out from history each time and never stored.
- As built, results are only visible to admins, through `check-results`. Losing qualification, trust,
  and feedback to users come next.

### Trust

- Trust is **tracked per script class**.
- It is measured with **character error rate**, and nobody is excluded until there is a minimum
  sample.
- **Every label is kept.** Trust is computed at export rather than when a label is written, so nothing
  is deleted, and thresholds can change later.
- A label counts if its author was above the threshold **at the time it was made**. If a user improves,
  their later labels count, and their earlier ones do not.
- Trust uses the user's last 30 graded check images in the class, made before the label, with a
  threshold of 95% mean character accuracy. Character accuracy is 1 − edit distance ÷ answer length,
  at least 0, and a wrong category scores 0.
- The minimum sample is **10 graded checks**. Until then a user counts as trusted.
- A label is only graded against a check if the user first labelled the image after it became a check,
  so the labels that agreed on a held-back answer are not graded against it.

### Losing qualification

Passing the quiz is not permanent. If a user does poorly on many hidden checks in a row, they lose
qualification for that script class and must pass the quiz again before labelling it.

- The quiz stays at 8 in a row for each phase.
- The whole quiz restarts when qualification is lost, including the synthetic phase. Earlier answers do
  not count, or a returning user would pass immediately.
- Quiz images already answered are not repeated until the bank runs out.
- Existing labels are kept, as all labels are. Trust still decides whether they count.
- If a dispute overturns a known label, the run of failures is recalculated, and qualification is
  restored if that label caused the loss.
- The message to the user is general. It does not say which images were checks.
- Qualification is lost after **5 failed checks in a row**. A check fails if any character is missing or
  wrong, so only an exact match passes.
- As built: each quiz pass is recorded, and whether a user is qualified is worked out each time by
  replaying their passes, resets, and graded checks in order. Losing qualification is not stored, so
  a dispute that overturns a check restores it automatically. Only checks labelled while qualified
  count towards a run, and a pass starts a new run.

### Feedback and disputes

- Users can see their overall accuracy, with a delay.
- A user's profile lists their past test images, each with a **dispute/correct button**.
- An image only appears in this list, and only counts towards the accuracy the user sees, after the
  user has done at least 25 more labels, so that neither can identify checks during a session.
- A dispute gives the reading the user thinks is right and an optional note.
- Reviewers and admins resolve disputes, with one of three outcomes. **Upheld** changes nothing.
  **Corrected** replaces the known answer, keeping the old one in its history. **Withdrawn** stops the
  image being a check, and grades on it stop counting. Grades are worked out from history, so trust
  and qualification follow automatically.
- Users can also dispute a quiz answer from the feedback after answering. A reviewer can uphold it, or
  withdraw the quiz image so that it is not shown again. Quiz images are not corrected in place.

### Check images and public releases

A release would otherwise expose the answers to active check images. Active checks are left out of
releases and included once retired.

**[Proposed]** by the owner, for later: a new release is published automatically every Friday.

### Held-back images

Decided by the owner on 2026-11-11, so that new hidden checks keep coming from the crowd without their
answers ever being published:

- **15% of word instances are held back** from releases. They are chosen at random when a volume is
  imported, so the choice never depends on labels and the published data is not skewed. Volumes
  imported before this rule get the same random choice once. The choice is stored only on the server.
- Held-back images are labelled like any other image, but need **3 independent labels** instead of 2.
- When the trusted labelers agree exactly, an **admin confirms** the answer with a yes/no review. It
  then becomes an active known label, with the labelers and the admin recorded as its origin.
- A user who labelled an image never gets it as a check, as with every check.
- Held-back images are left out of releases while they are checks, and published once retired, like
  other checks. The datasheet says that about 15% of words are held back and how they were chosen.
- Until it is published, the held-back set can also serve as a test split for OCR models.
- As built: `heldBack` on word instances, set by `import-segments` and, for earlier volumes, once by
  `hold-back`, with a cryptographic random source. The queue asks for 3 labels on held-back images.
- As built, until trust exists, any qualified labeler counts as trusted. An image goes to admins under
  the Admin tab when at least 3 labelers' latest labels match exactly, none is marked unsure, and no
  letter is `?`. The admin's yes or no is final and kept in `heldBackReviews`. A yes creates an active
  known label whose origin names the labelers' and admin's user IDs. Turned-down and disputed images
  stay held back, and are not checks.
- Leaving held-back words out of releases comes with the export.
- **Undo**, decided by the owner on 2026-11-16: admins and reviewers can undo a decision. Decisions
  are append-only, so an undo is a later record that replaces the earlier one. Undoing a yes withdraws
  the known label: grades against it stop counting, as passes or failures, and the crowd labels on it
  count as ordinary labels again. Undoing a no sends the image back for review.
- Reviewers can confirm held-back answers as well as admins.

## 8. Roles

| Role | Permissions |
| --- | --- |
| Labeler | Trains, labels, views own history, opens disputes |
| Reviewer | Settles disagreements and disputes, confirms held-back answers, creates known labels |
| Admin | Manages sources, volumes, users, and releases |

The owner is not intended to be the reviewer. Manjurists will be approached for this role. Ideally every
reviewer and admin other than the owner is a trained Manjurist.

### Accounts and security

Login uses email and password for now. Passwords are hashed with scrypt, sessions are stored on the
server in secure cookies, and login attempts are rate-limited.

New passwords need at least 12 characters, with an upper-case letter, a lower-case letter, a number,
and a symbol. The rules live in `packages/passwords`, so that the server and any client form that sets
a password apply the same check. The server always checks. The login form does not, since it does not
set a password.

**Accounts are for testing only** until this list is done. Registration is by invite only. The following must be done before anyone other than test users gets an account. Decided
by the owner on 2026-11-16: registration is by **invite links** from admins, with email
verification; email goes through a generic SMTP sender; two-factor uses authenticator-app codes
(TOTP) with recovery codes, with passkeys later; new passwords are checked against Have I Been Pwned's
range API, which only receives the first 5 characters of the password's SHA-1 hash and is skipped if it
cannot be reached; deleting an account removes the email, password, and credit name, and keeps the
labels under the pseudonymous ID, since they are already licensed CC BY 4.0.

- ~~Open registration through a verified process, with email verification~~ Done: admins make invite
  links (in the Admin tab, or with `create-invite`), which work once for 14 days and can be tied to an
  email. New accounts cannot log in until they confirm their email. Registering an email that already
  has an account emails its owner instead, so the response reveals nothing.
- ~~Password reset~~ Done: links last an hour, work once, and sign out every session. Users can also
  change their password from the Account page.
- ~~Two-factor authentication or passkeys, required for reviewers and admins~~ Done with TOTP: secrets
  are encrypted with `SECRETS_KEY`, each code works once, there are 10 single-use recovery codes, and
  reviewer and admin tools refuse staff without it in production. Passkeys are left for later.
- ~~A rate limit that also tracks each account, and alerts on repeated failures~~ Done: 10 failed logins
  per account an hour from any address, beside 10 attempts per address in 15 minutes. Hitting either
  logs a JSON alert, which is also emailed to `ALERT_EMAIL` once email is set up.
- ~~Rate limit counts that survive a server restart, kept in MongoDB rather than in memory~~ Done, in
  `rateLimits`, which MongoDB clears as windows end.
- ~~A limit on concurrent password hashing, so that a burst of logins cannot delay other requests~~
  Done: two hashes run at once, 20 more wait, and the rest get a 503.
- ~~MongoDB authentication and a private network in production~~ Done in `deploy/`: MongoDB is only on
  an internal Docker network, and the API logs in as a user that can only use the app's database.
- ~~A check of new passwords against known breaches~~ Done, in the one function every new password
  passes through.
- CSRF review, security headers, and HTTPS everywhere in production. Done in the API: changes need
  JSON bodies and are refused when `Origin` or `Sec-Fetch-Site` shows another site, on top of
  `SameSite=Lax` cookies, and responses carry a strict policy. In `deploy/`, Caddy serves everything
  over HTTPS with HSTS and a content security policy for the client.
- ~~A review of how account and contribution data can be deleted~~ Done: users can delete their
  account from the Account page, which removes the email, password, credit name, and two-factor
  secrets and keeps labels, disputes, and reviews under the account's ID.
- A security review of the whole authentication flow
- Permission for any font served to users (see below)

### Fonts

The Abkai and XM fonts are marked all rights reserved, and four XM fonts carry a Monotype license notice.
No license allowing redistribution has been found. They are kept out of git, and the app offers only the
fonts present, falling back to Noto Sans Mongolian, which is bundled.

Serving a font to a browser gives a copy of it to that user. **Before non-test users get access, each
font must have permission from its rights holder or be removed.**

## 9. Dataset releases

- **Versioned releases** are immutable and have a DOI. Each has a data card covering sources, label
  definitions, the transcription policy, quality-control rules, and known limitations.
- **Splits are fixed and made by source volume**, so that one hand or printing does not appear in both
  training and test data.
- **Contents:** crops, page references and coordinates, reading order, every raw label, the final label
  with its status (for example `single`, `agreed`, `reviewed`), and attribution and rights.
- **Annotator IDs are pseudonymous in the data.** Contributors can opt in to being credited by name.
  Names are listed separately and not linked to annotator IDs, so that crediting someone does not
  publish their accuracy. Users set the name they want credited in their account settings.
- Annotator IDs are a keyed hash of the user ID with a secret kept on the server, so the same annotator
  has the same ID in every release.
- Splits are assigned to each volume by an admin (train, validation, or test). A volume's split cannot
  change after a release has used it.
- Volumes under a different license, such as NC-SA, go in a separate package.
- **Format:** a release is a folder made by `export-release`, holding `images/` with the canonical
  crops, `words.jsonl` (one line per word), `labels.jsonl` (every raw label, with a pseudonymous
  annotator ID and whether it counted), `volumes.jsonl`, a data card as `README.md` in Hugging Face's
  format, `CONTRIBUTORS.md`, and license files. The owner uploads it to Zenodo or Hugging Face and
  records the DOI with a command.
- As built: `set-volume` sets a volume's split, license, and rights status, and `export-release` writes
  the folder and a record in `releases` with the parameters used, the commit, counts, and checksums.
  `set-release-doi` records the DOI once, in `releaseDois`. Annotator IDs need `ANNOTATOR_ID_SECRET`,
  which must never change. Final statuses are `known` (a retired check's expert answer), `reviewed`,
  `agreed`, `single`, and `unsettled` (no final label). Words with no labels are left out. A release
  that mixes licenses refuses to include a noncommercial one.
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
they reveal nothing about an image. The trial volume averaged 1.1 MB per page image and 9 KB per crop.
At those sizes, 100,000 crops and 5,000 page images come to about 6.4 GB. That fits R2's 10 GB-month
free tier, and beyond it storage costs $0.015 per GB-month.

**Long-term dataset hosting** is separate from the app, on a DOI-issuing archive such as Zenodo or a
dataset hub such as Hugging Face.

### Main collections

| Collection | Holds |
| --- | --- |
| `volumes` | Source metadata, rights, attribution, default style |
| `pages` | Source link, image key, dimensions |
| `segmentationRuns` | One record per segmentation import, with the pipeline commit |
| `wordInstances` | One physical word on a page, and the one crop to use for it |
| `wordImages` | Crops: run, page, word instance, bounding box, reading order, image key |
| `annotations` | Append-only labels with user, timestamps, confidence, typed Abkai, and converter version |
| `cropReviews` | Competing crops awaiting an admin's ruling, and the outcome |
| `assignments` | Which user was given which image, with no sign of whether it is a check |
| `knownLabels` | Answers, their origin, and their state (active, retired, corrected). The only record of which images are checks |
| `labelReviews` | A reviewer's final answer for an image whose labels did not settle it |
| `heldBackReviews` | A reviewer's yes, no, or undo on the answer that labelers agreed on for a held-back image |
| `trainingItems` | Quiz images, their answers, and their sources |
| `trainingAttempts` | Append-only quiz answers |
| `trainingStates` | The image each user must answer next |
| `qualifications` | Each pass of the quiz, by user and script class |
| `quizResets` | Each time a user chose to take the quiz again |
| `disputes` | Disputed check and quiz answers, and their outcomes |
| `users` | Account, role, license agreement, credit preference |
| `releases` | Version, parameters used, volumes and their splits, counts, and checksums |
| `releaseDois` | The DOI recorded for each release after upload |

### Data rules

- **Crops never change.** Each records its segmentation run. New segmentation adds new crops, so a label
  always matches its image.
- **Each word is published once.** Crops of the same word share a word instance, which names one
  canonical crop. Exports read word instances, so a second crop of a word cannot be published.
- **Crops are matched across runs by overlap.** Crops with an intersection-over-union of at least 0.6
  are the same word. If a new crop has at least half its area inside an earlier crop without matching
  any word, the two conflict, as with a merged crop and a word inside it.
- **Competing crops need an admin's ruling.** If a word has more than one crop, or crops conflict, they
  go into a review queue. Until an admin rules, the words involved cannot be labelled or released. The
  chosen crop becomes canonical, and any word that lost a conflict is retired.
- **Corrections are new annotations** that point to the one they replace.
- **Trust is never stored on labels.** It is calculated from the history.
- **Split crops** (planned) become new crops with their own word instances, linked to the parent.
  Labels on the parent stay as they are.

## 11. Milestones

Each milestone ends with a check-in.

1. **Trial:** take one Harvard-Yenching manuscript volume through IIIF and segmentation, then measure
   crop quality and file sizes. The volume is *Chao ben Man wen ce* 鈔本滿文册 (19th century, 123 images,
   `URN-3:FHCL:10499177`), a neat hand with Manchu and Chinese in alternating columns.
2. **Foundations:** project scaffolding, data model, and the Abkai/Unicode converter with tests.
3. **Labelling:** labelling screen, page view, live preview, reference.
4. **Training:** quiz, rolling score, qualification.
5. **Quality control:** hidden checks, trust, profile history, disputes.
6. **Review:** consensus and the reviewer queue.
7. **Release:** export, data card, first public version.
8. **Lessons.**

## 12. Open questions

Answered on 2026-11-16:

1. **Manuscript known labels** are confirmed by reviewers or admins, ideally trained Manjurists. Moving
   candidate review from `review_candidates.py` into the app is left until after the first release.
2. **Hosting:** one VPS running Docker Compose, with the API, MongoDB on a private Docker network,
   and Caddy for HTTPS. Images are on R2, and a nightly `mongodump` goes to R2. As built in `deploy/`,
   images are served from the server's disk and synced to R2 nightly with the database dump. Serving
   them from R2 needs a storage adapter, which is not built yet.
3. **Undoing a held-back decision:** allowed, as described in section 7.

None are open now.

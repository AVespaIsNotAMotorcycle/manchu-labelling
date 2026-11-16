/** The data card and license notice for a release, written as Markdown. */

export interface CardVolume {
  id: string;
  title: string;
  date?: string | null;
  production: string;
  script: string;
  split?: string | null;
  words: number;
  rights: { statement?: string | null; attribution?: string | null; link?: string | null; license?: string | null };
}

export interface CardData {
  version: string;
  date: string;
  commit?: string;
  volumes: CardVolume[];
  counts: {
    words: number;
    labels: number;
    annotators: number;
    statuses: Record<string, number>;
    splits: Record<string, number>;
    categories: Record<string, number>;
    excluded: { activeChecks: number; heldBack: number; unlabelled: number; quizImages: number };
  };
  parameters: {
    trust: { window: number; threshold: number; minimumSample: number };
    consensus: { matching: number; labelsBeforeReview: number; labelsForHeldBack: number; maxLabelers: number };
    checks: { earlyRate: number; earlyImages: number; laterRate: number };
    qualification: { quizStreak: number; failedChecksToLose: number };
    holdBackRate: number;
  };
  credited: number;
}

const percent = (value: number) => `${Math.round(value * 1000) / 10}%`;

/**
 * Plain text from a rights statement, which sources sometimes give as HTML. A link keeps its address,
 * and other tags are dropped.
 */
export function plain(value: unknown): string {
  return String(value ?? "")
    .replace(/<a\s[^>]*href=["']?([^"'\s>]+)["']?[^>]*>(.*?)<\/a>/gi, (_match, href: string, label: string) =>
      label.trim() === href ? href : `${label} (${href})`,
    )
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const cell = (value: unknown) => plain(value).replaceAll("|", "\\|");

function sizeCategory(words: number): string {
  if (words < 1_000) return "n<1K";
  if (words < 10_000) return "1K<n<10K";
  if (words < 100_000) return "10K<n<100K";
  return "100K<n<1M";
}

function table(rows: Record<string, number>, heading: string): string {
  const entries = Object.entries(rows).sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) return "None.\n";
  return `| ${heading} | Words |\n| --- | ---: |\n${entries.map(([key, count]) => `| \`${key}\` | ${count} |`).join("\n")}\n`;
}

export function dataCard(data: CardData): string {
  const { counts, parameters: p } = data;
  const volumeRows = data.volumes
    .map(
      (volume) =>
        `| ${cell(volume.title)} | ${cell(volume.id)} | ${cell(volume.date)} | ${cell(volume.production)}, ${cell(volume.script)} | \`${cell(volume.split)}\` | ${volume.words} | ${cell(volume.rights.license ?? "see statement")} |`,
    )
    .join("\n");
  const rights = data.volumes
    .map(
      (volume) =>
        `- **${cell(volume.title)}** (${cell(volume.id)}): ${cell(volume.rights.statement)} Attribution: ${cell(volume.rights.attribution)}. ${cell(volume.rights.link)}`,
    )
    .join("\n");

  return `---
pretty_name: Manchu Word Images
language:
- mnc
license: other
license_name: labels-cc-by-4.0-images-per-volume
license_link: LICENSE.md
task_categories:
- image-to-text
tags:
- ocr
- manchu
- handwriting
- historical-documents
size_categories:
- ${sizeCategory(counts.words)}
---

# Manchu Word Images, version ${data.version}

Images of single words cut from historical Manchu scans, mostly manuscripts, each with crowdsourced
transcriptions. It is meant for training and evaluating Manchu OCR and handwriting recognition.

- **Version:** ${data.version}, made on ${data.date}${data.commit ? ` from commit \`${data.commit}\`` : ""}
- **DOI:** to be assigned on upload
- **Size:** ${counts.words} words from ${data.volumes.length} ${data.volumes.length === 1 ? "volume" : "volumes"}, with ${counts.labels} labels by ${counts.annotators} annotators
- **Labels:** CC BY 4.0. **Images:** the rights of each source volume, listed below.

Releases never change. Later versions add words and labels, and each says which version it follows.

## Files

| File | Contents |
| --- | --- |
| \`images/\` | One crop per word, named by the word's ID |
| \`words.jsonl\` | One line per word: its image, source, position, split, and final label |
| \`labels.jsonl\` | Every label anyone gave, including ones that were later corrected or did not count |
| \`volumes.jsonl\` | The source volumes, with their rights and splits |
| \`CONTRIBUTORS.md\` | People who asked to be credited by name |
| \`LICENSE.md\` | The licenses for labels and images |
| \`SHA256SUMS\` | A checksum for every file |

### \`words.jsonl\`

| Field | Meaning |
| --- | --- |
| \`id\` | The word's ID. It stays the same in later releases |
| \`file_name\` | The crop, relative to the release folder |
| \`split\` | \`train\`, \`validation\`, or \`test\` |
| \`volume\` | The source volume's identifier, as in \`volumes.jsonl\` |
| \`page\` | The page's index in the volume, its IIIF canvas, and its size in pixels |
| \`box\` | The crop's position on the page image, in pixels: \`x\`, \`y\`, \`width\`, \`height\` |
| \`position\` | Where the word sits on the page: \`side\` of a two-page spread, \`column\`, and \`word\` within the column |
| \`final\` | The label to use: \`status\`, and when there is one, \`category\` and the text as \`manchu\`, \`abkai\`, and \`mollendorff\` |
| \`production\`, \`script\` | The style, from a majority of the labels that counted, otherwise the volume's |
| \`labels\` | How many labels the word has in \`labels.jsonl\` |
| \`rights\` | The volume's rights statement, attribution, permanent link, and license |

Columns run from left to right, and words run from top to bottom within a column. Some positions are
missing, because some words are held back (see below) and some crops were not usable.

### \`labels.jsonl\`

| Field | Meaning |
| --- | --- |
| \`id\` | The label's ID |
| \`word\` | The word it labels |
| \`annotator\` | A pseudonymous annotator ID, the same in every release |
| \`created\` | When it was made |
| \`latest\` | Whether it is this annotator's latest label on the word. Earlier ones were corrected |
| \`counted\` | Whether the annotator was trusted when they made it (see Quality control) |
| \`category\`, \`transcription\`, \`intended\` | What the annotator said (see Labels) |
| \`production\`, \`script\` | Style overrides, when the annotator gave one |
| \`confidence\` | \`confident\` or \`unconfident\` for the category, the transcription, and the style |
| \`supersedes\` | The label this one corrects, if any |

## Sources

| Title | Identifier | Date | Style | Split | Words | Image license |
| --- | --- | --- | --- | --- | ---: | --- |
${volumeRows}

${rights}

## Labels

Each label gives a **category**: \`manchu\`, \`chinese\`, \`other_script\` (including Mongolian),
\`non_text\`, \`illegible\`, or \`bad_crop\`. A \`manchu\` label also gives a **transcription**.

- **Transcriptions record what is written, not the word that was meant.** Misspellings and missing
  dots are kept. The word that was meant can go in the optional \`intended\` field.
- A letter that cannot be read is written \`?\`, so a partly legible word is not lost.
- Text is stored in Manchu Unicode, without variation selectors, so it records letters rather than
  which shape of a letter the page used. Abkai and Möllendorff are derived from it. Neither
  romanization maps one-to-one to the script, so use \`manchu\` as the reference.
- Production is \`woodblock\`, \`movable_type\`, \`manuscript\`, or \`other\`. Script is \`regular\`,
  \`running\`, \`memorial\`, \`seal\`, or \`other\`. These are set per volume and can be overridden per word.

Final labels by category:

${table(counts.categories, "Category")}
## How the labels were made

Most annotators are not Manchu readers. The script is alphabetic, so it can be transcribed without
knowing the language, and the process is built around that.

1. **Training.** Before labelling a script class, an annotator passes a quiz in three phases: words
   rendered in Manchu fonts, photos of printed words, and manuscript images. Each needs ${p.qualification.quizStreak} correct
   answers in a row, and transcriptions must match exactly.
2. **Labelling.** Annotators see one word at a time in random order, with the page available, and
   type what is written in Abkai while a preview shows the Manchu. They cannot see other annotators'
   labels, and there is no dictionary check.
3. **Hidden checks.** Some words have answers from experts. They are mixed in without being marked, at
   ${percent(p.checks.earlyRate)} of an annotator's first ${p.checks.earlyImages} words and ${percent(p.checks.laterRate)} after that. An annotator who fails ${p.qualification.failedChecksToLose} in a row
   must pass the quiz again.
4. **Settling.** A word needs ${p.consensus.matching} matching labels that count. A label that is unsure, or has an
   unreadable letter, cannot settle a word. A disagreement brings in another annotator, and after
   ${p.consensus.labelsBeforeReview} labels without agreement a reviewer decides. A word is given to at most ${p.consensus.maxLabelers} annotators.

## Quality control

- **Trust** is worked out per annotator and script class when the release is made. A label counts
  if, when it was made, the annotator's latest ${p.trust.window} graded checks in that class averaged at least
  ${percent(p.trust.threshold)} character accuracy (1 − edit distance ÷ answer length, with a wrong category scoring 0).
  Annotators with fewer than ${p.trust.minimumSample} graded checks count as trusted. Every label is published, with
  \`counted\` saying whether it counted.
- Annotators can dispute a check's answer, and reviewers can correct it. Grades follow the current
  answer.

\`final.status\` says how each word's label was reached:

| Status | Meaning |
| --- | --- |
| \`known\` | An expert answer from a retired hidden check |
| \`reviewed\` | Annotators did not agree, and a reviewer decided |
| \`agreed\` | ${p.consensus.matching} or more labels that counted matched exactly |
| \`single\` | Only one label counted so far. Use with care |
| \`unsettled\` | The labels that counted do not agree yet, or none counted. There is no final label |

${table(counts.statuses, "Status")}
## Splits

Splits are made by volume, so that one hand or printing is never in both training and test data. A
volume keeps its split in every later release.

${table(counts.splits, "Split")}
## What is left out

- **Held-back words.** About ${percent(p.holdBackRate)} of words were chosen at random when their volume was imported,
  never by their labels, and held back to become new hidden checks. They stay out of releases until
  they are retired as checks. This release leaves out ${counts.excluded.heldBack}.
- **Active hidden checks**, whose answers would otherwise be published: ${counts.excluded.activeChecks}.
- **Words used in the training quiz**, whose answers annotators see while training: ${counts.excluded.quizImages}.
- **Words with no labels yet:** ${counts.excluded.unlabelled}.
- Crops from Chinese columns, words whose crops are awaiting an admin's ruling, and crops an admin
  retired.

Because of these, the dataset is not a full transcription of any page.

## Known limitations

- **Segmentation.** Crops are cut automatically and are rectangular, so parts of neighbouring words
  can appear, and some crops hold part of a word or two words. In a check of 100 random crops from
  the first volume, about 80 showed one complete word. Annotators mark bad crops as \`bad_crop\`.
- **Annotators.** Most are trained newcomers to Manchu rather than specialists. Trust and review
  limit the effect, but \`single\` labels in particular have had no second opinion.
- **Few expert answers for manuscripts.** Hidden checks for manuscripts come from a small number of
  expert-confirmed words, so trust is estimated from small samples, especially early on.
- **Letters, not glyphs.** Without variation selectors, two different shapes of a letter are written
  the same way.
- **Coverage.** The sources are a handful of volumes and do not represent every period, hand, or
  region.

## Annotators and credit

Annotator IDs are a keyed hash of an internal account ID, so the same person has the same ID in every
release but cannot be identified from it. People can ask to be credited by name, and ${data.credited}
${data.credited === 1 ? "has" : "have"} done so. Their names are in \`CONTRIBUTORS.md\`, listed separately and not linked to
annotator IDs, so that crediting someone does not publish their accuracy.

## License

Labels are licensed **CC BY 4.0** by their annotators. Images keep the rights of their source volumes,
listed in \`LICENSE.md\` and in each word's \`rights\`. Please give the attribution each source asks for.

## Citation

Please cite the release by its DOI once assigned, and credit the source libraries listed above.
`;
}

export function licenseText(data: CardData): string {
  const sources = data.volumes
    .map(
      (volume) =>
        `## ${plain(volume.title)} (${volume.id})\n\n- License: ${volume.rights.license ?? "not stated; see the rights statement"}\n- Rights statement: ${plain(volume.rights.statement)}\n- Attribution: ${plain(volume.rights.attribution)}\n- Permanent link: ${volume.rights.link ?? ""}\n`,
    )
    .join("\n");
  return `# Licenses

The labels and the images in this release are licensed separately.

# Labels

The labels in \`words.jsonl\` and \`labels.jsonl\` are licensed under the Creative Commons Attribution
4.0 International License (CC BY 4.0), <https://creativecommons.org/licenses/by/4.0/>. Annotators agreed
to this license when they joined.

# Images

Each image is a crop of a scan from the source volume named in its record, and keeps that volume's
rights. Give the attribution that each source asks for.

${sources}`;
}

# Security review brief

This brief is for an independent reviewer, human or AI model. The code so far, and the first review in
[`SECURITY.md`](../SECURITY.md), were written by one AI assistant, so the aim is a second opinion from
someone who shares none of its assumptions. Please look for ways to break things, not for a summary.

## What the app is

Manchu Labelling is a crowdsourcing app. Volunteers transcribe images of single words from historical
Manchu manuscripts, and the labels become a public dataset for training OCR models. It is an Express API
in TypeScript (`server/`), a React client (`client/`), and MongoDB, deployed with Docker Compose behind
Caddy (`deploy/`).

There are four kinds of visitor:

| Who | Can |
| --- | --- |
| Anonymous | Log in, register with an invite link, confirm an email, reset a password |
| Labeler | Take the training quiz, label words, see their own delayed accuracy, dispute answers, manage their account |
| Reviewer | All of that, plus settle disagreements and disputes and confirm held-back answers. Needs two-factor login in production |
| Admin | All of that, plus make invite links, rule on crops, and see every unpublished label. Needs two-factor login in production |

## What matters most

In priority order:

1. **Accounts.** Taking over an account, logging in without the password or second factor, escalating
   from labeler to reviewer or admin, or registering without a valid invite.
2. **Hidden checks.** Some images have known answers and are mixed into ordinary work to measure each
   labeler's accuracy. **No labeler may be able to tell which images are checks**, before or while
   labelling them. Responses, image URLs, IDs, timing, and errors should look the same for checks and
   ordinary images. The answers must never reach a labeler's browser. One deliberate exception: a
   labeler's past checks appear on their Progress page once they have labelled 25 more images.
3. **Quiz answers.** The training quiz must never send an answer before the user has answered.
4. **Held-back words.** About 15% of words are held back to become future checks. Nothing a labeler can
   see should reveal which words are held back.
5. **The dataset.** Labels are append-only: nothing should let anyone change or delete another person's
   labels, or their own beyond the documented 30-minute change of their last answer. Releases must not
   identify annotators: annotator IDs are a keyed hash, and credited names are listed separately.
6. **Fonts.** The Abkai and XM fonts are all rights reserved and must never be served to users. Users can
   add their own font files, which should stay in their browser and never reach the server.
7. **Ordinary web problems:** injection, cross-site scripting, cross-site request forgery, insecure
   direct object references, denial of service, secrets in logs or responses, and misconfiguration in
   `deploy/`.

## Attacks worth trying

### Accounts (`server/src/routes/auth.ts`, `server/src/accounts.ts`, `server/src/auth.ts`)

- Can login, registration, password reset, or "resend confirmation" reveal whether an email has an
  account, through the response, its timing, or the rate limits?
- Can a reset, confirmation, or invite token be guessed, reused, used after it expires, or used for a
  different account or purpose?
- Can someone log in before confirming their email, or confirm someone else's?
- After the password step, can the two-factor step be skipped, replayed, raced, or brute-forced? Can a
  recovery code be used twice, for example by two requests at once?
- Does changing or resetting a password, or deleting an account, really end every other session?
- Can a session be fixed or reused across users? Does logout end it?
- Can the per-address and per-account rate limits be bypassed, for example with `X-Forwarded-For`,
  IPv6 address ranges, letter case or spaces in emails, or several accounts?
- Can someone change their own role, or another user's, through any route? Roles are only meant to
  change with the `set-role` script.
- Can an invite be used to register with a different role or email than it was made for?
- Is two-factor authentication really enforced for reviewers and admins on every route that needs it?

### Hidden checks, quiz, and held-back words (`server/src/routes/labelling.ts`, `server/src/queue.ts`, `server/src/routes/training.ts`, `server/src/training.ts`, `server/src/checks.ts`, `server/src/profile.ts`)

- Compare every labelling response for a check and an ordinary image: `/api/labelling/next`,
  `/upcoming`, `/:id/context`, `/last`, the image URL, the response to saving, and the timing.
- Can the order or timing of images, the next-image head start, or the 30-minute answer change reveal a
  check?
- Does losing qualification after failed checks reveal more than it must? Being sent back to the quiz is
  expected, so the question is whether it shows *which* images were checks.
- Can the Progress page's 25-label delay be bypassed, for example with `/api/labelling/:id/change`,
  several browser sessions, or labelling images in a particular order?
- Can a quiz answer be read before answering, through `/api/training/:class/next`, a dispute
  (`/api/profile/disputes`), practice mode, or a reset?
- Can a labeler learn which words are held back, for example from how many people label a word, from
  the queue, or from the admin view's responses?

### Reviewers and admins (`server/src/routes/review.ts`, `server/src/routes/admin.ts`, `server/src/disputes.ts`, `server/src/held-back.ts`, `server/src/label-review.ts`)

- Can a labeler reach any `/api/review` or `/api/admin` route, or its data?
- Can a reviewer resolve their own dispute, review an image they labelled, or change a decision another
  reviewer made, other than through the documented undo?
- Can a race (two reviewers at once) record two conflicting decisions?

### Input and output

- Every route takes JSON. Check how each handles wrong types, very large values, unexpected fields,
  and MongoDB operators such as `{"$gt": ""}` in place of strings or IDs.
- Abkai text is converted to Manchu Unicode on the server (`server/src/label-input.ts`,
  `packages/script`). Can a crafted string break the conversion, store something that is not Manchu
  letters, or slow the server down?
- Can a dispute note, credit name, invite note, or font file name inject HTML or script anywhere it is
  shown, including the admin view and email bodies (`server/src/accounts.ts`)?
- Image keys are random. Can `/api/images/:key` be made to read any other file?
- Releases (`server/src/release.ts`, `server/src/data-card.ts`): can anything in the database, such as
  a volume's rights statement, a credit name, or a label, inject Markdown or HTML into the data card, or
  reveal an email or user ID?

### Fonts (`client/src/fonts.ts`, `client/src/components/FontPicker.tsx`)

- Is there any path by which an added font file reaches the server?
- Can a crafted font file do harm beyond the user's own browser?

### Deployment (`deploy/`, `Dockerfile`, `.dockerignore`)

- Is MongoDB unreachable from outside the server? Does the API's database user have only the access
  it needs?
- Do the images contain anything they should not, such as fonts, `.env` files, or the `data/` folder?
- Are the Caddy headers, HTTPS settings, and `trust proxy` setting right for one proxy in front of the
  API?
- Does `backup.sh` leak secrets, for example into the process list or logs?

## Known and accepted risks

These are described in `SECURITY.md`. Only report them if they are worse than described there:

- anyone who knows an email can lock that account for up to an hour with failed logins
- sessions last 7 days
- there are no passkeys yet
- everything runs on one server
- releases leave gaps where held-back words and checks were removed

## Running it locally

Use a throwaway database and your own ports, never the live site:

```sh
npm install
docker compose up -d mongo                       # MongoDB on 127.0.0.1:27018
cd server
MONGODB_URI=mongodb://127.0.0.1:27018/review PORT=3101 REQUIRE_TWO_FACTOR=true node --watch src/index.ts
# in another terminal, from the repository root:
API_TARGET=http://localhost:3101 npm run dev -w client -- --port 5273 --strictPort
MONGODB_URI=mongodb://127.0.0.1:27018/review npm run create-user -w server -- admin@example.com --admin
MONGODB_URI=mongodb://127.0.0.1:27018/review APP_ORIGIN=http://localhost:5273 npm run create-invite -w server
```

Without `SMTP_URL`, emails are printed to the API's console, so links for confirmation and password
reset appear there. `npm test` runs the test suites, and `server/test/accounts.test.ts` shows the
account flows end to end. To try hidden checks, import some with `import-known-labels` or create
`knownlabels` records by hand. The app has no images until a volume is imported. That needs a
volume fetched and segmented with the Python pipeline first, as in the commands in `CLAUDE.md`, and
then `import-segments`.

## What to send back

For each finding:

- **Title**, and **severity**: critical, high, medium, low, or note
- **Where:** the files and routes involved
- **How:** steps or a request that shows it, run against a local copy
- **Impact:** what an attacker gains, in terms of the priorities above
- **Fix:** a suggestion, if you have one

Please also list what you checked and found sound, so that the next review knows what was covered.
Send findings privately, through GitHub's **Report a vulnerability** on the repository's Security tab,
not in a public issue.

## A prompt for an AI reviewer

Give the model this brief, `SECURITY.md`, `CLAUDE.md`, and the files named above, then ask:

> You are reviewing this app for security before real users join. Work through the attacks in the brief
> and look for any others. For each one, read the code involved and decide whether it succeeds, citing
> the lines. Report findings in the format under "What to send back", most severe first, then list what
> you checked and found sound. Do not summarize the code or suggest style changes. If something depends
> on behavior you cannot see, such as a library's defaults, say so rather than guessing.

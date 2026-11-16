# Security

## Reporting a vulnerability

Please report security problems privately through GitHub's **Report a vulnerability** button on this
repository's Security tab, not in a public issue.

## How accounts work

- **Registration is by invite only.** Admins make links that work once, for 14 days, and can be tied to
  one email address. Only a hash of each link is stored.
- **Email must be confirmed** before an account can log in. Links in emails last 48 hours (confirmation)
  or 1 hour (password reset), work once, and are stored as hashes.
- **Passwords** need at least 12 characters with upper- and lower-case letters, a number, and a symbol,
  and are checked against Have I Been Pwned's breached passwords. Only the first 5 characters of the
  password's SHA-1 hash are sent, with padding. They are hashed with scrypt (N = 2^17, r = 8, p = 1).
  At most two hashes run at once, and a short queue waits, so a burst of logins cannot starve the server.
- **Sessions** are stored in MongoDB, with `HttpOnly`, `SameSite=Lax`, and, in production, `Secure`
  cookies that last 7 days. The session ID changes at every login. Changing or resetting a password, or
  deleting the account, ends every session that logged in before it.
- **Two-factor authentication** uses authenticator-app codes (TOTP). Secrets are encrypted with
  AES-256-GCM under `SECRETS_KEY`, each code works once, and there are 10 single-use recovery codes,
  stored as hashes. Reviewers and admins cannot use their tools without it in production.
- **Rate limits**, kept in MongoDB: 10 login attempts per address in 15 minutes, 10 failed logins per
  account an hour from any address, 10 two-factor guesses per account an hour, and limits on emails per
  address and per account. Reaching a limit raises an alert.
- **Responses never reveal whether an account exists.** Unknown emails are checked against a decoy
  hash so that logins take the same time, and the routes that send email answer the same way and send
  in the background.
- **Cross-site requests** that change anything are refused when `Origin` or `Sec-Fetch-Site` shows
  another site, and request bodies must be JSON.
- **Headers**: a strict content security policy, HSTS, `nosniff`, `frame-ancestors 'none'`, and a
  same-origin referrer policy, from the API and from Caddy.
- **Deleting an account** removes its email, password, credit name, and two-factor secrets. Labels stay,
  linked to the account's ID only, since they are licensed CC BY 4.0.
- **MongoDB** in production is only on an internal Docker network and the API logs in as a user limited
  to the app's database.

## Hidden checks

The rules in `CLAUDE.md` apply: the API must never reveal which images are hidden checks, and quiz
answers are only sent after the user answers. Past checks appear on a user's Progress page only after
25 more labels.

## Independent review

[`docs/security-review-brief.md`](docs/security-review-brief.md) is the brief for an independent reviewer,
human or AI: what matters most, attacks to try, how to run the app locally, and how to report findings.
`npm audit` found no known vulnerabilities in any dependency on 2026-11-16.

## Review, 2026-11-16

The authentication flow was reviewed by the developer who wrote it, an AI assistant, so an independent
review is still recommended before a wide launch. Found and fixed during the review:

- Routes that send email waited for the email, so their timing could show whether an account existed.
  They now send in the background.
- A deleted account's placeholder password made the hash check throw. It now fails to match.

Known risks that remain:

- **Lockout.** Anyone who knows a user's email can fail 10 logins and lock that account for up to an
  hour. Alerts make this visible. A per-account limit is the usual trade-off against guessing.
- **Stolen sessions** last up to 7 days unless the user changes their password.
- **Passkeys** are not supported yet. TOTP can be phished in real time.
- **One server.** The app, database, and images share one machine, with nightly backups to R2.
- **Losing `SECRETS_KEY`** turns off every two-factor login, and losing `ANNOTATOR_ID_SECRET` changes
  annotator IDs in later releases. Keep both backed up privately.
- **Published releases leave gaps** where held-back words and active checks were removed. A labeler who
  compares their history with a release could guess that a missing word is a check or held back. The
  hold-back rate makes the two indistinguishable.
- **Fonts**: the Abkai and XM fonts are not served. The production images leave them out, and users add
  their own font files, which stay in their browser and never reach the server. A font file is checked by
  loading it with the browser's font loader and is limited to 20 MB.

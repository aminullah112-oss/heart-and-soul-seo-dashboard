# Security

## The gates that matter

Publishing is the only irreversible action. Every gate is enforced inside
`runPublish()` in `@yme/pipeline`, not in the UI that calls it, because a
dashboard bug, a stray API call or a mis-scheduled cron must not be able to
publish something a human never approved.

The uploader refuses unless **all** of these hold:

1. The `PublishingJob` carries an `approvedById` and `approvedAt`.
2. The QC report passed.
3. The fact check passed.
4. A completed render exists.
5. A human selected a title and a thumbnail.
6. `AUTOMATIC_PUBLISH` is not fighting the channel's `humanApproval` setting.

Each is a separate refusal with its own message. There is an integration test
that constructs a `PublishingJob` with no approver and asserts the upload is
refused.

`MOCK_MODE=true` overrides `YOUTUBE_PROVIDER` unconditionally, and the mock
client contains no code path that reaches Google. A valid refresh token in
`.env` cannot publish while mock mode is on.

## Secrets

Every credential comes from the environment. Nothing is committed, nothing is
baked into an image, `.env` is gitignored and `.dockerignore`d.

The logger redacts `apiKey`, `authorization`, `x-api-key`,
`ANTHROPIC_API_KEY`, `TTS_API_KEY`, `STORAGE_SECRET_KEY`,
`YOUTUBE_CLIENT_SECRET` and `YOUTUBE_REFRESH_TOKEN`. Add to that list in
`packages/shared/src/logger.ts` when you add a provider.

Provider errors are mapped before they surface, so an upstream error body
containing a key does not reach a log line verbatim.

## Authentication

Opaque 256-bit random tokens in an httpOnly, SameSite=Lax cookie, stored as a
SHA-256 hash. Not JWTs: sessions must be revocable the moment an operator
leaves, and a stateless token cannot be revoked without building the session
table it was meant to avoid.

SHA-256 rather than argon2 for the token itself — it is CSPRNG output, not
brute-forcible, and does not need a slow KDF. Passwords are argon2id.

Login failures are rate-limited to eight per fifteen minutes per email and per
IP, recorded in the database rather than in memory so the limit survives a
deploy and spans replicas. A missing account and a wrong password take the same
time and return the same message.

Three roles: OWNER, EDITOR, VIEWER. VIEWER is read-only, enforced in every
server action — hiding a button is presentation, not authorisation.

## Media access

Renders are served through an authenticated route with range support, never
from a public path. An unlisted URL is not access control, and an unpublished
video leaking is precisely what this system exists to prevent.

Storage keys are resolved against the storage root and rejected if they escape
it; a rejected key returns 400, not a stack trace.

## Deliberate omissions

**No CSP.** Next's inline bootstrap needs a nonce, and a broken CSP that
everyone disables is worse than none. `X-Frame-Options`,
`X-Content-Type-Options`, `Referrer-Policy` and `Permissions-Policy` are set in
middleware. If you add a CSP, add it with a nonce and test the dashboard
thoroughly.

**Middleware does not validate sessions.** It only checks a cookie exists —
validating requires the database, which the edge runtime cannot reach. Real
authorisation happens in every page and server action.

**No audit log on reads.** Writes are logged; reads are not.

## Before you expose it

- Set `AUTH_SECRET` to 32+ random bytes. Production startup refuses shorter.
- Terminate TLS in front of it; the session cookie sets `secure` in production.
- Do not expose Postgres or Redis publicly. Redis holds job payloads and has no
  auth by default.
- Give the S3 credentials write access to one bucket, not an account-wide role.
- Rotate the YouTube refresh token if anyone leaves who had `.env` access.

## Reporting

This is a single-operator tool, not a multi-tenant service. If you make it
multi-tenant, the first things to revisit are that every query is scoped by
`channelId` and that the media route checks project ownership, not merely
authentication.

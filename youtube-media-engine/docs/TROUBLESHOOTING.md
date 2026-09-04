# Troubleshooting

Start with `pnpm doctor`. It verifies by doing, not by reading config.

## The pipeline stops and says it is blocked

That is usually the system working. Blocks are decisions, not crashes.

| Message | Meaning | What to do |
|---|---|---|
| `Research coverage N is below the floor of 55` | Not enough verifiable sourcing for an accurate video | Sharpen the angle toward something with primary sources, or drop it |
| `No claim survived citation checking` | Every extracted claim cited a URL that was never retrieved | Usually a dead search provider — check `SEARCH_PROVIDER` and the key |
| `Fact check failed with N high-risk finding(s)` | Unsupported figures, unattributed quotes, or a disputed claim stated as settled | Open the video review page; each finding names the section and a fix |
| `QC score N is below the configured minimum` | Composite quality below threshold | Read the warnings — usually placeholders or shot length |
| `Near-identical to "<title>"` | Duplicate of an existing video | Merge or sharpen the angle |

**In MOCK_MODE, QC will always block** on placeholder assets. There is no stock
provider offline, so visual quality is genuinely low. `--override-qc` continues
past the numeric threshold for a demo run. It cannot override a failed fact
check, a copyright failure, or a duplicate block.

## Rendering

**`ffmpeg is not runnable at "ffmpeg"`** — not installed or not on PATH. Set
`FFMPEG_PATH` to an absolute path.

**Charts render as empty boxes** — no fonts. Install
`fonts-dejavu-core fonts-liberation2 fonts-noto-core`. sharp and ffmpeg both
report success while drawing nothing, so this fails silently.

**`ffmpeg failed during scene <id>`** — the exact command is stored on the
`VideoRender` row. Copy it and run it by hand; the last lines of stderr are in
the error. Usually a corrupt downloaded asset.

**Render never finishes** — check concurrency. `WORKER_RENDER_CONCURRENCY`
above 1 on a small box makes every render slower than running them in sequence.

**`Could not load the "sharp" module`** — under pnpm's strict layout, sharp must
be declared by the package that resolves it. It is a dependency of both
`@yme/video` and `@yme/web` for exactly this reason.

**Audio is silent** — expected in MOCK_MODE: the mock TTS emits silence at the
correct duration so scene timing is exercised. With a real provider, check the
`Voiceover` rows have non-zero `durationSeconds`.

## Queues

**Jobs queue but never run** — the worker is not running, or `REDIS_URL` differs
between web and worker. `pnpm doctor` checks reachability.

**Jobs vanish** — Redis eviction. BullMQ needs `maxmemory-policy noeviction`;
anything else silently drops queued jobs under memory pressure. The doctor warns
about this.

**Jobs run twice after a restart** — a job was killed mid-flight and the stalled
checker requeued it. Stages are re-runnable by design; check the
`AutomationJob` rows for the real story.

**Scheduled jobs multiply** — should not happen; repeatables are keyed. If it
does, clear them with `getQueue(name).obliterate()` and restart.

## Database

**`Environment variable not found: DATABASE_URL`** from Prisma CLI — the CLI
reads `.env` relative to the schema. `packages/database/.env` is a symlink to
the root `.env`; make sure it survived the checkout.

**Migration drift** — `pnpm --filter @yme/database exec prisma migrate diff` to
see it. Never edit an applied migration.

**Connection pool exhausted in dev** — hot reload creating clients. The client
singleton guards against this; make sure nothing constructs `new PrismaClient()`
directly.

## Dashboard

**404 on a video that exists** — the classic one. `STORAGE_LOCAL_PATH` is
resolved against the repo root, not the working directory, precisely because the
worker and the web app run from different directories. If you overrode it with a
relative path in an unusual setup, make it absolute.

**Video will not seek** — the media route implements range requests. A proxy
that strips `Range` or `Accept-Ranges` breaks seeking.

**Signed in but redirected to login** — session expired (7 days) or the cookie
is not reaching the server. In production the cookie is `secure`, so it requires
HTTPS.

## Providers

**Anthropic 401** — bad key. Mapped as terminal; it will not retry.

**Anthropic 429** — rate limited. Retried with jittered backoff, four attempts.
Persistent 429s mean concurrency above your tier.

**`Task "X" returned output that does not satisfy its schema`** — the model
failed two repair attempts. The error carries a preview of the reply. Usually a
model too small for the task; check `TASK_TIER`.

**`hit the N-token output limit and was truncated`** — raise `maxTokens` for
that task, or shorten the input.

**YouTube 403 `quotaExceeded`** — 10,000 units a day, ~1,600 per upload. Resets
midnight Pacific. Terminal by design: retrying before the reset only wastes
attempts.

**Impressions always null** — impressions and CTR require access most channels
do not have. Recorded in `unavailable`, not as zero. That distinction is
deliberate: zero is a measurement, null is an absence.

## Cost

**Cost ceiling reached** — `LLM_MAX_COST_PER_VIDEO_USD` breached. Checked before
each call, so nothing overspent. Either raise it or find out why this video is
expensive (usually script rewrites).

**All cost on one stage** — the tracker is not being told which stage is
running. There is a test for this; if it regresses, check `tracker.setStage()`
in `runStage`.

## When nothing obvious is wrong

```sql
-- what failed recently, and why
SELECT stage, status, "errorKind", left(error, 120), "createdAt"
FROM "AutomationJob" WHERE status = 'FAILED'
ORDER BY "createdAt" DESC LIMIT 20;

-- projects stuck mid-stage
SELECT slug, stage, status, left("blockedReason", 100), "updatedAt"
FROM "VideoProject" WHERE status IN ('BLOCKED','FAILED')
ORDER BY "updatedAt" DESC;
```

The dashboard's Health page shows the same things plus stuck projects, queue
depth and the effective provider configuration.

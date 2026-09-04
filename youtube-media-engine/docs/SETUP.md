# Setup

## Requirements

| | | |
|---|---|---|
| Node | 20.11+ | 22 recommended |
| pnpm | 10 | `corepack enable` |
| PostgreSQL | 14+ | 16 tested |
| Redis | 6+ | needed only for the worker |
| ffmpeg | 5+ | **with libass and libfreetype** |
| Fonts | DejaVu / Liberation / Noto | without them charts render empty boxes |
| Disk | 20 GB+ free | a render plus intermediates is several GB |

Check ffmpeg has what the renderer needs:

```bash
ffmpeg -filters | grep -E 'zoompan|subtitles|sidechaincompress|loudnorm'
```

Four lines means you are fine. Fewer means captions, motion or audio
normalisation will fail at render time.

## Install

```bash
git clone <repo> && cd youtube-media-engine
cp .env.example .env
pnpm install
```

Bring up Postgres and Redis:

```bash
docker compose up -d postgres redis
```

Or point `DATABASE_URL` and `REDIS_URL` at existing instances.

Set two values in `.env` before seeding:

```bash
AUTH_SECRET=$(openssl rand -base64 32)
BOOTSTRAP_PASSWORD=<at least 12 characters>
```

The seed refuses to run without a password. There is no default account.

```bash
pnpm db:migrate
pnpm db:seed
pnpm doctor
```

`doctor` verifies ffmpeg filters, fonts, Redis eviction policy, disk headroom,
storage writability and which providers are live. Fix anything red before
continuing.

## First run

```bash
pnpm pipeline
```

Roughly twenty minutes on four cores, most of it ffmpeg. It will stop at QC
with placeholder-asset warnings — correct, because MOCK_MODE has no stock
provider. Add `--override-qc` to continue through approval and upload against
the mock YouTube client.

```bash
pnpm dev:web      # http://localhost:3000, sign in with BOOTSTRAP_EMAIL
pnpm dev:worker   # queue workers and scheduled jobs
```

## Going live

Flip one provider at a time, run the pipeline, read the output. The order in the
README exists because each step's failures are easier to diagnose alone.

Two things to know before the first real run:

- `LLM_MAX_COST_PER_VIDEO_USD` is enforced before each call, not after. Start
  low (2–3 dollars) and raise it once you have seen a real cost breakdown.
- Update `packages/config/src/pricing.ts` from the providers' current pricing
  pages. Those numbers are operator-maintained estimates and will drift.

## Scheduled work

The worker registers these on startup (`apps/worker/src/index.ts`):

| Job | Schedule | What it does |
|---|---|---|
| discover | every 6 hours | proposes new topics |
| score | 06:30 daily | scores everything discovered |
| ingest-analytics | 04:00 daily | pulls metrics; YouTube lags ~a day |
| learning-report | Monday 07:00 | weekly performance report |
| publish-due | every 5 minutes | uploads approved, scheduled videos |

Repeatable jobs are keyed, so restarting the worker replaces them rather than
accumulating duplicates.

Nothing here publishes on its own: `publish-due` only picks up jobs that already
carry a human approver.

# Deployment

## Shape

Three processes and two stateful services:

```
        ┌──────────┐        ┌──────────┐
        │   web    │        │  worker  │
        │  :3000   │        │          │
        └────┬─────┘        └────┬─────┘
             │                   │
       ┌─────┴───────────────────┴─────┐
       │                               │
  ┌────▼─────┐  ┌────────┐  ┌──────────▼──────┐
  │ Postgres │  │ Redis  │  │ object storage  │
  └──────────┘  └────────┘  └─────────────────┘
```

The web app is stateless and can run multiple replicas. **The worker should not
be scaled naively**: rendering is CPU-bound, and two encoders on one host are
slower than one. Scale renders by adding hosts, not by raising concurrency.

## Single host

The realistic starting point for two videos a week.

```bash
cp .env.example .env       # fill it in
docker compose --profile app up -d --build
docker compose run --rm migrate
docker compose exec web pnpm db:seed
```

Sizing: 4 vCPU and 8 GB is comfortable. Rendering is the constraint — a
12-minute 1080p video takes roughly 10–15 minutes on 4 cores at the `medium`
preset. Storage grows about 60 MB per finished video plus intermediates that are
cleaned up after each stage.

Put a TLS terminator in front of `web`. The session cookie sets `secure` in
production and will not survive plain HTTP.

## Scaling out

When one host is not enough, split in this order:

1. **Managed Postgres.** The first thing you want backed up.
2. **S3-compatible storage.** `STORAGE_DRIVER=s3`. R2 or B2 are considerably
   cheaper than S3 for this access pattern (write once, read rarely, egress on
   upload only).
3. **Separate render hosts.** Run additional workers with
   `WORKER_PRODUCTION_CONCURRENCY=0` so they consume only the render queue.
4. **Web replicas.** Stateless; sessions live in Postgres.

Managed Redis is the last thing to move. Job payloads are small and the durable
record is in Postgres — losing Redis loses timers, not work.

## Configuration that matters in production

```bash
NODE_ENV=production
AUTH_SECRET=<32+ random bytes>      # startup refuses shorter
MOCK_MODE=false
AUTOMATIC_PUBLISH=false             # leave it
HUMAN_APPROVAL=true
RENDER_PRESET=medium                # slower gives marginal gains
LLM_MAX_COST_PER_VIDEO_USD=8.00
```

`AUTOMATIC_PUBLISH=true` alongside `HUMAN_APPROVAL=true` is rejected at startup
rather than resolved silently.

## Migrations

```bash
docker compose run --rm migrate     # prisma migrate deploy
```

Run before starting the new version. `migrate deploy` never generates or resets;
it applies committed migrations only.

## Backups

| What | Why |
|---|---|
| Postgres | Everything that matters: research, scripts, claims, costs, analytics |
| Object storage | Renders. Reproducible from Postgres, but re-rendering costs money and time |
| `.env` | Credentials, especially the YouTube refresh token, which is painful to regenerate |

Postgres is the one that must be automated. A lost render can be rebuilt; lost
research and analytics history cannot.

## Monitoring

The Health page covers day-to-day: failed jobs, queue depth, stuck projects,
24-hour spend, live provider configuration.

Worth alerting on externally:

- Any `AutomationJob` FAILED in the last hour
- `VideoProject` ACTIVE and untouched for 6+ hours (crashed worker)
- Daily spend above expectation
- Free disk under 10 GB — renders fail loudly and late

Logs are structured JSON (pino) with `jobId`, `videoId`, `stage` and `attempt`
on every job-scoped line.

## Upgrades

1. Back up Postgres.
2. Let in-flight renders finish — the worker drains on SIGTERM.
3. `docker compose run --rm migrate`
4. Restart web and worker.

Stages are re-runnable, so a job interrupted by a deploy re-enters at its own
stage rather than restarting the pipeline.

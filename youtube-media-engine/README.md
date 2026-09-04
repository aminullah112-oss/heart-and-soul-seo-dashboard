# YouTube Media Engine

An AI-assisted production system for a faceless **AI × Business × Money** channel.
It takes a topic from discovery through research, scripting, fact checking,
rendering and packaging, stops for a human, and then uploads and measures.

**It is built to refuse.** A topic that cannot be sourced is rejected. A script
that asserts an unsupported figure fails the fact check. A chart whose numbers
do not trace to a stored claim is dropped rather than drawn. Nothing reaches
YouTube without a named human approving it. Those refusals are the product;
the video generation is the easy part.

---

## Start here

```bash
cp .env.example .env          # MOCK_MODE=true is the default — keep it
pnpm install
pnpm db:migrate               # needs Postgres; see docker-compose.yml
pnpm db:seed                  # creates the channel and your operator account
pnpm doctor                   # verifies ffmpeg, fonts, Redis, disk, storage
pnpm pipeline                 # runs the whole thing end to end, offline
```

`pnpm pipeline` discovers topics, scores them, researches the winner, writes
and fact-checks a script, storyboards it, synthesises narration, renders a real
1080p video with charts and captions, generates titles and thumbnails, runs QC,
and stops. It makes **no external API calls and spends nothing**.

Then look at it:

```bash
pnpm dev:web                  # http://localhost:3000
```

### What a run actually produces

A representative offline run on a 4-core machine:

| | |
|---|---|
| Video | 8m 32s, 1080p, 43 scenes, 61 MB |
| Shorts | 2 × vertical, captions burned in |
| Packaging | 10 titles, 6 thumbnails rendered |
| Sources | 9 retrieved, 5 claims extracted, coverage 82 |
| Tracked cost | $0.44 (priced as if the LLM calls were real) |
| Wall clock | ~20 minutes, dominated by ffmpeg |

QC will block that run at "42 placeholder assets present". That is correct —
offline there is no stock provider, so there is no real footage. Pass
`--override-qc` to walk the rest of the path (approval, upload, analytics)
against the mock YouTube client.

---

## Going live, one provider at a time

Do not hand it every credential at once. Flip one provider, run the pipeline,
read the output, then flip the next. Each step below is independently useful.

1. **LLM.** `MOCK_MODE=false`, `LLM_PROVIDER=anthropic`, set `ANTHROPIC_API_KEY`.
   Everything else stays mock. You now get real research questions, real
   scripts and a real fact check — and a real bill. Watch `LLM_MAX_COST_PER_VIDEO_USD`.
2. **Search.** `SEARCH_PROVIDER=brave` or `tavily`. Research starts hitting the
   open web, and the coverage gate starts rejecting topics for real reasons.
3. **TTS.** `TTS_PROVIDER=elevenlabs` or `openai`. Check the pronunciation
   warnings on the first run and add dictionary entries before spending more.
4. **Stock and images.** `STOCK_PROVIDER=pexels`, `IMAGE_PROVIDER=openai`. The
   placeholder count in QC should collapse toward zero.
5. **YouTube, last.** `YOUTUBE_PROVIDER=google` with OAuth credentials. See
   [docs/YOUTUBE_SETUP.md](docs/YOUTUBE_SETUP.md). Upload as `PRIVATE` first and
   watch the result on YouTube before you ever choose `PUBLIC`.

`MOCK_MODE=true` overrides every provider setting. It is a single switch that
guarantees no spend and no publish, whatever else is configured.

---

## How it fits together

```
 discovery ──▶ scoring ──▶ [human approves topic]
                               │
                               ▼
  RESEARCH ─▶ STORY ─▶ SCRIPT ─▶ FACT_CHECK ─▶ VISUALS ─▶ VOICE
                                                            │
                    ┌───────────────────────────────────────┘
                    ▼
                 RENDER ─▶ PACKAGING ─▶ QC ─▶ [human approves video]
                                                     │
                                                     ▼
                                          SCHEDULED ─▶ PUBLISHED ─▶ analytics
                                                                        │
                                                              learning ◀─┘
```

Each stage is a separate queued job that reads its inputs from the database.
A render failure costs one render, not the research that preceded it.

| Package | Responsibility |
|---|---|
| `@yme/config` | Zod-validated env; cross-field rules so a half-configured provider fails at startup |
| `@yme/shared` | Scoring, gates, similarity, text analysis, error taxonomy |
| `@yme/database` | Prisma schema, cost ledger, system log |
| `@yme/ai` | LLM abstraction, structured generation, cost tracking, deterministic mock |
| `@yme/research` | Search providers, page fetching, source tiering |
| `@yme/agents` | The ten agents, from trend hunter to QC |
| `@yme/audio` | TTS providers, pronunciation dictionary |
| `@yme/images` | Stock and generated imagery |
| `@yme/video` | Charts, cards, captions, ffmpeg assembly, Shorts |
| `@yme/storage` | Local and S3-compatible object storage |
| `@yme/youtube` | Data API v3 + Analytics API, and a mock that cannot reach Google |
| `@yme/analytics` | Ingestion, retention analysis, significance testing, learning reports |
| `@yme/pipeline` | Stage orchestration and the publish gates |
| `apps/worker` | BullMQ workers and scheduled jobs |
| `apps/web` | The approval dashboard |

Deeper detail: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## Things worth knowing before you rely on it

**The scores are rubrics, not predictions.** A title scored 82 has not been
calibrated against anything. Until roughly twenty videos have published
analytics, the numbers rank candidates against each other and nothing more.
The learning loop checks whether they predict real CTR and tells you when they
do not. [docs/SCORING.md](docs/SCORING.md)

**The renderer has a ceiling.** ffmpeg gives you Ken Burns, cuts, composited
typography, real charts and burned captions. That is a solid explainer-channel
look. It is not motion graphics, and no amount of configuration will make it
one. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#rendering-limits)

**Duplicate detection is lexical.** It catches reused prose and shared
subjects. It misses paraphrased overlap — two differently-worded videos about
the same company surface as RELATED, not CANNIBALIZES. Embeddings are the fix
and are not built.

**Per-video A/B testing is underpowered.** Detecting a 10% CTR change on a 4%
base rate needs roughly 25,000 impressions per arm. The system says "not enough
data" rather than declaring a winner, and tells you what you would need.

**Nothing here is legal advice about fair use.** The asset registry records
licences and flags risk so a human can decide. It does not decide.

---

## Commands

```bash
pnpm doctor           # preflight: ffmpeg, fonts, Redis, disk, storage, providers
pnpm pipeline         # full run; --topic <id>, --no-publish, --override-qc
pnpm dev:web          # dashboard on :3000
pnpm dev:worker       # queue workers and scheduled jobs
pnpm test             # 126 unit + integration tests
pnpm typecheck        # every package
pnpm db:studio        # browse the database
```

## Documentation

- [SETUP.md](docs/SETUP.md) — installation and first run
- [ARCHITECTURE.md](docs/ARCHITECTURE.md) — design decisions and their reasons
- [AGENTS.md](docs/AGENTS.md) — what each agent does and what it refuses
- [SCORING.md](docs/SCORING.md) — what the numbers mean and do not mean
- [YOUTUBE_SETUP.md](docs/YOUTUBE_SETUP.md) — OAuth, scopes, quota
- [COSTS.md](docs/COSTS.md) — where the money goes and how to cut it
- [SECURITY.md](docs/SECURITY.md) — auth, secrets, the publish gates
- [TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) — failures and what they mean
- [DEPLOYMENT.md](docs/DEPLOYMENT.md) — running it in production

# Cost control

## Where it goes

A representative offline run, priced as though the LLM calls were real:

| Stage | Cost | Share |
|---|---|---|
| RENDER | $0.171 | 39% |
| SCRIPT | $0.073 | 16% |
| VISUALS | $0.069 | 16% |
| PACKAGING | $0.050 | 11% |
| RESEARCH | $0.023 | 5% |
| QC | $0.021 | 5% |
| STORY | $0.020 | 4% |
| FACT_CHECK | $0.018 | 4% |
| **Total** | **$0.444** | |

Read this as *shape*, not as a quote. Mock token counts are estimated, and
RENDER here is your own compute priced at 2 cents per output minute — a
self-hosted number that becomes a real cloud bill if you rent the CPU.

With live providers the shape changes substantially:

- **TTS becomes significant.** ElevenLabs at roughly $0.18 per 1,000
  characters, and a 12-minute script is about 10,000 characters — call it $1.80
  a video. OpenAI TTS is roughly a tenth of that and noticeably less good.
- **Generated images add up.** One per non-chart scene at $0.04, and a 12-minute
  video has 40+ scenes. Stock footage where it fits is cheaper and often better.
- **Search is negligible.** Fractions of a cent per query.

A realistic all-in figure with live providers is **$4–9 per finished video**,
dominated by LLM and TTS. Two videos a week is $35–70 a month before compute.

## The ceiling

`LLM_MAX_COST_PER_VIDEO_USD` is checked **before** each call, using a
conservative estimate of the call about to be made. A runaway retry loop cannot
spend past the cap and then report it. Breaching it raises a terminal BUDGET
error — the job fails loudly rather than quietly costing more.

Start at 2–3 dollars. Raise it once you have seen a real breakdown.

## Cutting it

**Move tasks down a tier.** `TASK_TIER` in `packages/ai/src/types.ts` maps each
task to reasoning, drafting or cheap. Storyboarding and title generation work
fine on a cheaper model. Fact checking should stay on the strongest available —
it is the one place where saving cents costs credibility.

**Fix the story brief, not the script.** Script rewrites are the largest LLM
line item after the initial draft. Two rewrites mean three full-length
generations. If retention scores are consistently sub-floor, the brief is the
problem.

**Prefer stock over generated imagery.** Pexels is free and photographic;
generated images are $0.04 each and can carry trademark risk.

**Reuse voice.** The voice stage skips scenes whose voiceover already exists, so
a script edit only re-synthesises what changed. Do not force re-synthesis unless
the narration actually changed.

**Render at 1080p.** `RENDER_RESOLUTION=4k` roughly quadruples encode time for a
platform that will re-encode it anyway. Use `RENDER_PRESET=faster` while
iterating.

## Watching it

The dashboard shows 30-day spend by category and per-video spend by stage.
Directly:

```sql
SELECT stage, category, SUM(usd)::numeric(12,4) AS usd
FROM "CostRecord"
WHERE "createdAt" > now() - interval '30 days'
GROUP BY 1, 2 ORDER BY 3 DESC;
```

Cost per published video, which is the number that matters:

```sql
SELECT p.slug, SUM(c.usd)::numeric(12,4) AS cost
FROM "CostRecord" c
JOIN "VideoProject" p ON p.id = c."videoProjectId"
WHERE p.stage = 'PUBLISHED'
GROUP BY 1 ORDER BY 2 DESC;
```

## Against revenue

Analytics snapshots carry `estimatedRevenueUsd` and `rpmUsd` where the channel
is monetized. A business/tech channel with a US-heavy audience can see RPM in
the $8–20 range, which at even 20,000 views is $160–400 against a $6 production
cost.

That arithmetic is not the constraint. Getting to 20,000 views per video is. The
production cost of this system is small enough that optimising it before the
channel works is the wrong problem — and small enough that a topic being
rejected for thin sourcing costs almost nothing, which is the point.

## Keep the price table current

`packages/config/src/pricing.ts` holds operator-maintained estimates. Providers
change pricing without notice. The ledger records the rate in effect at the time
of each call, so updating the table never rewrites history — but leaving it
stale makes every future report wrong.

# Architecture

Design decisions and the reasoning behind them. Where a decision has a real
cost, that cost is stated.

## The organising principle

**Models supply judgement; code supplies enforcement.**

An LLM decides whether a story is interesting, how to structure it, and how to
phrase it. Code decides whether a claim has a source, whether a chart's numbers
trace to that source, whether a score clears a gate, and whether anything may
be published. Every rule in the specification that says "never" is implemented
as a check that runs after the model, not as a sentence inside a prompt.

This matters because prompts are requests. A model that has been told not to
invent a statistic will still occasionally invent one, and the only thing that
turns that instruction into a guarantee is a check that fails.

Concretely:

| Rule | Where it is actually enforced |
|---|---|
| Never fabricate a source | `researcher.ts` drops any claim whose cited URL was not retrieved |
| Never chart invented numbers | `visual-director.ts:validateChart` resolves `sourceClaimKey` against the database |
| Confidence must match evidence | Capped by source tier and independent-domain count, not by what the model asserted |
| Reject unresearchable topics | Coverage floor blocks production before any money is spent on rendering |
| No auto-publish | Six independent gates inside the uploader itself |
| Not a slideshow | Shot length measured; over-long scenes split mechanically |

## Stage isolation

Production is nine stages, each a separately queued job that reads its inputs
from the database and writes its outputs there.

The alternative — one job that runs the whole pipeline — is simpler until
something fails. A render failure in a monolithic job either loses everything
before it or requires bespoke checkpointing. Here, a failed render leaves eight
completed `AutomationJob` rows and a `VideoRender` marked FAILED; retrying
re-enters `RENDER` and reuses the stored per-scene audio and frames.

The cost is more database round trips and more moving parts. Worth it: the
expensive stages are at the end, and they are the ones that fail.

Queues are split by resource profile rather than by domain:

- `production` — IO-bound (LLM, HTTP). Concurrency 4.
- `render` — CPU-bound. Concurrency 1; ffmpeg already uses every core, and two
  concurrent 1080p encodes on four cores are slower than two sequential ones.
- `publish` — concurrency 1, **no automatic retries**. A partially completed
  upload can leave a duplicate on the channel, and a duplicate is worse than a
  human pressing the button again.

## Rendering

### Composition in SVG, motion in ffmpeg

Every frame is composed as SVG and rasterised with sharp. ffmpeg only applies
motion, concatenates and mixes audio.

The alternative is ffmpeg's `drawtext`, which requires escaping colons, quotes,
backslashes and percent signs — all of which occur in real company names — and
offers no text wrapping at all. Pushing layout into SVG removed that entire
class of failure and made chart typography possible.

### Per-scene segments, not one filtergraph

Scenes are encoded individually and joined with the concat demuxer.

A single filtergraph across 90 scenes is faster on paper. It also holds every
input open at once, fails as one opaque unit, and restarts from zero when scene
84 has a bad asset. Segments are individually cacheable, individually
debuggable, and bounded in memory. The concat step is a stream copy, so the
joining itself is nearly free.

### Rendering limits

What this produces: Ken Burns motion on stills, hard cuts, composited
typography and lower thirds, real data charts, burned or soft captions, a
ducked music bed, loudness-normalised audio at −14 LUFS.

What it does not produce: keyframed motion graphics, animated transitions
between chart states, 3D, or anything requiring a compositor. That is an After
Effects or Remotion problem, not an ffmpeg one. If the channel needs that look,
the render stage is the seam to replace — everything upstream of it is
unaffected.

Average shot length is measured and enforced: scenes longer than 12 seconds are
split on sentence boundaries. Before that was mechanical, storyboards came back
with a 29-second average, which is a slideshow.

### Audio

Narration is synthesised per scene, not as one take. A failed scene costs one
re-synthesis, scene timing comes from measuring each clip with ffprobe rather
than estimating word rate, and a script edit only re-synthesises what changed.

Music is ducked with `sidechaincompress` keyed off the narration, then the
whole mix is normalised to −14 LUFS with a −1.5 dBTP ceiling. YouTube
normalises playback to roughly that level; uploading louder means it gets
turned down while the compression used to get loud stays, which is why some
channels sound flat next to others.

Single-pass `loudnorm` is used rather than two-pass. Two-pass is more accurate
on wide-dynamic material; narration over a ducked bed is not wide-dynamic, and
the second decode of a 4K master is not worth half a loudness unit.

## Captions

Timing is derived from measured scene audio durations, not from a
speech-to-text pass. The system wrote the narration and synthesised the audio,
so it already knows exactly what was said and for how long; running ASR over
the result would add cost and introduce transcription errors into a transcript
that is currently exact.

Long-form ships soft subtitles (SRT and WebVTT). Shorts burn captions in,
because most Shorts viewing is sound-off. Burning into long-form is deliberately
not the default: it is irreversible, the viewer cannot turn it off, and captions
collide with the lower third of charts.

## Duplicate detection

Lexical Jaccard over unigrams and trigrams, weighted toward trigrams, with a
boost when the candidate shares a primary entity with an existing video.

Chosen over embeddings because it costs nothing per check and is inspectable —
when the dashboard says 82% overlap, an operator can see which phrases matched.

**Known limitation, deliberately not tuned around:** after stopword removal,
"How NVIDIA Makes Money" and "How NVIDIA Makes Billions From AI" share only
"nvidia" and surface as RELATED rather than CANNIBALIZES. The shared-entity
boost is not inflated until that one example passes, because a threshold tuned
until a specific case works is overfitting, not detection. Catching paraphrased
overlap needs embeddings; that is the next upgrade, and it is not built.

## Statistics

`packages/analytics/src/stats.ts` exists because the default behaviour of every
analytics feature is to declare a winner. Two thumbnails at 4.1% and 3.8% CTR
on 900 impressions gets reported as a 7.9% improvement, and acting on it trains
the channel on noise.

So the comparison API returns "not enough data" as a first-class result, refuses
to compare below 1,000 trials per arm, applies a two-proportion z-test above
that, and reports how many impressions per arm would actually be needed. For a
10% relative change on a 4% base rate that is roughly 25,000 per arm — which is
the honest answer to whether per-video thumbnail testing works at small scale.

Retention drop-offs rank by **relative** loss, not absolute. Losing eight points
from 90% is routine; losing eight points from 30% is a quarter of the remaining
audience.

The learning report files every observation as provisional below twenty
published videos, enforced in code after the model returns rather than requested
in the prompt.

## Cost

Every provider call writes a `CostRecord` with the stage that incurred it, the
provider, the units and the rate. "What did this video cost" is a sum over one
table, not an estimate.

Money is `Decimal(12,6)`, not a float: a video is hundreds of sub-cent LLM
charges, and float error accumulates across them.

The budget ceiling is checked **before** each call using a conservative estimate
of the call about to be made, so a runaway retry loop cannot spend past the cap
and then report it.

Prices in `packages/config/src/pricing.ts` are operator-maintained estimates,
not live rates. The ledger records the rate in effect at the time, so editing
them never rewrites history.

## Data model

`VideoProject` is the hub; `stage` on it is the single source of truth for the
production queue.

Claims and sources are separate tables joined explicitly, because a claim
supported by three independent outlets is materially stronger than one supported
by three pages of the same outlet — and because a hallucinated citation is then
unrepresentable rather than merely discouraged.

Nothing is deleted on failure. A failed render keeps its row with the error and
the exact ffmpeg command, so a bad render can be reproduced by hand.

## Auth

Opaque random session tokens in an httpOnly cookie, stored as a SHA-256 hash.
Not JWTs: sessions must be revocable the moment an operator leaves, and a
stateless token cannot be revoked without building the session table a JWT was
supposed to avoid.

Tokens are hashed with SHA-256 rather than argon2 — they are 256 bits from a
CSPRNG, so they are not brute-forcible and do not need a slow KDF. Passwords are
argon2id.

Login failures are rate-limited in the database rather than in memory, because
an in-memory limiter resets on deploy and does not span replicas.

## Known gaps

- No embedding-based similarity (see above).
- No PDF parsing in research: filings and reports served as PDFs are recorded as
  unusable with a reason rather than parsed.
- `returningViewers` is not populated from the YouTube Analytics API — the
  dimension query it needs is unavailable on most channels, so it is left null
  rather than guessed.
- A/B variants are served sequentially, not split concurrently, because YouTube
  does not expose per-variant impressions to third parties. That confounds the
  variant with video age and algorithmic promotion, and the result is labelled
  accordingly.
- No CSP on the dashboard: Next's inline bootstrap needs a nonce, and a broken
  CSP everyone disables is worse than none.

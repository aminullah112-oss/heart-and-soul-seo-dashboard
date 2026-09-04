# What the numbers mean

Short version: **most of them are rubrics, not predictions.** This document
says which is which, so nobody builds a strategy on a number that has never
been checked against reality.

## Topic score (0–100)

Twelve dimensions rated by a model, weighted in code, gated in code.

The split matters. Asking a model for an "overall score" produces a number that
drifts between calls and cannot be re-derived when weights change. Here the
model supplies only the twelve dimension ratings; the weighting arithmetic and
the pass/fail gates are deterministic, and the weights used are stored with each
score so an old score stays interpretable after retuning.

**`competition` is inverted.** A high raw value means the topic is saturated,
which lowers the overall score. This is the sign error most likely to be
reintroduced by someone simplifying the weighting, so it is covered by a test
that asserts it for every dimension.

Two gates, both hard:

- `researchAvailability` below 45 rejects the topic regardless of everything
  else. A great story you cannot source is the video that produces a
  correction.
- Overall below the channel's `minimumTopicScore` rejects it.

**Is it predictive?** Unknown. It is a consistent way to rank candidates against
each other. Whether a 91 outperforms a 76 on the actual channel is exactly what
the learning loop measures, and it will not have an answer until roughly twenty
videos have published analytics.

## Title and thumbnail rubric scores (0–100)

**These are not predicted CTR.** Nothing in this system has been calibrated
against impressions. Calling them a CTR prediction would be a fabrication, so
the field is named `rubricScore` in the database, the dashboard labels every
occurrence "rubric scores, not CTR predictions", and the API type carries the
same note.

What they are: a weighted rubric over curiosity, clarity, search intent,
credibility, uniqueness and emotional impact, used to order candidates for a
human to choose from. The human chooses; the ranking is a suggestion.

`overclaims` is separate and binary. A title that promises something the video
does not establish is removed from the list entirely, not merely scored down.

Once around twenty videos have analytics, `calibrateRubric()` compares the
rubric score against observed CTR and reports the median outcome for
above-median versus below-median rubric scores. If those two medians are close,
the rubric predicts nothing and should be retired or retuned — and the report
says so in those words.

## Retention score (0–100)

A checklist over hook strength, first-30-seconds, curiosity gaps, pacing,
density, pattern interrupts, tension and payoff frequency.

**It is a pre-publication review, not a forecast.** It cannot know how a real
audience behaves. Its value is that it is acted on: below 72, the script is
rewritten with the specific findings fed back, up to twice. A score that only
gets reported is decoration.

After publishing, the real curve arrives from the Analytics API and
`findDropOffs()` reports where viewers actually left, ranked by relative loss.
That is the number with predictive content; the pre-publication score is the
guess it eventually replaces.

## Script quality (0–100)

Computed mechanically, not asked of a model, because a model grading its own
prose grades generously. Measures length drift against target, banned filler
phrases, open loops, proportion of sections with no supporting claim, repeated
section openings, and thin sections.

The QC stage takes the **minimum** of this and the model's own rating.

## QC final score (0–100)

Weighted composite of script quality, retention, originality, visual quality and
monetization safety.

**The composite is the second gate, never the only one.** Any FAIL among fact
check, copyright or policy blocks publication regardless of the number. A 96/100
video with an uncleared asset does not ship, and there is a test for exactly
that.

Visual quality is largely mechanical: average shot length, presence of data
visualisation, count of placeholder assets. In MOCK_MODE it is genuinely low
because every visual is a placeholder — that is the correct answer, not a bug.

## Monetization potential (0–100)

Deliberately separate from the topic score. Conflating them pushes a channel
toward finance-bait, because the highest-RPM topics are not the most valuable
ones to make. A topic can score 90 editorially and 40 commercially and still be
the right video.

## A/B test results

The only numbers here with real statistical meaning, and they usually say "not
enough data".

Below 1,000 impressions per arm, no comparison is attempted. Above it, a
two-proportion z-test at α = 0.05; a p-value over 0.05 returns inconclusive with
a confidence interval that includes zero, plus the sample size that would be
needed.

For a 10% relative change on a 4% base rate that is about 25,000 impressions per
arm. Most videos on a growing channel never reach it, which means per-video
thumbnail testing detects only large effects. That is a property of the
arithmetic, not a limitation of this implementation.

Variants are also served **sequentially**, because YouTube does not expose
per-variant impressions to third parties. That confounds the variant with video
age and algorithmic promotion. Every conclusive result carries that caveat in
its text.

## Learning report findings

Split into `findings` (actionable) and `provisional` (suggestive, underpowered).

Below twenty published videos, or eight per compared group, everything is
provisional — enforced in code after the model returns, not requested in the
prompt. A model asked to be careful about sample size will still occasionally
produce a confident finding from n=3.

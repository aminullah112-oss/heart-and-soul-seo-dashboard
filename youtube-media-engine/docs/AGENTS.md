# The agents

Ten agents. For each: what it does, what it refuses, and where it can go wrong.

Every one calls through `generateStructured()` in `@yme/ai`, which validates the
reply against a Zod schema, feeds validation errors back to the model for up to
two repair attempts, and charges the cost ledger before spending.

---

## 1. Trend Hunter — `trend-hunter.ts`

Proposes video opportunities from live search results plus the existing
catalogue.

**Refuses:** anything already in the catalogue (checked before storage, not
suggested in the prompt).

**Requires a mechanism.** "X announced Y" is rejected as a story; "X's
announcement only makes sense if you know their revenue comes from Z" is not.
The `discoverySignal` field exists to make that explicit and reviewable.

**Where it goes wrong:** with a dead search provider it falls back to the
catalogue and pillar definitions, which produces plausible but stale
suggestions. The log warns; the dashboard does not yet surface it.

## 2. Topic Scorer — `topic-scorer.ts`

Rates twelve dimensions. Weighting and gates are computed in code. See
[SCORING.md](SCORING.md).

**Refuses:** topics below the research-availability floor, and topics below the
channel minimum. Both write the reason onto the topic so the radar shows why
something will never be produced.

Temperature 0.3 — scoring should be stable across runs, not creative.

## 3. Researcher — `researcher.ts`

Plans queries, retrieves pages, extracts claims.

**Refuses, and this is the important one:** a claim citing a URL that was not
actually retrieved is dropped. Confidence is capped by source tier and by the
number of independent domains, regardless of what the model asserted —
journalism alone cannot make a revenue figure HIGH confidence, and neither can
three pages of the same outlet.

Coverage below 55 blocks the whole project before any money reaches rendering.
An honest "we cannot make this video" is a correct output.

Sources that fail to retrieve are kept with the reason rather than discarded —
"we looked and could not use it" is evidence about coverage.

**Where it goes wrong:** no PDF parsing, so a filing served as a PDF is recorded
unusable. On a subject where the primary sources are all PDFs, coverage will be
low for a reason that is about the fetcher, not the subject.

## 4. Story Architect — `story-architect.ts`

Builds the brief before any prose exists.

The narrative arc must come from the story. Recently used arcs are shown to the
model with an instruction not to reuse the shape, because reusing one template
is what makes a channel feel automated.

Claim keys in the brief are validated against the database; unknown ones are
dropped with a warning.

## 5 & 6. Scriptwriter and Retention Engine — `scriptwriter.ts`

One module, because the rewrite loop is the point. A retention score below 72
triggers a targeted rewrite with the specific weak sections and suggested fixes
fed back, up to twice.

Script quality is measured mechanically (see [SCORING.md](SCORING.md)).

**Refuses:** claim keys that do not resolve are stripped before storage.

**Where it goes wrong:** the rewrite loop can burn two extra full-length
generations, which is the single largest line item in the cost breakdown. If
scripts are consistently rewriting, the story brief is the thing to fix.

## 7. Fact Checker — `fact-checker.ts`

Two passes that catch different failures.

**Mechanical:** regex extraction finds every figure, date, quotation and
superlative, then checks the citing section has supporting claims. A model can
overlook a number; a regex cannot.

**Model:** reads claims and script and judges whether each assertion is
supported *as written* — where paraphrase drift and unsupported causation get
caught.

The stricter verdict wins. A HIGH-risk finding fails outright.

Two specific rules worth knowing:

- A DISPUTED claim presented without contest framing is HIGH risk. Presenting
  a contested figure as settled is how a channel earns a correction.
- A quoted span is only treated as attributed speech when an attribution cue is
  nearby. Flagging every quoted phrase produced five false HIGH findings on one
  script from scare quotes and section titles — and a checker that cries wolf
  is one operators learn to ignore.

## 8. Visual Director — `visual-director.ts`

Turns the script into a shot plan.

**Refuses:** a chart whose `sourceClaimKey` does not resolve to a stored
quantitative or financial claim is dropped and the scene falls back to a text
card. This is the guard against fabricated data reaching a frame — a model
asked for "a chart of their revenue" will invent a plausible series.

**Enforces pacing:** scenes over 12 seconds are split on sentence boundaries.
Chart scenes are never split; the chart is the shot.

## 9. Packaging — `packaging.ts`

Titles, thumbnails, description, Shorts.

**Refuses:** titles flagged `overclaims`, and titles over 100 characters.
Chapters and references are **overwritten** with values computed from real scene
offsets and stored sources — the model writes prose, it does not invent
timestamps or citations.

Nothing is pre-selected. A human picks the title and thumbnail; the ranking is a
suggestion.

## 10. Quality Control — `qc.ts`

The last check before a human.

Composite score plus four independent gates. **Any FAIL blocks regardless of the
score.** Copyright is assessed from the asset registry, not from a model
opinion. Visual quality is mostly mechanical: shot rate, chart presence,
placeholder count.

Unresolved DUPLICATE flags block; CANNIBALIZES flags warn, because two videos
competing for one search intent is sometimes the right editorial call.

---

## Content Genome — `genome.ts`

Not a pipeline stage. Extracts entities and relationships from published work
into a graph, then proposes follow-ups by following an edge the published video
did not explore.

Edge strength **decays** on every rebuild and is reinforced only when
re-observed, so a relationship asserted once in 2024 stops driving suggestions
forever.

Only records what the text asserts — not general knowledge. The graph is a
record of what this channel has said.

import { z } from 'zod';

/**
 * Cross-package contracts. Every LLM call that returns structure validates
 * against one of these schemas, so a model that drifts fails a Zod parse
 * instead of writing malformed rows into Postgres.
 */

// ── Pipeline stages (spec §25 production queue) ───────────────────────────
export const PIPELINE_STAGES = [
  'RESEARCH',
  'STORY',
  'SCRIPT',
  'FACT_CHECK',
  'VISUALS',
  'VOICE',
  'RENDER',
  'PACKAGING',
  'QC',
  'APPROVAL',
  'SCHEDULED',
  'PUBLISHED',
] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

/** The order production actually runs in; used for resume-from-stage. */
export const STAGE_ORDER: readonly PipelineStage[] = PIPELINE_STAGES;

export function stageIndex(s: PipelineStage): number {
  return STAGE_ORDER.indexOf(s);
}

export function isStageBefore(a: PipelineStage, b: PipelineStage): boolean {
  return stageIndex(a) < stageIndex(b);
}

// ── Research ──────────────────────────────────────────────────────────────
export const SourceTierSchema = z.enum([
  'PRIMARY_COMPANY',   // 10-K, investor deck, official newsroom
  'REGULATORY_FILING', // SEC, EU filings
  'GOVERNMENT',        // BLS, Eurostat, central banks
  'FINANCIAL_REPORT',  // earnings transcripts, analyst filings
  'ACADEMIC',
  'REPUTABLE_JOURNALISM',
  'INDUSTRY_RESEARCH',
  'SPECIALIST_PUBLICATION',
  'OTHER',
]);
export type SourceTier = z.infer<typeof SourceTierSchema>;

/**
 * Reliability priors by tier (spec §8 ordering). A claim's confidence is
 * capped by its best source's tier — an analyst blog cannot make a revenue
 * figure HIGH confidence on its own.
 */
export const SOURCE_TIER_WEIGHT: Record<SourceTier, number> = {
  PRIMARY_COMPANY: 95,
  REGULATORY_FILING: 98,
  GOVERNMENT: 95,
  FINANCIAL_REPORT: 88,
  ACADEMIC: 85,
  REPUTABLE_JOURNALISM: 72,
  INDUSTRY_RESEARCH: 68,
  SPECIALIST_PUBLICATION: 60,
  OTHER: 35,
};

export const SourceSchema = z.object({
  url: z.string().url(),
  title: z.string().min(1),
  publisher: z.string().min(1),
  tier: SourceTierSchema,
  publishedAt: z.string().nullable().optional(),
  retrievedAt: z.string(),
  excerpt: z.string().min(1).max(4000),
  reliability: z.number().min(0).max(100),
});
export type Source = z.infer<typeof SourceSchema>;

export const ClaimStatusSchema = z.enum(['UNVERIFIED', 'VERIFIED', 'DISPUTED', 'REJECTED']);
export type ClaimStatus = z.infer<typeof ClaimStatusSchema>;

export const ClaimConfidenceSchema = z.enum(['LOW', 'MEDIUM', 'HIGH']);
export type ClaimConfidence = z.infer<typeof ClaimConfidenceSchema>;

export const ClaimSchema = z.object({
  key: z.string().min(1),
  text: z.string().min(1),
  /** Indices into the research project's source list. Never invented. */
  sourceUrls: z.array(z.string().url()).min(1),
  confidence: ClaimConfidenceSchema,
  status: ClaimStatusSchema,
  kind: z.enum(['FINANCIAL', 'HISTORICAL', 'QUANTITATIVE', 'CAUSAL', 'QUOTE', 'DESCRIPTIVE']),
  asOf: z.string().nullable().optional(),
  notes: z.string().optional(),
});
export type Claim = z.infer<typeof ClaimSchema>;

// ── Story brief (spec §10) ────────────────────────────────────────────────
export const StoryBriefSchema = z.object({
  centralQuestion: z.string().min(10),
  thesis: z.string().min(10),
  targetViewer: z.string().min(5),
  whyCare: z.string().min(10),
  hook: z.string().min(10),
  conflict: z.string().min(10),
  stakes: z.string().min(10),
  /** Section names are chosen per story; a fixed template is a spec violation. */
  narrativeArc: z.array(z.object({ section: z.string().min(2), purpose: z.string().min(5) })).min(4),
  keyRevelations: z.array(z.string().min(5)).min(2),
  supportingClaimKeys: z.array(z.string()),
  ending: z.string().min(10),
  cta: z.string().min(3),
});
export type StoryBrief = z.infer<typeof StoryBriefSchema>;

// ── Script ────────────────────────────────────────────────────────────────
export const ScriptSectionSchema = z.object({
  id: z.string().min(1),
  heading: z.string().min(1),
  narration: z.string().min(1),
  /** Claim keys this section depends on; empty means no factual assertions. */
  claimKeys: z.array(z.string()).default([]),
  /** A question this section opens or closes — used by the retention pass. */
  openLoop: z.string().nullable().default(null),
});
export type ScriptSection = z.infer<typeof ScriptSectionSchema>;

export const ScriptSchema = z.object({
  workingTitle: z.string().min(3),
  sections: z.array(ScriptSectionSchema).min(3),
});
export type Script = z.infer<typeof ScriptSchema>;

// ── Retention analysis (spec §12) ─────────────────────────────────────────
export const RetentionAnalysisSchema = z.object({
  hookStrength: z.number().min(0).max(100),
  first30Seconds: z.number().min(0).max(100),
  curiosityGaps: z.number().min(0).max(100),
  pacing: z.number().min(0).max(100),
  informationDensity: z.number().min(0).max(100),
  patternInterrupts: z.number().min(0).max(100),
  narrativeTension: z.number().min(0).max(100),
  payoffFrequency: z.number().min(0).max(100),
  overall: z.number().min(0).max(100),
  weakestSections: z.array(z.object({ sectionId: z.string(), problem: z.string(), fix: z.string() })),
  cutCandidates: z.array(z.object({ sectionId: z.string(), reason: z.string() })),
});
export type RetentionAnalysis = z.infer<typeof RetentionAnalysisSchema>;

// ── Storyboard (spec §14) ─────────────────────────────────────────────────
export const VisualKindSchema = z.enum([
  'STOCK_VIDEO',
  'STOCK_IMAGE',
  'GENERATED_IMAGE',
  'CHART',
  'SCREENSHOT',
  'TEXT_CARD',
  'MAP',
  'ARCHIVAL',
  'B_ROLL',
]);
export type VisualKind = z.infer<typeof VisualKindSchema>;

export const ChartSpecSchema = z.object({
  type: z.enum(['bar', 'line', 'stacked-bar', 'area', 'donut']),
  title: z.string().min(1),
  subtitle: z.string().optional(),
  /** Units label, e.g. "USD billions". Charts without units are misleading. */
  unit: z.string().min(1),
  series: z
    .array(
      z.object({
        name: z.string().min(1),
        points: z.array(z.object({ label: z.string(), value: z.number().finite() })).min(2),
      }),
    )
    .min(1),
  /** Non-negotiable: every chart traces to a claim, which traces to a source. */
  sourceClaimKey: z.string().min(1),
  sourceNote: z.string().min(1),
});
export type ChartSpec = z.infer<typeof ChartSpecSchema>;

export const SceneSchema = z.object({
  id: z.string().min(1),
  sectionId: z.string().min(1),
  index: z.number().int().min(0),
  narration: z.string().min(1),
  visualKind: VisualKindSchema,
  /** Search terms for stock providers, or a prompt for generated imagery. */
  visualQuery: z.string().min(1),
  onScreenText: z.string().nullable().default(null),
  chart: ChartSpecSchema.nullable().default(null),
  /** Filled in after TTS; planning uses the word-rate estimate. */
  estimatedSeconds: z.number().positive(),
});
export type Scene = z.infer<typeof SceneSchema>;

export const StoryboardSchema = z.object({ scenes: z.array(SceneSchema).min(1) });
export type Storyboard = z.infer<typeof StoryboardSchema>;

// ── Packaging (spec §21–23) ───────────────────────────────────────────────
export const TitleCandidateSchema = z.object({
  text: z.string().min(5).max(100),
  curiosity: z.number().min(0).max(100),
  clarity: z.number().min(0).max(100),
  searchIntent: z.number().min(0).max(100),
  emotionalImpact: z.number().min(0).max(100),
  uniqueness: z.number().min(0).max(100),
  credibility: z.number().min(0).max(100),
  /** Must be false for any title that ships. */
  overclaims: z.boolean(),
  rationale: z.string().min(5),
});
export type TitleCandidate = z.infer<typeof TitleCandidateSchema>;

export const ThumbnailConceptSchema = z.object({
  concept: z.string().min(5),
  headline: z.string().max(30),
  visualDirection: z.string().min(5),
  emotionalHook: z.string().min(3),
  /** Rubric score, NOT a CTR prediction. See docs/SCORING.md. */
  rubricScore: z.number().min(0).max(100),
  mobileLegible: z.boolean(),
  misleadingRisk: z.enum(['NONE', 'LOW', 'MEDIUM', 'HIGH']),
});
export type ThumbnailConcept = z.infer<typeof ThumbnailConceptSchema>;

export const DescriptionSchema = z.object({
  body: z.string().min(50),
  chapters: z.array(z.object({ seconds: z.number().min(0), label: z.string().min(1) })).min(3),
  tags: z.array(z.string().min(2)).max(30),
  references: z.array(z.object({ label: z.string(), url: z.string().url() })),
  disclosure: z.string().nullable(),
});
export type VideoDescription = z.infer<typeof DescriptionSchema>;

// ── Shorts (spec §35) ─────────────────────────────────────────────────────
export const ShortSchema = z.object({
  hook: z.string().min(5),
  narration: z.string().min(20),
  sourceSectionId: z.string(),
  startSeconds: z.number().min(0),
  endSeconds: z.number().min(0),
  onScreenText: z.array(z.string()),
  ctaToLongForm: z.string().min(3),
});
export type Short = z.infer<typeof ShortSchema>;

// ── Fact check (spec §13) ─────────────────────────────────────────────────
export const FactCheckFindingSchema = z.object({
  assertion: z.string().min(1),
  sectionId: z.string(),
  risk: z.enum(['LOW', 'MEDIUM', 'HIGH']),
  supportingClaimKey: z.string().nullable(),
  issue: z.string(),
  suggestedFix: z.string().nullable(),
});
export type FactCheckFinding = z.infer<typeof FactCheckFindingSchema>;

export const FactCheckReportSchema = z.object({
  verdict: z.enum(['PASS', 'FAIL']),
  findings: z.array(FactCheckFindingSchema),
  unsupportedAssertions: z.number().int().min(0),
  highRiskCount: z.number().int().min(0),
});
export type FactCheckReport = z.infer<typeof FactCheckReportSchema>;

// ── Cost ledger (spec §38) ────────────────────────────────────────────────
export const CostCategorySchema = z.enum(['LLM', 'SEARCH', 'TTS', 'IMAGE', 'STOCK', 'RENDER', 'STORAGE']);
export type CostCategory = z.infer<typeof CostCategorySchema>;

export interface CostEntry {
  category: CostCategory;
  provider: string;
  stage: PipelineStage | 'DISCOVERY';
  usd: number;
  units: number;
  unitLabel: string;
  detail?: Record<string, unknown>;
}

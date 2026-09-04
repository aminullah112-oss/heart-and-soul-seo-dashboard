import type { PipelineStage } from '@yme/shared';

/**
 * The task registry. Every LLM call names its task, which drives model tier
 * selection, cost attribution, and — in MOCK_MODE — which fixture responds.
 * Adding a call site without adding a task here is a type error, which is the
 * point: untracked LLM spend is how these systems become unaffordable.
 */
export const LLM_TASKS = [
  'discover-topics',
  'score-topic',
  'plan-research',
  'assess-source',
  'extract-claims',
  'story-brief',
  'write-script',
  'revise-script',
  'analyze-retention',
  'fact-check',
  'storyboard',
  'generate-titles',
  'generate-thumbnails',
  'generate-description',
  'generate-shorts',
  'qc-review',
  'extract-entities',
  'suggest-followups',
  'learning-report',
  'sponsor-fit',
] as const;

export type LlmTask = (typeof LLM_TASKS)[number];

/**
 * Model tiers, not model names. Call sites ask for "reasoning" or "cheap" and
 * the operator maps tiers to models in .env, so switching model generations is
 * a config change rather than a code change.
 */
export type ModelTier = 'reasoning' | 'drafting' | 'cheap';

/** Which tier each task runs on by default. */
export const TASK_TIER: Record<LlmTask, ModelTier> = {
  'discover-topics': 'drafting',
  'score-topic': 'drafting',
  'plan-research': 'cheap',
  'assess-source': 'cheap',
  'extract-claims': 'drafting',
  'story-brief': 'reasoning',
  'write-script': 'reasoning',
  'revise-script': 'reasoning',
  'analyze-retention': 'drafting',
  // Fact checking runs on the strongest model available. It is the one place
  // where saving a few cents costs credibility.
  'fact-check': 'reasoning',
  storyboard: 'drafting',
  'generate-titles': 'drafting',
  'generate-thumbnails': 'drafting',
  'generate-description': 'cheap',
  'generate-shorts': 'drafting',
  'qc-review': 'reasoning',
  'extract-entities': 'cheap',
  'suggest-followups': 'cheap',
  'learning-report': 'reasoning',
  'sponsor-fit': 'cheap',
};

export interface LlmMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface LlmRequest {
  task: LlmTask;
  system: string;
  messages: LlmMessage[];
  model: string;
  maxTokens: number;
  temperature: number;
  stopSequences?: string[];
  /** Forces the model to open its reply with this text. */
  prefill?: string;
  /**
   * Structured context for the MOCK provider only. Real providers ignore it
   * entirely — it exists so mock output can stay coherent across pipeline
   * stages (the same company, the same claim keys) without smuggling
   * mock-shaped markers into production prompts.
   */
  mockContext?: Record<string, unknown>;
}

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
}

export interface LlmResponse {
  text: string;
  model: string;
  usage: LlmUsage;
  stopReason: string | null;
}

export interface LlmProvider {
  readonly name: string;
  complete(req: LlmRequest): Promise<LlmResponse>;
}

export interface GenerationContext {
  videoProjectId?: string | null;
  stage: PipelineStage | 'DISCOVERY';
}

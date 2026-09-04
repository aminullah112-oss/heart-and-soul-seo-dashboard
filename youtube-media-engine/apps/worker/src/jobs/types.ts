import type { ProductionStage } from '@yme/pipeline';

export interface StageJobData {
  videoProjectId: string;
  stage: ProductionStage;
  /** When true, advance to the next stage automatically on success. */
  chain: boolean;
}

export interface PublishJobData {
  publishingJobId: string;
}

export interface DiscoveryJobData {
  channelId: string;
  limit?: number;
}

export interface AnalyticsJobData {
  channelId: string;
}

export interface LearningJobData {
  channelId: string;
  periodDays?: number;
}

export type JobName =
  | 'stage'
  | 'publish'
  | 'discover'
  | 'score'
  | 'ingest-analytics'
  | 'learning-report'
  | 'publish-due';

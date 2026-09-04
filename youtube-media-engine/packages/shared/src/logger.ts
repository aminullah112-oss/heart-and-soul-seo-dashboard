import pino from 'pino';
import { env } from '@yme/config';

/**
 * Structured logging (spec §43). Every job-scoped log carries jobId, videoId,
 * stage, and attempt so a failed render can be traced without grepping.
 */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: undefined,
  redact: {
    paths: [
      'apiKey',
      '*.apiKey',
      'headers.authorization',
      'headers["x-api-key"]',
      '*.ANTHROPIC_API_KEY',
      '*.TTS_API_KEY',
      '*.STORAGE_SECRET_KEY',
      '*.YOUTUBE_CLIENT_SECRET',
      '*.YOUTUBE_REFRESH_TOKEN',
    ],
    censor: '[redacted]',
  },
  transport:
    process.env.NODE_ENV === 'production'
      ? undefined
      : { target: 'pino/file', options: { destination: 2 } },
});

export interface JobLogContext {
  jobId?: string;
  videoId?: string;
  topicId?: string;
  stage?: string;
  attempt?: number;
}

export function jobLogger(ctx: JobLogContext) {
  return logger.child(ctx);
}

export type Logger = typeof logger;

/** Silences the logger for tests without changing call sites. */
export function isMock(): boolean {
  return env.MOCK_MODE;
}

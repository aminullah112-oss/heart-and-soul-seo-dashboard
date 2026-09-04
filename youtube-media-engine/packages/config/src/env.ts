import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';
import path from 'node:path';
import fs from 'node:fs';

/**
 * Env is validated once, at process start, and never read raw anywhere else.
 * A missing key fails here with a readable message instead of surfacing as
 * `undefined` three layers deep inside a provider call.
 */

function findRepoRoot(from: string): string {
  let dir = from;
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return from;
}

const bool = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : v.toLowerCase() === 'true' || v === '1'));

const num = (def: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : Number(v)))
    .pipe(z.number().finite());

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  MOCK_MODE: bool(true),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),

  AUTH_SECRET: z.string().default(''),
  BOOTSTRAP_EMAIL: z.string().email().default('owner@example.com'),
  BOOTSTRAP_PASSWORD: z.string().default(''),

  LLM_PROVIDER: z.enum(['mock', 'anthropic']).default('mock'),
  ANTHROPIC_API_KEY: z.string().default(''),
  LLM_MODEL_REASONING: z.string().default('claude-opus-5'),
  LLM_MODEL_DRAFTING: z.string().default('claude-sonnet-5'),
  LLM_MODEL_CHEAP: z.string().default('claude-haiku-4-5-20251001'),
  LLM_MAX_COST_PER_VIDEO_USD: num(8),

  SEARCH_PROVIDER: z.enum(['mock', 'brave', 'tavily']).default('mock'),
  BRAVE_SEARCH_API_KEY: z.string().default(''),
  TAVILY_API_KEY: z.string().default(''),

  TTS_PROVIDER: z.enum(['mock', 'elevenlabs', 'openai']).default('mock'),
  TTS_API_KEY: z.string().default(''),
  TTS_VOICE_ID: z.string().default(''),
  TTS_MODEL: z.string().default(''),
  TTS_SPEED: num(1),

  IMAGE_PROVIDER: z.enum(['mock', 'openai']).default('mock'),
  IMAGE_API_KEY: z.string().default(''),
  STOCK_PROVIDER: z.enum(['mock', 'pexels']).default('mock'),
  STOCK_VIDEO_API_KEY: z.string().default(''),

  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_LOCAL_PATH: z.string().default('./storage'),
  STORAGE_ENDPOINT: z.string().default(''),
  STORAGE_REGION: z.string().default('auto'),
  STORAGE_BUCKET: z.string().default(''),
  STORAGE_ACCESS_KEY: z.string().default(''),
  STORAGE_SECRET_KEY: z.string().default(''),

  YOUTUBE_PROVIDER: z.enum(['mock', 'google']).default('mock'),
  YOUTUBE_CLIENT_ID: z.string().default(''),
  YOUTUBE_CLIENT_SECRET: z.string().default(''),
  YOUTUBE_REFRESH_TOKEN: z.string().default(''),
  YOUTUBE_CHANNEL_ID: z.string().default(''),

  FFMPEG_PATH: z.string().default('ffmpeg'),
  FFPROBE_PATH: z.string().default('ffprobe'),
  RENDER_RESOLUTION: z.enum(['1080p', '4k']).default('1080p'),
  RENDER_FPS: num(30),
  RENDER_PRESET: z.string().default('medium'),

  MINIMUM_TOPIC_SCORE: num(75),
  MINIMUM_QC_SCORE: num(85),
  AUTOMATIC_PUBLISH: bool(false),
  HUMAN_APPROVAL: bool(true),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function loadEnv(opts: { reload?: boolean } = {}): Env {
  if (cached && !opts.reload) return cached;

  const root = findRepoRoot(process.cwd());
  loadDotenv({ path: path.join(root, '.env'), override: false });

  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}\n\nSee .env.example.`);
  }

  const e = parsed.data;

  // Cross-field rules. These exist because "it silently used the mock" is a
  // worse failure than "it refused to start".
  const problems: string[] = [];
  if (!e.MOCK_MODE) {
    if (e.LLM_PROVIDER === 'anthropic' && !e.ANTHROPIC_API_KEY)
      problems.push('LLM_PROVIDER=anthropic requires ANTHROPIC_API_KEY');
    if (e.SEARCH_PROVIDER === 'brave' && !e.BRAVE_SEARCH_API_KEY)
      problems.push('SEARCH_PROVIDER=brave requires BRAVE_SEARCH_API_KEY');
    if (e.SEARCH_PROVIDER === 'tavily' && !e.TAVILY_API_KEY)
      problems.push('SEARCH_PROVIDER=tavily requires TAVILY_API_KEY');
    if (e.TTS_PROVIDER !== 'mock' && !e.TTS_API_KEY)
      problems.push(`TTS_PROVIDER=${e.TTS_PROVIDER} requires TTS_API_KEY`);
    if (e.STOCK_PROVIDER === 'pexels' && !e.STOCK_VIDEO_API_KEY)
      problems.push('STOCK_PROVIDER=pexels requires STOCK_VIDEO_API_KEY');
    if (e.YOUTUBE_PROVIDER === 'google') {
      for (const k of ['YOUTUBE_CLIENT_ID', 'YOUTUBE_CLIENT_SECRET', 'YOUTUBE_REFRESH_TOKEN'] as const) {
        if (!e[k]) problems.push(`YOUTUBE_PROVIDER=google requires ${k}`);
      }
    }
    if (e.STORAGE_DRIVER === 's3') {
      for (const k of ['STORAGE_BUCKET', 'STORAGE_ACCESS_KEY', 'STORAGE_SECRET_KEY'] as const) {
        if (!e[k]) problems.push(`STORAGE_DRIVER=s3 requires ${k}`);
      }
    }
  }
  if (e.NODE_ENV === 'production' && e.AUTH_SECRET.length < 32)
    problems.push('AUTH_SECRET must be >= 32 chars in production (openssl rand -base64 32)');
  if (e.AUTOMATIC_PUBLISH && e.HUMAN_APPROVAL)
    problems.push('AUTOMATIC_PUBLISH=true is incompatible with HUMAN_APPROVAL=true');

  if (problems.length) {
    throw new Error(`Invalid environment configuration:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  }

  cached = e;
  return e;
}

/** Lazy accessor so importing this module never throws at import time. */
export const env = new Proxy({} as Env, {
  get(_t, prop: string) {
    return loadEnv()[prop as keyof Env];
  },
});

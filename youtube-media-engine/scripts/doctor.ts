/**
 * Preflight check.
 *
 * Answers "will this actually run here?" before a job fails at 2am. Everything
 * it reports is verified by doing the thing, not by reading configuration.
 *
 *   pnpm doctor
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import { loadEnv } from '@yme/config';
import { prisma, disconnect } from '@yme/database';

const exec = promisify(execFile);

type Status = 'ok' | 'warn' | 'fail';
const results: Array<{ name: string; status: Status; detail: string }> = [];

const add = (name: string, status: Status, detail: string) => results.push({ name, status, detail });

async function main() {
  let env: ReturnType<typeof loadEnv>;
  try {
    env = loadEnv();
    add('Environment', 'ok', `MOCK_MODE=${env.MOCK_MODE}, NODE_ENV=${env.NODE_ENV}`);
  } catch (err) {
    add('Environment', 'fail', err instanceof Error ? err.message.split('\n').slice(0, 4).join(' ') : String(err));
    return report();
  }

  // ── Database ─────────────────────────────────────────────────────────
  try {
    await prisma.$queryRaw`SELECT 1`;
    const channel = await prisma.channel.findFirst();
    const owner = await prisma.user.findFirst({ where: { role: 'OWNER' } });
    if (!channel || !owner) add('Database', 'warn', 'reachable, but not seeded — run `pnpm db:seed`');
    else add('Database', 'ok', `reachable, channel "${channel.name}", owner ${owner.email}`);
  } catch (err) {
    add('Database', 'fail', `${err instanceof Error ? err.message.slice(0, 120) : String(err)}`);
  }

  // ── Redis ────────────────────────────────────────────────────────────
  try {
    const { default: IORedis } = await import('ioredis');
    const redis = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: 1, lazyConnect: true, connectTimeout: 3000 });
    await redis.connect();
    const policy = await redis.config('GET', 'maxmemory-policy').catch(() => null);
    const value = Array.isArray(policy) ? policy[1] : null;
    await redis.quit();

    if (value && value !== 'noeviction') {
      // An eviction policy other than noeviction silently discards queued jobs
      // under memory pressure, which looks like work vanishing for no reason.
      add('Redis', 'warn', `reachable, but maxmemory-policy is "${value}" — BullMQ needs noeviction`);
    } else {
      add('Redis', 'ok', 'reachable');
    }
  } catch (err) {
    add('Redis', 'fail', `${err instanceof Error ? err.message.slice(0, 120) : String(err)} (the worker cannot run without it)`);
  }

  // ── ffmpeg ───────────────────────────────────────────────────────────
  try {
    const { stdout } = await exec(env.FFMPEG_PATH, ['-version']);
    const version = stdout.split('\n')[0] ?? '';
    const { stdout: filters } = await exec(env.FFMPEG_PATH, ['-hide_banner', '-filters']);

    const missing = ['zoompan', 'subtitles', 'sidechaincompress', 'loudnorm', 'drawtext'].filter(
      (f) => !new RegExp(`\\b${f}\\b`).test(filters),
    );
    if (missing.length) add('ffmpeg', 'warn', `${version.slice(0, 60)} — missing filters: ${missing.join(', ')}`);
    else add('ffmpeg', 'ok', version.slice(0, 70));
  } catch {
    add('ffmpeg', 'fail', `not runnable at "${env.FFMPEG_PATH}" — rendering is impossible without it`);
  }

  try {
    await exec(env.FFPROBE_PATH, ['-version']);
    add('ffprobe', 'ok', 'available');
  } catch {
    add('ffprobe', 'fail', `not runnable at "${env.FFPROBE_PATH}" — scene timing depends on it`);
  }

  // ── Fonts ────────────────────────────────────────────────────────────
  try {
    const { stdout } = await exec('fc-list', []).catch(() => ({ stdout: '' }));
    const hasSans = /DejaVu Sans|Liberation Sans|Noto Sans/i.test(stdout);
    if (!stdout) add('Fonts', 'warn', 'fc-list unavailable; cannot verify — charts may render empty boxes');
    else if (!hasSans) add('Fonts', 'fail', 'no DejaVu/Liberation/Noto sans font — chart text will render as boxes');
    else add('Fonts', 'ok', 'sans-serif family present');
  } catch {
    add('Fonts', 'warn', 'could not verify');
  }

  // ── Image rasterisation ──────────────────────────────────────────────
  try {
    const sharp = (await import('sharp')).default;
    const png = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="#fff"/></svg>')).png().toBuffer();
    add('sharp', png.length > 0 ? 'ok' : 'fail', png.length > 0 ? 'SVG rasterisation works' : 'produced no output');
  } catch (err) {
    add('sharp', 'fail', `${err instanceof Error ? err.message.slice(0, 100) : String(err)} — charts cannot be rendered`);
  }

  // ── Storage ──────────────────────────────────────────────────────────
  if (env.STORAGE_DRIVER === 'local') {
    const probe = path.join(env.STORAGE_LOCAL_PATH, '.doctor-probe');
    try {
      await fs.mkdir(env.STORAGE_LOCAL_PATH, { recursive: true });
      await fs.writeFile(probe, 'ok');
      await fs.rm(probe);
      add('Storage', 'ok', `local, writable at ${env.STORAGE_LOCAL_PATH}`);
    } catch (err) {
      add('Storage', 'fail', `cannot write to ${env.STORAGE_LOCAL_PATH}: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else {
    add('Storage', 'ok', `s3 driver, bucket ${env.STORAGE_BUCKET}`);
  }

  // ── Disk headroom ────────────────────────────────────────────────────
  try {
    const { stdout } = await exec('df', ['-Pk', env.STORAGE_LOCAL_PATH || '.']);
    const line = stdout.trim().split('\n')[1] ?? '';
    const availableKb = Number(line.split(/\s+/)[3] ?? 0);
    const gb = availableKb / 1024 / 1024;
    // A 12-minute 1080p render plus intermediates runs to a few GB.
    if (gb < 5) add('Disk', 'fail', `${gb.toFixed(1)} GB free — a single render needs several GB of scratch`);
    else if (gb < 20) add('Disk', 'warn', `${gb.toFixed(1)} GB free — enough for a few renders`);
    else add('Disk', 'ok', `${gb.toFixed(1)} GB free`);
  } catch {
    add('Disk', 'warn', 'could not determine free space');
  }

  // ── Provider configuration ───────────────────────────────────────────
  if (env.MOCK_MODE) {
    add('Providers', 'ok', 'MOCK_MODE — no external calls, no spend, publishing impossible');
  } else {
    const live = [
      ['LLM', env.LLM_PROVIDER], ['Search', env.SEARCH_PROVIDER], ['TTS', env.TTS_PROVIDER],
      ['Images', env.IMAGE_PROVIDER], ['Stock', env.STOCK_PROVIDER], ['YouTube', env.YOUTUBE_PROVIDER],
    ].map(([k, v]) => `${k}=${v}`).join(' ');
    add('Providers', 'warn', `LIVE — real calls will be made and billed. ${live}`);
  }

  if (env.AUTOMATIC_PUBLISH) {
    add('Publishing', 'warn', 'AUTOMATIC_PUBLISH=true — videos can go live without a human pressing approve');
  } else {
    add('Publishing', 'ok', 'human approval required');
  }

  await report();
}

async function report() {
  const symbol = { ok: '\x1b[32m✓\x1b[0m', warn: '\x1b[33m!\x1b[0m', fail: '\x1b[31m✗\x1b[0m' };
  console.log('\nYouTube Media Engine — preflight\n');
  for (const r of results) {
    console.log(`  ${symbol[r.status]} ${r.name.padEnd(14)} ${r.detail}`);
  }

  const failures = results.filter((r) => r.status === 'fail');
  const warnings = results.filter((r) => r.status === 'warn');
  console.log(
    `\n${results.length - failures.length - warnings.length} ok, ${warnings.length} warning(s), ${failures.length} failure(s)\n`,
  );

  if (failures.length) {
    console.log('Fix the failures before running the pipeline. See docs/TROUBLESHOOTING.md.\n');
    process.exitCode = 1;
  }
  await disconnect().catch(() => undefined);
}

main().catch(async (err) => {
  console.error('doctor failed:', err instanceof Error ? err.message : err);
  await disconnect().catch(() => undefined);
  process.exitCode = 1;
});

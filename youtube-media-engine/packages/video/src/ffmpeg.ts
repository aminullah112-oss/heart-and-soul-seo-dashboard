import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { env } from '@yme/config';
import { renderError, EngineError } from '@yme/shared';

const exec = promisify(execFile);

export interface FfmpegRunResult {
  command: string;
  stderrTail: string;
  durationMs: number;
}

/**
 * Runs ffmpeg and, on failure, surfaces the last lines of stderr.
 *
 * ffmpeg writes everything to stderr including normal progress, so the exit
 * code is the only reliable success signal — and the real reason for a failure
 * is almost always in the final few lines. Returning the whole log would put
 * megabytes into a database column.
 */
export async function runFfmpeg(args: string[], opts: { timeoutMs?: number; label?: string } = {}): Promise<FfmpegRunResult> {
  const started = Date.now();
  const full = ['-hide_banner', '-loglevel', 'warning', '-nostdin', '-y', ...args];
  const command = `${env.FFMPEG_PATH} ${full.map(quoteForLog).join(' ')}`;

  try {
    const { stderr } = await exec(env.FFMPEG_PATH, full, {
      timeout: opts.timeoutMs ?? 30 * 60_000,
      maxBuffer: 32 * 1024 * 1024,
    });
    return { command, stderrTail: tail(stderr), durationMs: Date.now() - started };
  } catch (err) {
    const e = err as { stderr?: string; killed?: boolean; code?: number };
    if (e.killed) {
      throw new EngineError('TIMEOUT', `ffmpeg timed out${opts.label ? ` during ${opts.label}` : ''}`, {
        retryable: true,
        details: { command },
      });
    }
    throw renderError(
      `ffmpeg failed${opts.label ? ` during ${opts.label}` : ''} (exit ${e.code ?? '?'}):\n${tail(e.stderr ?? '')}`,
      { cause: err, details: { command } },
    );
  }
}

/** Media duration in seconds. The measured number, not an estimate. */
export async function probeDuration(filePath: string): Promise<number> {
  try {
    const { stdout } = await exec(env.FFPROBE_PATH, [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      filePath,
    ]);
    const seconds = Number.parseFloat(stdout.trim());
    if (!Number.isFinite(seconds)) throw new Error(`ffprobe returned "${stdout.trim()}"`);
    return seconds;
  } catch (err) {
    throw renderError(`Could not probe duration of ${filePath}`, { cause: err });
  }
}

export interface MediaInfo {
  durationSeconds: number;
  width: number | null;
  height: number | null;
  hasAudio: boolean;
  hasVideo: boolean;
}

export async function probeMedia(filePath: string): Promise<MediaInfo> {
  try {
    const { stdout } = await exec(env.FFPROBE_PATH, [
      '-v', 'error',
      '-show_entries', 'format=duration:stream=codec_type,width,height',
      '-of', 'json',
      filePath,
    ]);
    const parsed = JSON.parse(stdout) as {
      format?: { duration?: string };
      streams?: Array<{ codec_type?: string; width?: number; height?: number }>;
    };
    const streams = parsed.streams ?? [];
    const video = streams.find((s) => s.codec_type === 'video');
    return {
      durationSeconds: Number.parseFloat(parsed.format?.duration ?? '0') || 0,
      width: video?.width ?? null,
      height: video?.height ?? null,
      hasAudio: streams.some((s) => s.codec_type === 'audio'),
      hasVideo: Boolean(video),
    };
  } catch (err) {
    throw renderError(`Could not probe ${filePath}`, { cause: err });
  }
}

export async function assertFfmpegAvailable(): Promise<{ ffmpeg: string; hasLibass: boolean }> {
  try {
    const { stdout } = await exec(env.FFMPEG_PATH, ['-version']);
    const version = stdout.split('\n')[0] ?? 'unknown';
    const { stdout: filters } = await exec(env.FFMPEG_PATH, ['-hide_banner', '-filters']);
    const hasLibass = /\bsubtitles\b/.test(filters) && /\bass\b/.test(filters);
    return { ffmpeg: version, hasLibass };
  } catch (err) {
    throw new EngineError(
      'CONFIG',
      `ffmpeg is not runnable at "${env.FFMPEG_PATH}". Install it or set FFMPEG_PATH.`,
      { retryable: false, cause: err },
    );
  }
}

function tail(s: string, lines = 24): string {
  return s.split('\n').filter(Boolean).slice(-lines).join('\n');
}

/** Shell-quoted only for the stored command string; execFile does not use a shell. */
function quoteForLog(arg: string): string {
  return /[\s"'$`\\|&;<>()*?\[\]]/.test(arg) ? `'${arg.replace(/'/g, `'\\''`)}'` : arg;
}

/**
 * Escapes a path for use INSIDE an ffmpeg filtergraph value (e.g. the
 * subtitles filter). Filtergraph parsing treats `:`, `'` and `\` specially,
 * and a Windows drive letter or an apostrophe in a folder name breaks it in a
 * way the error message does not explain.
 */
export function escapeFilterPath(p: string): string {
  return p.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'").replace(/\[/g, '\\[').replace(/\]/g, '\\]');
}

import fs from 'node:fs/promises';
import path from 'node:path';
import { renderError } from '@yme/shared';
import { runFfmpeg, escapeFilterPath, probeDuration } from './ffmpeg.js';
import { SHORT_RESOLUTION } from './theme.js';

/**
 * Vertical Shorts render (spec §35).
 *
 * The source is the finished long-form master, reframed rather than
 * re-rendered from scenes. That keeps the Short visually identical to the
 * video it advertises, which is the point of the format as a funnel.
 *
 * Reframing is a centre crop with the 16:9 content scaled to fill the top
 * portion, not a naive crop: cropping 1920x1080 to 1080x1920 discards 69% of
 * the frame width and cuts charts in half. Instead the full frame sits in the
 * upper region over a blurred fill, leaving the lower third for captions —
 * the layout every successful explainer Short uses.
 */

export interface ShortRenderOptions {
  sourceVideoPath: string;
  startSeconds: number;
  endSeconds: number;
  outputPath: string;
  workDir: string;
  /** ASS captions, burned in. Shorts are watched sound-off; this is expected. */
  captionsPath?: string | null;
  fps?: number;
  preset?: string;
}

export interface ShortRenderResult {
  outputPath: string;
  durationSeconds: number;
  bytes: number;
  command: string;
}

export const MAX_SHORT_SECONDS = 59;

export async function renderShort(opts: ShortRenderOptions): Promise<ShortRenderResult> {
  const duration = opts.endSeconds - opts.startSeconds;
  if (duration <= 0) throw renderError('Short has a non-positive duration');
  if (duration > MAX_SHORT_SECONDS) {
    // YouTube reclassifies anything over 60s as a regular video, which quietly
    // removes it from the Shorts shelf — the entire reason for making it.
    throw renderError(`Short is ${duration.toFixed(1)}s; YouTube requires under ${MAX_SHORT_SECONDS + 1}s`);
  }

  await fs.mkdir(path.dirname(opts.outputPath), { recursive: true });
  await fs.mkdir(opts.workDir, { recursive: true });

  const { width: W, height: H } = SHORT_RESOLUTION;
  const fps = opts.fps ?? 30;

  const contentHeight = Math.round((W * 9) / 16); // 16:9 content scaled to full width
  const contentTop = Math.round(H * 0.22);

  const filters = [
    // Blurred, over-scaled copy fills the vertical frame behind the content.
    `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=28:2,eq=brightness=-0.12[bg]`,
    `[0:v]scale=${W}:${contentHeight}[fg]`,
    `[bg][fg]overlay=0:${contentTop}:shortest=1[composed]`,
  ];

  let lastLabel = 'composed';
  if (opts.captionsPath) {
    filters.push(`[composed]subtitles='${escapeFilterPath(opts.captionsPath)}'[captioned]`);
    lastLabel = 'captioned';
  }
  filters.push(`[${lastLabel}]fps=${fps},setsar=1[v]`);

  const res = await runFfmpeg(
    [
      // -ss before -i seeks by keyframe and is fast; the re-encode below makes
      // the cut frame-accurate anyway.
      '-ss', opts.startSeconds.toFixed(3),
      '-t', duration.toFixed(3),
      '-i', opts.sourceVideoPath,
      '-filter_complex', filters.join(';'),
      '-map', '[v]', '-map', '0:a',
      '-c:v', 'libx264', '-preset', opts.preset ?? 'medium', '-crf', '20', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
      '-movflags', '+faststart',
      opts.outputPath,
    ],
    { label: 'short render', timeoutMs: 15 * 60_000 },
  );

  const [actual, stat] = await Promise.all([probeDuration(opts.outputPath), fs.stat(opts.outputPath)]);
  return { outputPath: opts.outputPath, durationSeconds: actual, bytes: stat.size, command: res.command };
}

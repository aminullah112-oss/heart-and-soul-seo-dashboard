import fs from 'node:fs/promises';
import path from 'node:path';
import { env } from '@yme/config';
import { renderError, jobLogger, formatDuration } from '@yme/shared';
import { escapeFilterPath, probeDuration, probeMedia, runFfmpeg } from './ffmpeg.js';
import type { Dimensions } from './theme.js';

/**
 * Video assembly (spec §18).
 *
 * Architecture note: each scene is encoded to its own intermediate segment and
 * the segments are concatenated, rather than building one enormous filtergraph.
 *
 * The single-filtergraph approach is faster on paper but is the wrong trade
 * here: a 90-scene graph holds every input open at once, fails as a single
 * opaque unit, and has to be re-run from zero when scene 84 has a bad asset.
 * Per-scene segments are individually cacheable (a re-render after a script
 * tweak reuses the untouched ones), individually debuggable, and bounded in
 * memory. The concat demuxer stitches them without re-encoding.
 */

export interface SceneRenderInput {
  id: string;
  /** Full-frame PNG already composited with any on-screen text. */
  framePath: string;
  /** Optional source video; when present the still is ignored. */
  videoPath?: string | null;
  /** Narration audio for this scene. */
  audioPath: string;
  /** Measured, not estimated. */
  durationSeconds: number;
  /** Ken Burns direction; 'none' for charts, which must not drift while read. */
  motion: 'in' | 'out' | 'pan-left' | 'pan-right' | 'none';
}

export interface RenderOptions extends Dimensions {
  fps: number;
  preset: string;
  workDir: string;
  outputPath: string;
  /** Background music, ducked under narration. */
  musicPath?: string | null;
  musicGainDb?: number;
  /**
   * ASS file to burn in. Leave unset for long-form: burned captions are
   * irreversible, cannot be turned off by the viewer, and collide with the
   * lower third of charts. Shorts set this, because most Shorts viewing is
   * sound-off and captions are expected.
   */
  burnSubtitlesPath?: string | null;
  /** Cross-dissolve length between scenes; 0 gives hard cuts. */
  transitionSeconds?: number;
  jobId?: string;
  videoProjectId?: string;
}

export interface RenderResult {
  outputPath: string;
  durationSeconds: number;
  bytes: number;
  sceneCount: number;
  commands: string[];
}

const CRF = 20;

export async function renderVideo(scenes: SceneRenderInput[], opts: RenderOptions): Promise<RenderResult> {
  const log = jobLogger({ jobId: opts.jobId, videoId: opts.videoProjectId, stage: 'RENDER' });
  if (scenes.length === 0) throw renderError('Cannot render a video with no scenes');

  const segmentsDir = path.join(opts.workDir, 'segments');
  await fs.mkdir(segmentsDir, { recursive: true });
  const commands: string[] = [];

  // ── 1. Encode each scene ───────────────────────────────────────────────
  const segmentPaths: string[] = [];
  for (const [i, scene] of scenes.entries()) {
    const segPath = path.join(segmentsDir, `${String(i).padStart(4, '0')}-${scene.id.replace(/[^a-zA-Z0-9_-]/g, '_')}.mp4`);
    const res = await encodeScene(scene, segPath, opts);
    commands.push(res.command);
    segmentPaths.push(segPath);
    if ((i + 1) % 10 === 0 || i === scenes.length - 1) {
      log.info({ done: i + 1, total: scenes.length }, 'scene segments encoded');
    }
  }

  // ── 2. Concatenate ─────────────────────────────────────────────────────
  const listPath = path.join(opts.workDir, 'concat.txt');
  // The concat demuxer needs single quotes escaped as '\'' inside the value.
  await fs.writeFile(listPath, segmentPaths.map((p) => `file '${p.replace(/'/g, `'\\''`)}'`).join('\n'));

  const concatPath = path.join(opts.workDir, 'concat.mp4');
  const concatRes = await runFfmpeg(
    ['-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', '-movflags', '+faststart', concatPath],
    { label: 'concat' },
  );
  commands.push(concatRes.command);

  // ── 3. Audio finishing: music bed + loudness normalisation ─────────────
  let current = concatPath;
  const finished = path.join(opts.workDir, 'audio-finished.mp4');
  const finishRes = await finishAudio(current, finished, opts);
  commands.push(finishRes.command);
  current = finished;

  if (opts.burnSubtitlesPath) {
    const burned = path.join(opts.workDir, 'burned.mp4');
    const res = await runFfmpeg(
      [
        '-i', current,
        '-vf', `subtitles='${escapeFilterPath(opts.burnSubtitlesPath)}'`,
        '-c:v', 'libx264', '-preset', opts.preset, '-crf', String(CRF), '-pix_fmt', 'yuv420p',
        '-c:a', 'copy',
        burned,
      ],
      { label: 'burn-in subtitles' },
    );
    commands.push(res.command);
    current = burned;
  }

  await fs.mkdir(path.dirname(opts.outputPath), { recursive: true });
  await fs.rename(current, opts.outputPath).catch(async () => {
    // rename fails across filesystems; copy is the fallback.
    await fs.copyFile(current, opts.outputPath);
  });

  const [duration, stat] = await Promise.all([probeDuration(opts.outputPath), fs.stat(opts.outputPath)]);
  log.info({ duration: formatDuration(duration), mb: (stat.size / 1e6).toFixed(1) }, 'render complete');

  return {
    outputPath: opts.outputPath,
    durationSeconds: duration,
    bytes: stat.size,
    sceneCount: scenes.length,
    commands,
  };
}

async function encodeScene(scene: SceneRenderInput, outPath: string, opts: RenderOptions) {
  const duration = Math.max(0.5, scene.durationSeconds);
  const frames = Math.max(1, Math.round(duration * opts.fps));

  const args: string[] = [];
  let videoFilter: string;

  if (scene.videoPath) {
    const info = await probeMedia(scene.videoPath);
    // Loop the clip if it is shorter than the narration it has to cover.
    const needsLoop = info.durationSeconds > 0 && info.durationSeconds < duration;
    if (needsLoop) args.push('-stream_loop', String(Math.ceil(duration / Math.max(0.5, info.durationSeconds))));
    args.push('-i', scene.videoPath);
    videoFilter =
      `scale=${opts.width}:${opts.height}:force_original_aspect_ratio=increase,` +
      `crop=${opts.width}:${opts.height},fps=${opts.fps},setsar=1`;
  } else {
    args.push('-loop', '1', '-i', scene.framePath);
    videoFilter = kenBurns(scene.motion, frames, opts);
  }

  args.push('-i', scene.audioPath);

  const res = await runFfmpeg(
    [
      ...args,
      '-t', duration.toFixed(3),
      '-filter_complex', `[0:v]${videoFilter}[v]`,
      '-map', '[v]',
      '-map', '1:a',
      '-c:v', 'libx264',
      '-preset', opts.preset,
      '-crf', String(CRF),
      '-pix_fmt', 'yuv420p',
      // Every segment needs identical stream parameters or the concat demuxer
      // produces silent audio drift at the joins.
      '-r', String(opts.fps),
      '-c:a', 'aac',
      '-b:a', '192k',
      '-ar', '48000',
      '-ac', '2',
      '-shortest',
      outPath,
    ],
    { label: `scene ${scene.id}` },
  );
  return res;
}

/**
 * Ken Burns motion. Slow — 4-6% over the shot — because anything faster reads
 * as a screensaver rather than as camera movement.
 *
 * zoompan is applied at 2x the output size and scaled back down: it quantises
 * zoom to whole pixels, and at 1x that quantisation is visible as a periodic
 * judder on slow moves.
 */
function kenBurns(motion: SceneRenderInput['motion'], frames: number, opts: RenderOptions): string {
  const w = opts.width;
  const h = opts.height;
  const over = `scale=${w * 2}:${h * 2}:force_original_aspect_ratio=increase,crop=${w * 2}:${h * 2}`;
  const common = `d=${frames}:s=${w}x${h}:fps=${opts.fps}`;

  switch (motion) {
    case 'in':
      return `${over},zoompan=z='min(1+0.00035*on,1.06)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':${common},setsar=1`;
    case 'out':
      return `${over},zoompan=z='max(1.06-0.00035*on,1.0)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':${common},setsar=1`;
    case 'pan-left':
      return `${over},zoompan=z='1.06':x='(iw-iw/zoom)*(1-on/${frames})':y='ih/2-(ih/zoom/2)':${common},setsar=1`;
    case 'pan-right':
      return `${over},zoompan=z='1.06':x='(iw-iw/zoom)*(on/${frames})':y='ih/2-(ih/zoom/2)':${common},setsar=1`;
    case 'none':
      // Charts are read, not watched. Motion under text makes numbers harder
      // to take in and adds nothing.
      return `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},fps=${opts.fps},setsar=1`;
  }
}

/**
 * Audio finishing: optional music bed with sidechain ducking (spec §20),
 * then loudness normalisation.
 *
 * Ducking: sidechaincompress keys the music off the narration, so music dips
 * whenever there is speech and recovers in the gaps. A fixed low gain is
 * simpler but leaves the music inaudible exactly where it is meant to work.
 *
 * Loudness: YouTube normalises playback to roughly -14 LUFS. Uploading
 * anything louder means it gets turned down, and the extra compression that
 * was used to get loud stays — so the result sounds flat next to a properly
 * mastered channel. Normalising here means what is uploaded is what plays.
 *
 * Single-pass loudnorm is used rather than two-pass. Two-pass measures the
 * whole file first and is more accurate on material with wide dynamic range,
 * but narration with a ducked bed is already narrow, and the second decode of
 * a 4K master is not worth ~0.5 LU of precision. Switch to two-pass if the
 * channel ever adds wide-dynamic archival audio.
 */
const LOUDNESS_TARGET_LUFS = -14;
const TRUE_PEAK_CEILING_DB = -1.5;

async function finishAudio(videoPath: string, outPath: string, opts: RenderOptions) {
  const duration = await probeDuration(videoPath);
  const loudnorm = `loudnorm=I=${LOUDNESS_TARGET_LUFS}:TP=${TRUE_PEAK_CEILING_DB}:LRA=11`;

  if (!opts.musicPath) {
    return runFfmpeg(
      [
        '-i', videoPath,
        '-af', loudnorm,
        '-map', '0:v', '-map', '0:a',
        '-c:v', 'copy',
        '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
        '-movflags', '+faststart',
        outPath,
      ],
      { label: 'loudness normalisation' },
    );
  }

  const gain = opts.musicGainDb ?? -19;
  const musicInfo = await probeMedia(opts.musicPath);
  const loops = musicInfo.durationSeconds > 0 ? Math.ceil(duration / musicInfo.durationSeconds) : 1;

  const filter = [
    `[1:a]volume=${gain}dB,afade=t=in:st=0:d=2,afade=t=out:st=${Math.max(0, duration - 3).toFixed(2)}:d=3[music]`,
    // Split the narration: one copy keys the sidechain, the other is mixed.
    '[0:a]asplit=2[voice][key]',
    '[music][key]sidechaincompress=threshold=0.05:ratio=9:attack=8:release=420[ducked]',
    '[voice][ducked]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[mixed]',
    `[mixed]${loudnorm}[out]`,
  ].join(';');

  return runFfmpeg(
    [
      '-i', videoPath,
      '-stream_loop', String(Math.max(0, loops - 1)), '-i', opts.musicPath,
      '-filter_complex', filter,
      '-map', '0:v', '-map', '[out]',
      '-c:v', 'copy',
      '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
      '-t', duration.toFixed(3),
      '-movflags', '+faststart',
      outPath,
    ],
    { label: 'music mix + loudness normalisation' },
  );
}

/** Concatenates per-scene narration into one continuous track. */
export async function concatAudio(audioPaths: string[], outPath: string, workDir: string): Promise<number> {
  if (audioPaths.length === 0) throw renderError('No audio to concatenate');
  await fs.mkdir(path.dirname(outPath), { recursive: true });

  const listPath = path.join(workDir, 'audio-concat.txt');
  await fs.writeFile(listPath, audioPaths.map((p) => `file '${p.replace(/'/g, `'\\''`)}'`).join('\n'));

  await runFfmpeg(
    [
      '-f', 'concat', '-safe', '0', '-i', listPath,
      // Re-encoded rather than stream-copied: TTS providers return varying
      // sample rates, and concat -c copy on mismatched inputs produces audio
      // that plays at the wrong speed after the first file.
      '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2',
      outPath,
    ],
    { label: 'audio concat' },
  );

  return probeDuration(outPath);
}

/** Chooses motion per scene so consecutive shots do not move identically. */
export function motionForScene(index: number, visualKind: string): SceneRenderInput['motion'] {
  if (visualKind === 'CHART' || visualKind === 'TEXT_CARD') return 'none';
  const cycle: SceneRenderInput['motion'][] = ['in', 'pan-right', 'out', 'pan-left'];
  return cycle[index % cycle.length]!;
}

export const renderDefaults = () => ({
  fps: env.RENDER_FPS,
  preset: env.RENDER_PRESET,
});

import fs from 'node:fs/promises';
import path from 'node:path';
import { env, pricing } from '@yme/config';
import { prisma, recordCost } from '@yme/database';
import { jobLogger, renderError } from '@yme/shared';
import { getStorage } from '@yme/storage';
import {
  buildCues,
  encodeThumbnail,
  motionForScene,
  renderShort,
  renderVideo,
  resolutionFor,
  thumbnailSvg,
  toAss,
  toSrt,
  toVtt,
  type SceneRenderInput,
} from '@yme/video';
import { ensureWorkDir, storageKeys } from './workdir.js';

export interface RenderStageResult {
  renderId: string;
  durationSeconds: number;
  bytes: number;
  sceneCount: number;
  thumbnailsRendered: number;
}

/**
 * Render stage.
 *
 * The failure isolation spec §37 asks for lives here: the VideoRender row is
 * created FIRST with status RUNNING, and a failure marks that row FAILED
 * without touching research, script or voiceovers. A retry re-enters this
 * stage only, and reuses the stored per-scene audio and frames.
 */
export async function runRenderStage(opts: { videoProjectId: string; jobId?: string }): Promise<RenderStageResult> {
  const log = jobLogger({ jobId: opts.jobId, videoId: opts.videoProjectId, stage: 'RENDER' });
  const storage = getStorage();
  const dims = resolutionFor(env.RENDER_RESOLUTION);
  const workDir = await ensureWorkDir(opts.videoProjectId, 'render');

  const project = await prisma.videoProject.findUnique({
    where: { id: opts.videoProjectId },
    include: {
      scenes: { orderBy: { index: 'asc' }, include: { voiceover: true, asset: true } },
      thumbnails: true,
      titleVariants: { orderBy: { rubricScore: 'desc' } },
      channel: true,
    },
  });
  if (!project) throw new Error(`VideoProject ${opts.videoProjectId} not found`);
  if (project.scenes.length === 0) throw renderError('No scenes to render');

  const missingAudio = project.scenes.filter((s) => !s.voiceover);
  if (missingAudio.length) {
    throw renderError(
      `${missingAudio.length} scene(s) have no voiceover; run the VOICE stage first`,
      { details: { sceneIds: missingAudio.map((s) => s.id) } },
    );
  }

  const render = await prisma.videoRender.create({
    data: {
      videoProjectId: project.id,
      format: 'LONG_FORM_16_9',
      status: 'RUNNING',
      resolution: env.RENDER_RESOLUTION,
      fps: env.RENDER_FPS,
      startedAt: new Date(),
    },
  });

  try {
    // ── Materialise inputs ───────────────────────────────────────────────
    const inputs: SceneRenderInput[] = [];
    const captionSources: Array<{ narration: string; startSeconds: number; durationSeconds: number }> = [];
    let cursor = 0;

    for (const [i, scene] of project.scenes.entries()) {
      const framePath = path.join(workDir, `frame-${scene.id}.png`);
      await storage.getToFile(storageKeys.sceneFrame(project.id, scene.id), framePath);

      const audioPath = path.join(workDir, `audio-${scene.id}.wav`);
      await storage.getToFile(scene.voiceover!.storageKey, audioPath);

      const duration = scene.actualSeconds ?? scene.voiceover!.durationSeconds;

      let videoPath: string | null = null;
      if (scene.asset?.mimeType === 'video/mp4') {
        videoPath = path.join(workDir, `src-${scene.id}.mp4`);
        await storage.getToFile(scene.asset.storageKey, videoPath);
      }

      inputs.push({
        id: scene.id,
        framePath,
        videoPath,
        audioPath,
        durationSeconds: duration,
        motion: motionForScene(i, scene.visualKind),
      });
      captionSources.push({ narration: scene.narration, startSeconds: cursor, durationSeconds: duration });
      cursor += duration;
    }

    // ── Captions ─────────────────────────────────────────────────────────
    const cues = buildCues(captionSources);
    const srtPath = path.join(workDir, 'captions.srt');
    const vttPath = path.join(workDir, 'captions.vtt');
    await fs.writeFile(srtPath, toSrt(cues));
    await fs.writeFile(vttPath, toVtt(cues));

    // ── Music bed ────────────────────────────────────────────────────────
    const track = await prisma.musicTrack.findFirst({ where: { channelId: project.channelId } });
    let musicPath: string | null = null;
    if (track) {
      musicPath = path.join(workDir, 'music');
      await storage.getToFile(track.storageKey, musicPath);
    }

    // ── Render ───────────────────────────────────────────────────────────
    const outputPath = path.join(workDir, 'master.mp4');
    const result = await renderVideo(inputs, {
      ...dims,
      fps: env.RENDER_FPS,
      preset: env.RENDER_PRESET,
      workDir,
      outputPath,
      musicPath,
      // Long-form ships soft subtitles; see the note in @yme/video/render.
      burnSubtitlesPath: null,
      jobId: opts.jobId,
      videoProjectId: project.id,
    });

    // ── Persist ──────────────────────────────────────────────────────────
    const renderKey = storageKeys.render(project.id, render.id);
    const srtKey = storageKeys.subtitleSrt(project.id, render.id);
    const vttKey = storageKeys.subtitleVtt(project.id, render.id);

    await storage.putFile(renderKey, outputPath, { contentType: 'video/mp4' });
    await storage.putFile(srtKey, srtPath, { contentType: 'application/x-subrip' });
    await storage.putFile(vttKey, vttPath, { contentType: 'text/vtt' });

    await prisma.videoRender.update({
      where: { id: render.id },
      data: {
        status: 'COMPLETED',
        storageKey: renderKey,
        subtitleSrtKey: srtKey,
        subtitleVttKey: vttKey,
        durationSeconds: result.durationSeconds,
        bytes: result.bytes,
        // Stored verbatim so a bad render can be reproduced by hand.
        ffmpegCommand: result.commands.join('\n\n').slice(0, 20_000),
        completedAt: new Date(),
      },
    });

    await recordCost({
      videoProjectId: project.id,
      category: 'RENDER',
      provider: 'ffmpeg',
      stage: 'RENDER',
      usd: (result.durationSeconds / 60) * pricing.renderPerOutputMinute,
      units: result.durationSeconds / 60,
      unitLabel: 'output minutes',
      detail: { scenes: result.sceneCount, resolution: env.RENDER_RESOLUTION },
    });

    // Thumbnail concepts do not exist yet — PACKAGING runs after RENDER — so
    // rasterising them here would always produce zero. The PACKAGING stage
    // calls renderThumbnails() once the concepts exist.
    const thumbnailsRendered = 0;

    log.info(
      { duration: Math.round(result.durationSeconds), mb: (result.bytes / 1e6).toFixed(1), thumbnailsRendered },
      'render stage complete',
    );

    return {
      renderId: render.id,
      durationSeconds: result.durationSeconds,
      bytes: result.bytes,
      sceneCount: result.sceneCount,
      thumbnailsRendered,
    };
  } catch (err) {
    await prisma.videoRender.update({
      where: { id: render.id },
      data: {
        status: 'FAILED',
        error: err instanceof Error ? err.message.slice(0, 4000) : String(err),
        completedAt: new Date(),
      },
    });
    throw err;
  }
}

export async function renderThumbnails(videoProjectId: string, workDir?: string): Promise<number> {
  const storage = getStorage();
  const dir = workDir ?? (await ensureWorkDir(videoProjectId, 'thumbnails'));
  const project = await prisma.videoProject.findUnique({
    where: { id: videoProjectId },
    include: { thumbnails: true, topic: true, titleVariants: { orderBy: { rubricScore: 'desc' }, take: 1 } },
  });
  if (!project) return 0;

  const kicker = extractSubject(project.topic.title);
  let count = 0;

  for (const thumb of project.thumbnails) {
    const outPath = path.join(dir, `thumb-${thumb.id}.jpg`);
    await encodeThumbnail(
      thumbnailSvg({
        headline: thumb.headline || project.topic.title,
        kicker,
        statistic: extractStatistic(thumb.concept),
        statisticCaption: null,
      }),
      outPath,
    );
    const key = storageKeys.thumbnail(project.id, thumb.id);
    await storage.putFile(key, outPath, { contentType: 'image/jpeg' });
    await prisma.thumbnail.update({ where: { id: thumb.id }, data: { storageKey: key } });
    count++;
  }
  return count;
}

/** First proper-noun-ish token from the title, used as the thumbnail kicker. */
function extractSubject(title: string): string | null {
  const match = title.match(/\b([A-Z][A-Za-z0-9&.'-]{2,})\b/);
  return match?.[1] ?? null;
}

/** Pulls a short figure like "$47.5B" out of a concept description, if present. */
function extractStatistic(concept: string): string | null {
  const match = concept.match(/[$€£]\s?\d[\d,.]*\s?[BMKT]?|\b\d{1,3}(?:\.\d)?%/);
  const value = match?.[0]?.replace(/\s+/g, '');
  return value && value.length <= 8 ? value : null;
}

/** Renders approved Shorts from the finished long-form master (spec §35). */
export async function runShortsStage(opts: { videoProjectId: string; jobId?: string }): Promise<number> {
  const log = jobLogger({ jobId: opts.jobId, videoId: opts.videoProjectId, stage: 'RENDER' });
  const storage = getStorage();
  const workDir = await ensureWorkDir(opts.videoProjectId, 'shorts');

  const project = await prisma.videoProject.findUnique({
    where: { id: opts.videoProjectId },
    include: {
      shorts: true,
      renders: { where: { status: 'COMPLETED', format: 'LONG_FORM_16_9' }, orderBy: { createdAt: 'desc' }, take: 1 },
    },
  });
  const master = project?.renders[0];
  if (!project || !master?.storageKey) {
    log.warn('no completed long-form render; skipping shorts');
    return 0;
  }

  const masterPath = path.join(workDir, 'master.mp4');
  await storage.getToFile(master.storageKey, masterPath);

  let rendered = 0;
  for (const short of project.shorts) {
    const renderRow = await prisma.videoRender.create({
      data: {
        videoProjectId: project.id,
        format: 'SHORT_9_16',
        status: 'RUNNING',
        resolution: '1080x1920',
        fps: env.RENDER_FPS,
        startedAt: new Date(),
      },
    });

    try {
      // Shorts burn captions in: most Shorts viewing is sound-off.
      const cues = buildCues(
        [{ narration: short.narration, startSeconds: 0, durationSeconds: short.endSeconds - short.startSeconds }],
        { maxCharsPerLine: 22, maxLinesPerCue: 3 },
      );
      const assPath = path.join(workDir, `${short.id}.ass`);
      await fs.writeFile(assPath, toAss(cues, { width: 1080, height: 1920, fontSize: 58 }));

      const outPath = path.join(workDir, `${short.id}.mp4`);
      const result = await renderShort({
        sourceVideoPath: masterPath,
        startSeconds: short.startSeconds,
        endSeconds: Math.min(short.endSeconds, short.startSeconds + 58),
        outputPath: outPath,
        workDir,
        captionsPath: assPath,
        fps: env.RENDER_FPS,
        preset: env.RENDER_PRESET,
      });

      const key = storageKeys.shortRender(project.id, renderRow.id);
      await storage.putFile(key, outPath, { contentType: 'video/mp4' });

      await prisma.videoRender.update({
        where: { id: renderRow.id },
        data: {
          status: 'COMPLETED',
          storageKey: key,
          durationSeconds: result.durationSeconds,
          bytes: result.bytes,
          ffmpegCommand: result.command.slice(0, 20_000),
          completedAt: new Date(),
        },
      });
      await prisma.shortClip.update({ where: { id: short.id }, data: { renderId: renderRow.id } });
      rendered++;
    } catch (err) {
      // One bad Short must not fail the long-form video it belongs to.
      await prisma.videoRender.update({
        where: { id: renderRow.id },
        data: { status: 'FAILED', error: err instanceof Error ? err.message.slice(0, 4000) : String(err), completedAt: new Date() },
      });
      log.warn({ shortId: short.id, err: String(err) }, 'short render failed; continuing');
    }
  }

  log.info({ rendered, total: project.shorts.length }, 'shorts stage complete');
  return rendered;
}

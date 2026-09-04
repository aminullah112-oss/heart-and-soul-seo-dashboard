import fs from 'node:fs/promises';
import path from 'node:path';
import { env } from '@yme/config';
import { prisma } from '@yme/database';
import { jobLogger } from '@yme/shared';
import { applyPronunciation, detectPronunciationIssues, synthesize } from '@yme/audio';
import { getStorage } from '@yme/storage';
import { probeDuration } from '@yme/video';
import { ensureWorkDir, storageKeys } from './workdir.js';

/**
 * Voiceover stage (spec §17).
 *
 * Per scene rather than one long take, for three reasons: a failed scene costs
 * one re-synthesis instead of the whole narration, scene timing comes from
 * measuring each clip rather than guessing at word boundaries, and a script
 * edit only re-synthesises the scenes that changed.
 *
 * Durations are re-measured with ffprobe and written back to the scenes. Every
 * downstream timing — captions, chapters, Shorts offsets — reads those, so a
 * TTS engine that speaks faster than 150wpm does not desynchronise the video.
 */
export interface VoiceResult {
  scenesSynthesised: number;
  scenesReused: number;
  totalSeconds: number;
  pronunciationWarnings: Array<{ term: string; reason: string; suggestion: string }>;
}

export async function runVoiceStage(opts: {
  videoProjectId: string;
  jobId?: string;
  /** Re-synthesise even when a voiceover already exists for the scene. */
  force?: boolean;
}): Promise<VoiceResult> {
  const log = jobLogger({ jobId: opts.jobId, videoId: opts.videoProjectId, stage: 'VOICE' });
  const storage = getStorage();
  const workDir = await ensureWorkDir(opts.videoProjectId, 'voice');

  const project = await prisma.videoProject.findUnique({
    where: { id: opts.videoProjectId },
    include: { scenes: { orderBy: { index: 'asc' }, include: { voiceover: true } } },
  });
  if (!project) throw new Error(`VideoProject ${opts.videoProjectId} not found`);

  const dictionary = await prisma.pronunciationEntry.findMany({
    where: { channelId: project.channelId },
    select: { written: true, spoken: true },
  });

  const allNarration = project.scenes.map((s) => s.narration).join(' ');
  const pronunciationWarnings = detectPronunciationIssues(allNarration, dictionary);
  if (pronunciationWarnings.length) {
    // Surfaced rather than auto-applied: a wrong guess at a company's
    // pronunciation is worse than the default reading, and this is cheap for a
    // human to confirm once and reuse forever.
    log.warn(
      { terms: pronunciationWarnings.map((w) => w.term) },
      'terms may be mispronounced; add dictionary entries to fix',
    );
  }

  let synthesised = 0;
  let reused = 0;
  let cursor = 0;

  for (const scene of project.scenes) {
    const audioPath = path.join(workDir, `${scene.id}.wav`);
    const storageKey = storageKeys.sceneAudio(project.id, scene.id);

    let duration: number;

    if (!opts.force && scene.voiceover && (await storage.exists(scene.voiceover.storageKey))) {
      await storage.getToFile(scene.voiceover.storageKey, audioPath);
      duration = scene.voiceover.durationSeconds;
      reused++;
    } else {
      const spokenText = applyPronunciation(scene.narration, dictionary);
      const result = await synthesize(
        { text: spokenText, voiceId: env.TTS_VOICE_ID || undefined, speed: env.TTS_SPEED },
        { videoProjectId: project.id, stage: 'VOICE' },
      );

      await fs.writeFile(audioPath, result.audio);
      // The measured duration, not the provider's estimate.
      duration = await probeDuration(audioPath);
      await storage.putFile(storageKey, audioPath, { contentType: `audio/${result.format}` });

      await prisma.voiceover.upsert({
        where: { sceneId: scene.id },
        update: {
          provider: result.provider,
          voiceId: env.TTS_VOICE_ID || 'default',
          storageKey,
          durationSeconds: duration,
          characters: result.characters,
          spokenText,
        },
        create: {
          videoProjectId: project.id,
          sceneId: scene.id,
          provider: result.provider,
          voiceId: env.TTS_VOICE_ID || 'default',
          storageKey,
          durationSeconds: duration,
          characters: result.characters,
          spokenText,
        },
      });
      synthesised++;
    }

    await prisma.scene.update({
      where: { id: scene.id },
      data: { actualSeconds: duration, startSeconds: cursor },
    });
    cursor += duration;
  }

  log.info({ synthesised, reused, totalSeconds: Math.round(cursor) }, 'voice stage complete');
  return { scenesSynthesised: synthesised, scenesReused: reused, totalSeconds: cursor, pronunciationWarnings };
}

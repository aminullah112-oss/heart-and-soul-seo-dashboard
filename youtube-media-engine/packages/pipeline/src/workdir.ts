import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { env } from '@yme/config';

/**
 * Per-project scratch space.
 *
 * Renders produce gigabytes of intermediates. They live outside object storage
 * deliberately — uploading every scene segment would cost more in egress than
 * the render costs in compute — and are cleaned up after the finished artefact
 * has been persisted.
 */
export function workDirFor(videoProjectId: string, stage: string): string {
  const base = process.env.YME_WORK_DIR ?? path.join(os.tmpdir(), 'yme-work');
  return path.join(base, videoProjectId, stage);
}

export async function ensureWorkDir(videoProjectId: string, stage: string): Promise<string> {
  const dir = workDirFor(videoProjectId, stage);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

export async function cleanupWorkDir(videoProjectId: string, stage?: string): Promise<void> {
  const dir = stage ? workDirFor(videoProjectId, stage) : path.dirname(workDirFor(videoProjectId, 'x'));
  await fs.rm(dir, { recursive: true, force: true });
}

/** Storage key layout, kept in one place so nothing invents its own scheme. */
export const storageKeys = {
  sceneFrame: (projectId: string, sceneId: string) => `projects/${projectId}/frames/${sceneId}.png`,
  sceneAudio: (projectId: string, sceneId: string) => `projects/${projectId}/audio/${sceneId}.wav`,
  chart: (projectId: string, sceneId: string) => `projects/${projectId}/charts/${sceneId}.png`,
  stockAsset: (projectId: string, sceneId: string, ext: string) => `projects/${projectId}/stock/${sceneId}.${ext}`,
  render: (projectId: string, renderId: string) => `projects/${projectId}/renders/${renderId}.mp4`,
  shortRender: (projectId: string, renderId: string) => `projects/${projectId}/shorts/${renderId}.mp4`,
  subtitleSrt: (projectId: string, renderId: string) => `projects/${projectId}/renders/${renderId}.srt`,
  subtitleVtt: (projectId: string, renderId: string) => `projects/${projectId}/renders/${renderId}.vtt`,
  subtitleAss: (projectId: string, renderId: string) => `projects/${projectId}/renders/${renderId}.ass`,
  thumbnail: (projectId: string, thumbnailId: string) => `projects/${projectId}/thumbnails/${thumbnailId}.jpg`,
} as const;

export { env };

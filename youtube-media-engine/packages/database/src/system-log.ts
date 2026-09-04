import { prisma } from './client.js';
import type { LogLevel } from '@prisma/client';

/**
 * Persisted log line (spec §43). Deliberately fire-and-forget: an unreachable
 * database must never be the reason a render fails, so a write failure is
 * swallowed after being echoed to stderr.
 */
export async function logSystem(entry: {
  level: LogLevel;
  source: string;
  message: string;
  jobId?: string;
  videoProjectId?: string;
  stage?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    await prisma.systemLog.create({
      data: {
        level: entry.level,
        source: entry.source,
        message: entry.message.slice(0, 8000),
        jobId: entry.jobId ?? null,
        videoProjectId: entry.videoProjectId ?? null,
        stage: entry.stage ?? null,
        metadata: (entry.metadata ?? undefined) as never,
      },
    });
  } catch (err) {
    process.stderr.write(
      `[system-log] failed to persist log: ${err instanceof Error ? err.message : String(err)}\n`,
    );
  }
}

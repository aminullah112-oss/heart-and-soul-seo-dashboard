import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth';
import { getSystemHealth } from '@/lib/queries';
import { Card, Stat, Badge, Empty, Table, money, ago } from '@/components/ui';
import { env } from '@yme/config';
import { assertFfmpegAvailable } from '@yme/video';
import { prisma } from '@yme/database';

/** System health (spec §43). */
export default async function HealthPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  const health = await getSystemHealth();

  // Probe the pieces that fail silently rather than loudly.
  const [dbOk, ffmpeg] = await Promise.all([
    prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false),
    assertFfmpegAvailable().catch(() => null),
  ]);

  const counts = Object.fromEntries(health.jobsByStatus.map((g) => [g.status, g._count._all]));
  const failed = counts.FAILED ?? 0;
  const queued = counts.QUEUED ?? 0;

  const oldestQueuedAge = health.oldestQueued
    ? Math.round((Date.now() - health.oldestQueued.createdAt.getTime()) / 60000)
    : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold">System health</h1>
        <p className="mt-1 text-sm text-paper-faint">Last 24 hours.</p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Stat label="Database" value={dbOk ? 'OK' : 'DOWN'} tone={dbOk ? 'good' : 'bad'} />
        <Stat
          label="ffmpeg"
          value={ffmpeg ? 'OK' : 'MISSING'}
          tone={ffmpeg ? 'good' : 'bad'}
          hint={ffmpeg ? (ffmpeg.hasLibass ? 'libass present' : 'no libass — Shorts captions will fail') : `not runnable at ${env.FFMPEG_PATH}`}
        />
        <Stat label="Jobs failed" value={failed} tone={failed > 0 ? 'bad' : 'good'} />
        <Stat
          label="Jobs queued"
          value={queued}
          tone={oldestQueuedAge && oldestQueuedAge > 60 ? 'warn' : undefined}
          hint={oldestQueuedAge !== null ? `oldest ${oldestQueuedAge}m` : undefined}
        />
        <Stat label="Spend, 24h" value={money(health.costToday.totalUsd)} />
      </div>

      {health.stuckProjects.length > 0 && (
        <Card title="Stuck projects" subtitle="Active but not updated in over six hours — usually a crashed worker">
          <Table head={['Project', 'Stage', 'Last update']}>
            {health.stuckProjects.map((p) => (
              <tr key={p.id}>
                <td className="py-2 pr-4 font-mono text-xs">{p.slug}</td>
                <td className="py-2 pr-4"><Badge tone="warn">{p.stage}</Badge></td>
                <td className="py-2 pr-4 text-paper-muted">{ago(p.updatedAt)}</td>
              </tr>
            ))}
          </Table>
        </Card>
      )}

      <Card title="Recent errors">
        {health.recentErrors.length === 0 ? (
          <Empty>No errors logged in the last 24 hours.</Empty>
        ) : (
          <Table head={['Level', 'Source', 'Stage', 'Message', 'When']}>
            {health.recentErrors.map((e) => (
              <tr key={e.id} className="align-top">
                <td className="py-2 pr-4"><Badge tone="bad">{e.level}</Badge></td>
                <td className="py-2 pr-4 font-mono text-xs text-paper-faint">{e.source}</td>
                <td className="py-2 pr-4 text-xs">{e.stage ?? '—'}</td>
                <td className="py-2 pr-4 text-xs text-paper-muted">{e.message.slice(0, 160)}</td>
                <td className="py-2 pr-4 text-xs text-paper-faint">{ago(e.createdAt)}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Card title="Provider configuration" subtitle="What this instance would actually call">
        <Table head={['Concern', 'Configured', 'Effective']}>
          {[
            ['Mode', env.MOCK_MODE ? 'MOCK_MODE=true' : 'live', env.MOCK_MODE ? 'no external calls' : 'real providers'],
            ['LLM', env.LLM_PROVIDER, env.MOCK_MODE ? 'mock' : env.LLM_PROVIDER],
            ['Search', env.SEARCH_PROVIDER, env.MOCK_MODE ? 'mock' : env.SEARCH_PROVIDER],
            ['TTS', env.TTS_PROVIDER, env.MOCK_MODE ? 'mock' : env.TTS_PROVIDER],
            ['Images', env.IMAGE_PROVIDER, env.MOCK_MODE ? 'mock' : env.IMAGE_PROVIDER],
            ['Stock', env.STOCK_PROVIDER, env.MOCK_MODE ? 'mock' : env.STOCK_PROVIDER],
            ['YouTube', env.YOUTUBE_PROVIDER, env.MOCK_MODE ? 'mock (cannot reach Google)' : env.YOUTUBE_PROVIDER],
            ['Storage', env.STORAGE_DRIVER, env.STORAGE_DRIVER === 'local' ? env.STORAGE_LOCAL_PATH : env.STORAGE_BUCKET],
            ['Publish', env.AUTOMATIC_PUBLISH ? 'AUTOMATIC' : 'human approval', env.HUMAN_APPROVAL ? 'approval enforced' : 'approval NOT enforced'],
          ].map(([k, a, b]) => (
            <tr key={k}>
              <td className="py-2 pr-4">{k}</td>
              <td className="py-2 pr-4 font-mono text-xs text-paper-muted">{a}</td>
              <td className="py-2 pr-4 font-mono text-xs text-paper-faint">{b}</td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}

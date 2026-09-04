import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth';
import { getChannel, getDashboardSummary, getRecentPerformance, getLatestLearningReport } from '@/lib/queries';
import { Card, Stat, Badge, Table, LinkCell, Empty, money, num, pct, ago } from '@/components/ui';
import { env } from '@yme/config';

export default async function DashboardPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  const channel = await getChannel();
  if (!channel) {
    return (
      <Card title="No channel configured">
        <p className="text-sm text-paper-muted">
          Run <code className="rounded bg-ink px-1.5 py-0.5 font-mono text-xs">pnpm db:seed</code> to create the
          channel and operator account.
        </p>
      </Card>
    );
  }

  const [summary, performance, learning] = await Promise.all([
    getDashboardSummary(channel.id),
    getRecentPerformance(channel.id),
    getLatestLearningReport(channel.id),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-lg font-semibold">{channel.name}</h1>
          <p className="mt-1 max-w-2xl text-sm text-paper-faint">{channel.positioning}</p>
        </div>
        <div className="flex gap-2">
          {env.MOCK_MODE && <Badge tone="warn">MOCK MODE — no external calls</Badge>}
          {channel.humanApproval ? (
            <Badge tone="good">Human approval required</Badge>
          ) : (
            <Badge tone="bad">Automatic publish enabled</Badge>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-6">
        <Stat label="In production" value={summary.inProduction} />
        <Stat label="Awaiting approval" value={summary.awaitingApproval} tone={summary.awaitingApproval > 0 ? 'warn' : undefined} />
        <Stat label="Scheduled" value={summary.scheduled} />
        <Stat label="Published" value={summary.published} />
        <Stat label="Blocked" value={summary.blocked} tone={summary.blocked > 0 ? 'bad' : undefined} />
        <Stat label="Spend, 30d" value={money(summary.costs.totalUsd)} hint={`${summary.failedJobs} failed jobs`} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card title="Recent performance" subtitle="Latest analytics snapshot per video">
            {performance.length === 0 ? (
              <Empty>Nothing published yet.</Empty>
            ) : (
              <Table head={['Video', 'Published', 'Views', 'CTR', 'Avg viewed', 'Subs', 'Revenue']}>
                {performance.map((v) => (
                  <tr key={v.id} className="align-top">
                    <td className="py-2 pr-4">
                      <LinkCell href={`/videos/${v.projectId}`}>{v.title}</LinkCell>
                      <div className="mt-0.5">
                        <Badge tone={v.visibility === 'PUBLIC' ? 'good' : 'neutral'}>{v.visibility}</Badge>
                      </div>
                    </td>
                    <td className="py-2 pr-4 text-paper-muted">{ago(v.publishedAt)}</td>
                    <td className="tnum py-2 pr-4">{num(v.views)}</td>
                    <td className="tnum py-2 pr-4">{pct(v.ctr)}</td>
                    <td className="tnum py-2 pr-4">{pct(v.avgViewPct)}</td>
                    <td className="tnum py-2 pr-4">{num(v.subs)}</td>
                    <td className="tnum py-2 pr-4">{money(v.revenueUsd)}</td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="Spend by category" subtitle="Last 30 days">
            {Object.keys(summary.costs.byCategory).length === 0 ? (
              <Empty>No spend recorded.</Empty>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {Object.entries(summary.costs.byCategory)
                  .sort((a, b) => b[1] - a[1])
                  .map(([k, v]) => (
                    <li key={k} className="flex justify-between">
                      <span className="text-paper-muted">{k}</span>
                      <span className="tnum">{money(v)}</span>
                    </li>
                  ))}
              </ul>
            )}
          </Card>

          <Card title="Learning report" subtitle={learning ? `Week ending ${learning.periodEnd.toISOString().slice(0, 10)}` : undefined}>
            {!learning ? (
              <Empty>No report yet. Generated weekly once videos have analytics.</Empty>
            ) : (
              <div className="space-y-3 text-sm">
                <p className="text-paper-muted">{learning.summary}</p>
                <div className="text-xs text-paper-faint">
                  {learning.videosAnalysed} videos analysed ·{' '}
                  {(learning.findings as unknown[]).length} actionable ·{' '}
                  {(learning.provisional as unknown[]).length} provisional
                </div>
              </div>
            )}
          </Card>
        </div>
      </div>

      <Card title="Recent jobs" subtitle="Newest first">
        {summary.recentJobs.length === 0 ? (
          <Empty>No jobs have run.</Empty>
        ) : (
          <Table head={['Stage', 'Status', 'Duration', 'When', 'Detail']}>
            {summary.recentJobs.map((j) => (
              <tr key={j.id}>
                <td className="py-2 pr-4 font-mono text-xs">{j.stage}</td>
                <td className="py-2 pr-4">
                  <Badge tone={j.status === 'COMPLETED' ? 'good' : j.status === 'FAILED' ? 'bad' : 'neutral'}>
                    {j.status}
                  </Badge>
                </td>
                <td className="tnum py-2 pr-4 text-paper-muted">{j.durationMs ? `${(j.durationMs / 1000).toFixed(1)}s` : '—'}</td>
                <td className="py-2 pr-4 text-paper-muted">{ago(j.createdAt)}</td>
                <td className="py-2 pr-4 text-xs text-paper-faint">
                  {j.error ? <span className="text-bad">{j.errorKind}: {j.error.slice(0, 90)}</span> : j.jobName}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}

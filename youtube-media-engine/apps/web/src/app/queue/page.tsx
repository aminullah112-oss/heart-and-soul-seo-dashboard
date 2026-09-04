import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getSessionUser } from '@/lib/auth';
import { getChannel, getProductionQueue } from '@/lib/queries';
import { Card, Badge, Empty, Table, LinkCell, money, ago } from '@/components/ui';
import { PIPELINE_STAGES } from '@yme/shared';

const ALL_STAGES = PIPELINE_STAGES.filter((s) => s !== 'PUBLISHED');

export default async function QueuePage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  const channel = await getChannel();
  if (!channel) return <Card title="No channel configured"><Empty>Run pnpm db:seed.</Empty></Card>;

  const projects = await getProductionQueue(channel.id);
  const byStage = new Map<string, typeof projects>();
  for (const stage of ALL_STAGES) byStage.set(stage, []);
  for (const p of projects) {
    const list = byStage.get(p.stage);
    if (list) list.push(p);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold">Production queue</h1>
        <p className="mt-1 text-sm text-paper-faint">
          Each stage is independently retryable. A failure at render does not re-run research.
        </p>
      </div>

      {/* Stage strip: where work actually is right now. */}
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6 lg:grid-cols-11">
        {ALL_STAGES.map((stage) => {
          const count = byStage.get(stage)?.length ?? 0;
          return (
            <div key={stage} className={`rounded border px-2 py-2 text-center ${count > 0 ? 'border-accent/40 bg-accent/5' : 'border-ink-line bg-ink-raised'}`}>
              <div className="tnum text-lg font-semibold">{count}</div>
              <div className="mt-0.5 text-[10px] uppercase tracking-wider text-paper-faint">
                {stage.replace(/_/g, ' ')}
              </div>
            </div>
          );
        })}
      </div>

      <Card title="Projects" subtitle={`${projects.length} in flight`}>
        {projects.length === 0 ? (
          <Empty>Nothing in production. Approve a topic to start.</Empty>
        ) : (
          <Table head={['Project', 'Stage', 'Status', 'QC', 'Spend', 'Updated', 'Last job']}>
            {projects.map((p) => {
              const spend = p.costRecords.reduce((a, c) => a + c.usd.toNumber(), 0);
              const lastJob = p.automationJobs[0];
              return (
                <tr key={p.id} className="align-top">
                  <td className="py-2 pr-4">
                    <LinkCell href={`/videos/${p.id}`}>{p.topic.title}</LinkCell>
                    {p.blockedReason && (
                      <div className="mt-1 max-w-md text-xs text-bad">{p.blockedReason}</div>
                    )}
                  </td>
                  <td className="py-2 pr-4"><Badge tone="accent">{p.stage}</Badge></td>
                  <td className="py-2 pr-4">
                    <Badge tone={p.status === 'ACTIVE' ? 'good' : p.status === 'COMPLETED' ? 'good' : 'bad'}>
                      {p.status}
                    </Badge>
                  </td>
                  <td className="tnum py-2 pr-4">
                    {p.qcReport ? (
                      <span className={p.qcReport.passed ? 'text-good' : 'text-bad'}>
                        {p.qcReport.finalScore.toFixed(1)}
                      </span>
                    ) : '—'}
                  </td>
                  <td className="tnum py-2 pr-4">{money(spend)}</td>
                  <td className="py-2 pr-4 text-paper-muted">{ago(p.updatedAt)}</td>
                  <td className="py-2 pr-4 text-xs text-paper-faint">
                    {lastJob ? (
                      <>
                        {lastJob.stage} · {lastJob.status}
                        {lastJob.error && <div className="text-bad">{lastJob.error.slice(0, 70)}</div>}
                      </>
                    ) : '—'}
                  </td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>

      <p className="text-xs text-paper-faint">
        Videos waiting at <strong>APPROVAL</strong> need a human decision.{' '}
        <Link href="/" className="text-accent hover:underline">Dashboard</Link> shows the count.
      </p>
    </div>
  );
}

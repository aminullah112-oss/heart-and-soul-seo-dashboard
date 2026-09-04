import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth';
import { getChannel, getSponsors } from '@/lib/queries';
import { Card, Badge, Empty, Table } from '@/components/ui';
import { WeightsEditor } from './weights-editor';
import { DEFAULT_SCORING_WEIGHTS } from '@yme/config';
import { prisma } from '@yme/database';

export default async function SettingsPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  const channel = await getChannel();
  if (!channel) return <Card title="No channel configured"><Empty>Run pnpm db:seed.</Empty></Card>;

  const [sponsors, pronunciations] = await Promise.all([
    getSponsors(channel.id),
    prisma.pronunciationEntry.findMany({ where: { channelId: channel.id }, orderBy: { written: 'asc' } }),
  ]);

  const weights = { ...DEFAULT_SCORING_WEIGHTS, ...(channel.scoringWeights as Record<string, number>) };
  const style = (channel.styleGuide ?? {}) as { voice?: string; bannedPhrases?: string[]; rules?: string[] };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold">Settings</h1>
        <p className="mt-1 text-sm text-paper-faint">Channel configuration and editorial policy.</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Channel">
          <dl className="space-y-2 text-sm">
            {[
              ['Name', channel.name],
              ['Category', channel.category],
              ['Language', channel.language],
              ['Video length', `${channel.videoLengthMinMinutes}–${channel.videoLengthMaxMinutes} minutes`],
              ['Publish frequency', `${channel.publishPerWeek} per week`],
              ['Shorts per video', String(channel.shortsPerVideo)],
              ['Minimum topic score', String(channel.minimumTopicScore)],
              ['Minimum QC score', String(channel.minimumQcScore)],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4">
                <dt className="text-paper-faint">{k}</dt>
                <dd className="text-right text-paper-muted">{v}</dd>
              </div>
            ))}
            <div className="flex justify-between gap-4 border-t border-ink-line pt-2">
              <dt className="text-paper-faint">Publishing</dt>
              <dd>
                {channel.humanApproval
                  ? <Badge tone="good">Human approval required</Badge>
                  : <Badge tone="bad">Automatic</Badge>}
              </dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-paper-faint">{channel.positioning}</p>
        </Card>

        <Card title="Scoring weights" subtitle="Applied to future scores; existing scores keep the weights they used">
          <WeightsEditor channelId={channel.id} initial={weights} canEdit={user.role !== 'VIEWER'} />
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Editorial rules" subtitle="Enforced in prompts and checked mechanically">
          {style.voice && <p className="mb-3 text-sm text-paper-muted">{style.voice}</p>}
          {style.rules && (
            <ul className="space-y-1 text-sm text-paper-muted">
              {style.rules.map((r) => <li key={r}>· {r}</li>)}
            </ul>
          )}
          {style.bannedPhrases && (
            <div className="mt-3">
              <div className="text-[11px] uppercase tracking-wider text-paper-faint">Banned phrases</div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {style.bannedPhrases.map((p) => <Badge key={p} tone="bad">{p}</Badge>)}
              </div>
            </div>
          )}
        </Card>

        <Card title="Pronunciation dictionary" subtitle={`${pronunciations.length} entries applied before synthesis`}>
          {pronunciations.length === 0 ? <Empty>No entries.</Empty> : (
            <Table head={['Written', 'Spoken', 'Note']}>
              {pronunciations.map((p) => (
                <tr key={p.id}>
                  <td className="py-1.5 pr-4 font-mono text-xs">{p.written}</td>
                  <td className="py-1.5 pr-4 text-xs text-paper-muted">{p.spoken}</td>
                  <td className="py-1.5 pr-4 text-xs text-paper-faint">{p.note ?? '—'}</td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>

      <Card title="Sponsorship pipeline" subtitle="Identified only — this system never contacts anyone">
        {sponsors.length === 0 ? <Empty>No sponsors tracked.</Empty> : (
          <Table head={['Company', 'Category', 'Status', 'Fit', 'Est. value', 'Last contact']}>
            {sponsors.map((s) => (
              <tr key={s.id}>
                <td className="py-2 pr-4">
                  {s.website ? (
                    <a href={s.website} target="_blank" rel="noreferrer noopener" className="text-accent hover:underline">{s.company}</a>
                  ) : s.company}
                </td>
                <td className="py-2 pr-4 text-xs text-paper-muted">{s.category}</td>
                <td className="py-2 pr-4"><Badge>{s.status.replace(/_/g, ' ').toLowerCase()}</Badge></td>
                <td className="tnum py-2 pr-4">{s.fitScore?.toFixed(0) ?? '—'}</td>
                <td className="tnum py-2 pr-4">{s.estimatedValueUsd ? `$${s.estimatedValueUsd.toLocaleString()}` : '—'}</td>
                <td className="py-2 pr-4 text-xs text-paper-faint">{s.lastContactAt?.toISOString().slice(0, 10) ?? 'never'}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}

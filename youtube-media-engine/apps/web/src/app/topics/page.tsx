import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth';
import { getChannel, getTopicRadar } from '@/lib/queries';
import { Card, Badge, Empty, ScoreBar } from '@/components/ui';
import { TopicActions } from './actions-ui';

/**
 * Topic Radar (spec §25).
 *
 * Shows the score AND its per-dimension contributions, because a bare 78/100
 * is not a decision aid. Seeing that a topic scored high mostly on
 * advertiserValue while researchAvailability was marginal is what lets an
 * operator disagree with the machine on an informed basis.
 */
export default async function TopicsPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  const channel = await getChannel();
  if (!channel) return <Card title="No channel configured"><Empty>Run pnpm db:seed.</Empty></Card>;

  const topics = await getTopicRadar(channel.id);
  const canEdit = user.role !== 'VIEWER';

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold">Topic radar</h1>
        <p className="mt-1 text-sm text-paper-faint">
          Scores are rubric judgements weighted by the channel's configured weights — not predictions.
          Minimum to pass: {channel.minimumTopicScore}.
        </p>
      </div>

      {topics.length === 0 ? (
        <Card><Empty>No topics discovered yet. The worker runs discovery every six hours.</Empty></Card>
      ) : (
        <div className="space-y-3">
          {topics.map((topic) => {
            const score = topic.scores[0];
            const contributions = (score?.contributions ?? {}) as Record<string, number>;
            const top = Object.entries(contributions).sort((a, b) => b[1] - a[1]).slice(0, 4);

            return (
              <div key={topic.id} className="rounded-lg border border-ink-line bg-ink-raised p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-semibold">{topic.title}</h3>
                      <Badge tone="accent">{topic.pillar.replace(/_/g, ' ').toLowerCase()}</Badge>
                      <Badge
                        tone={
                          topic.status === 'APPROVED' ? 'good'
                            : topic.status.startsWith('REJECTED') ? 'bad'
                            : topic.status === 'IN_PRODUCTION' ? 'accent'
                            : 'neutral'
                        }
                      >
                        {topic.status.replace(/_/g, ' ').toLowerCase()}
                      </Badge>
                    </div>
                    <p className="mt-1.5 text-sm text-paper-muted">{topic.angle}</p>
                    {topic.discoverySignal && (
                      <p className="mt-1.5 text-xs text-paper-faint">
                        <span className="uppercase tracking-wider">Signal</span> — {topic.discoverySignal}
                      </p>
                    )}
                  </div>

                  <div className="w-52 shrink-0">
                    <div className="flex items-baseline justify-between">
                      <span className="text-[11px] uppercase tracking-wider text-paper-faint">Score</span>
                      <span className="tnum text-xl font-semibold">{topic.latestScore?.toFixed(1) ?? '—'}</span>
                    </div>
                    <div className="mt-1.5"><ScoreBar value={topic.latestScore ?? 0} /></div>
                    {score && (
                      <div className="mt-1 text-[11px] text-paper-faint">
                        monetization {score.monetizationPotential.toFixed(0)} · competition {score.competition.toFixed(0)}
                      </div>
                    )}
                  </div>
                </div>

                {score && (
                  <details className="mt-3 group">
                    <summary className="cursor-pointer text-xs text-paper-faint hover:text-paper-muted">
                      Why this score
                    </summary>
                    <div className="mt-2 space-y-2 rounded border border-ink-line bg-ink p-3">
                      <p className="text-xs text-paper-muted">{score.reasoning}</p>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-paper-faint">
                        {top.map(([dim, val]) => (
                          <span key={dim}>
                            {dim} <span className="tnum text-paper-muted">+{val.toFixed(1)}</span>
                          </span>
                        ))}
                      </div>
                      {score.gateFailureReasons.length > 0 && (
                        <ul className="space-y-0.5 text-[11px] text-bad">
                          {score.gateFailureReasons.map((r) => <li key={r}>· {r}</li>)}
                        </ul>
                      )}
                    </div>
                  </details>
                )}

                {canEdit && (
                  <TopicActions
                    topicId={topic.id}
                    status={topic.status}
                    gatesPassed={score?.gatesPassed ?? false}
                    hasProject={Boolean(topic.videoProject)}
                    projectId={topic.videoProject?.id ?? null}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

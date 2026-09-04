import { notFound, redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth';
import { getVideoReview } from '@/lib/queries';
import { Card, Badge, Empty, Table, money, num, pct, ago } from '@/components/ui';
import { ReviewActions } from './review-actions';
import { TitleList, ThumbnailList } from './packaging-ui';
import { getStorage } from '@yme/storage';
import type { ScriptSection, FactCheckFinding } from '@yme/shared';

export default async function VideoReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  const { id } = await params;
  const p = await getVideoReview(id);
  if (!p) notFound();

  const storage = getStorage();
  const script = p.scripts[0];
  const sections = (script?.sections as unknown as ScriptSection[]) ?? [];
  const findings = (p.factCheck?.findings as unknown as FactCheckFinding[]) ?? [];
  const master = p.renders.find((r) => r.format === 'LONG_FORM_16_9' && r.status === 'COMPLETED');
  const totalCost = p.costRecords.reduce((a, c) => a + c.usd.toNumber(), 0);
  const videoUrl = master?.storageKey ? await storage.signedUrl(master.storageKey) : null;

  const canEdit = user.role !== 'VIEWER';

  return (
    <div className="space-y-6">
      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold">{p.topic.title}</h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
            <Badge tone="accent">{p.stage}</Badge>
            <Badge tone={p.status === 'ACTIVE' || p.status === 'COMPLETED' ? 'good' : 'bad'}>{p.status}</Badge>
            <span className="text-paper-faint">{p.slug}</span>
            <span className="text-paper-faint">· spend {money(totalCost)}</span>
          </div>
          {p.blockedReason && (
            <p className="mt-2 rounded border border-bad/30 bg-bad/10 px-3 py-2 text-xs text-bad">{p.blockedReason}</p>
          )}
        </div>
        {p.qcReport && (
          <div className="rounded-lg border border-ink-line bg-ink-raised px-5 py-3 text-right">
            <div className="text-[11px] uppercase tracking-wider text-paper-faint">QC score</div>
            <div className={`tnum text-2xl font-semibold ${p.qcReport.passed ? 'text-good' : 'text-bad'}`}>
              {p.qcReport.finalScore.toFixed(1)}
            </div>
            <div className="text-[11px] text-paper-faint">min {p.channel.minimumQcScore}</div>
          </div>
        )}
      </div>

      {/* ── Gates ──────────────────────────────────────────────────── */}
      {p.qcReport && (
        <Card title="Quality gates" subtitle="Any FAIL blocks publishing regardless of the numeric score">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
            {[
              ['Fact check', p.qcReport.factCheck],
              ['Copyright', p.qcReport.copyright],
              ['Policy', p.qcReport.policy],
              ['AI disclosure', p.qcReport.aiDisclosure],
            ].map(([label, verdict]) => (
              <div key={label as string} className="rounded border border-ink-line bg-ink px-3 py-2">
                <div className="text-[10px] uppercase tracking-wider text-paper-faint">{label as string}</div>
                <div className={`mt-1 text-sm font-medium ${verdict === 'PASS' ? 'text-good' : verdict === 'WARNING' ? 'text-warn' : 'text-bad'}`}>
                  {verdict as string}
                </div>
              </div>
            ))}
            {[
              ['Script', p.qcReport.scriptQuality],
              ['Retention', p.qcReport.retention],
              ['Visual', p.qcReport.visualQuality],
              ['Originality', p.qcReport.originality],
            ].map(([label, v]) => (
              <div key={label as string} className="rounded border border-ink-line bg-ink px-3 py-2">
                <div className="text-[10px] uppercase tracking-wider text-paper-faint">{label as string}</div>
                <div className="tnum mt-1 text-sm font-medium">{(v as number).toFixed(0)}</div>
              </div>
            ))}
          </div>

          {p.qcReport.blockingReasons.length > 0 && (
            <ul className="mt-4 space-y-1 rounded border border-bad/30 bg-bad/10 p-3 text-xs text-bad">
              {p.qcReport.blockingReasons.map((r) => <li key={r}>· {r}</li>)}
            </ul>
          )}
          {p.qcReport.warnings.length > 0 && (
            <ul className="mt-2 space-y-1 rounded border border-warn/30 bg-warn/10 p-3 text-xs text-warn">
              {p.qcReport.warnings.map((r) => <li key={r}>· {r}</li>)}
            </ul>
          )}
        </Card>
      )}

      {/* ── Video + packaging ──────────────────────────────────────── */}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title="Render" subtitle={master ? `${Math.round(master.durationSeconds ?? 0)}s · ${((master.bytes ?? 0) / 1e6).toFixed(1)} MB · ${master.resolution}` : undefined}>
            {videoUrl ? (
              <video controls preload="metadata" className="w-full rounded border border-ink-line bg-ink" src={videoUrl}>
                <track kind="captions" />
              </video>
            ) : (
              <Empty>No completed render yet.</Empty>
            )}
            {p.renders.filter((r) => r.status === 'FAILED').map((r) => (
              <p key={r.id} className="mt-2 rounded border border-bad/30 bg-bad/10 px-3 py-2 text-xs text-bad">
                {r.format} render failed: {r.error?.slice(0, 220)}
              </p>
            ))}
          </Card>

          {p.storyBrief && (
            <Card title="Story brief">
              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                <Field label="Central question" value={p.storyBrief.centralQuestion} />
                <Field label="Thesis" value={p.storyBrief.thesis} />
                <Field label="Hook" value={p.storyBrief.hook} />
                <Field label="Conflict" value={p.storyBrief.conflict} />
                <Field label="Stakes" value={p.storyBrief.stakes} />
                <Field label="Ending" value={p.storyBrief.ending} />
              </dl>
              <div className="mt-4">
                <div className="text-[11px] uppercase tracking-wider text-paper-faint">Narrative arc</div>
                <ol className="mt-1.5 space-y-1 text-sm">
                  {((p.storyBrief.narrativeArc as Array<{ section: string; purpose: string }>) ?? []).map((s, i) => (
                    <li key={i} className="text-paper-muted">
                      <span className="text-paper">{i + 1}. {s.section}</span> — {s.purpose}
                    </li>
                  ))}
                </ol>
              </div>
            </Card>
          )}

          <Card
            title="Script"
            subtitle={script ? `v${script.version} · ${script.wordCount} words · retention ${script.retentionScore?.toFixed(0) ?? '—'} · quality ${script.qualityScore?.toFixed(0) ?? '—'}` : undefined}
          >
            {sections.length === 0 ? <Empty>No script yet.</Empty> : (
              <div className="space-y-4">
                {sections.map((s) => (
                  <div key={s.id} className="border-l-2 border-ink-line pl-4">
                    <div className="flex items-center gap-2">
                      <h4 className="text-sm font-medium">{s.heading}</h4>
                      <span className="font-mono text-[10px] text-paper-faint">{s.id}</span>
                      {s.claimKeys.length > 0 && <Badge tone="accent">{s.claimKeys.length} claims</Badge>}
                    </div>
                    <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-paper-muted">{s.narration}</p>
                    {s.openLoop && <p className="mt-1 text-xs text-paper-faint">↻ open loop: {s.openLoop}</p>}
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card title="Storyboard" subtitle={`${p.scenes.length} scenes`}>
            {p.scenes.length === 0 ? <Empty>No storyboard yet.</Empty> : (
              <Table head={['#', 'Visual', 'Query', 'Duration', 'Narration']}>
                {p.scenes.map((s) => (
                  <tr key={s.id} className="align-top">
                    <td className="tnum py-2 pr-4 text-paper-faint">{s.index}</td>
                    <td className="py-2 pr-4">
                      <Badge tone={s.visualKind === 'CHART' ? 'good' : 'neutral'}>{s.visualKind}</Badge>
                      {s.asset?.provider === 'mock' && <div className="mt-1"><Badge tone="warn">placeholder</Badge></div>}
                    </td>
                    <td className="py-2 pr-4 text-xs text-paper-faint">{s.visualQuery.slice(0, 60)}</td>
                    <td className="tnum py-2 pr-4">{(s.actualSeconds ?? s.estimatedSeconds).toFixed(1)}s</td>
                    <td className="py-2 pr-4 text-xs text-paper-muted">{s.narration.slice(0, 110)}…</td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>
        </div>

        {/* ── Right rail ───────────────────────────────────────────── */}
        <div className="space-y-6">
          {canEdit && (
            <ReviewActions
              projectId={p.id}
              stage={p.stage}
              qcPassed={p.qcReport?.passed ?? false}
              hasSelectedTitle={p.titleVariants.some((t) => t.isSelected)}
              hasSelectedThumbnail={p.thumbnails.some((t) => t.isSelected)}
              publishingJobs={p.publishingJobs.map((j) => ({ id: j.id, status: j.status, visibility: j.visibility }))}
            />
          )}

          <Card title="Titles" subtitle="Rubric scores, not CTR predictions">
            {p.titleVariants.length === 0 ? <Empty>No titles generated.</Empty> : (
              <TitleList projectId={p.id} canEdit={canEdit} titles={p.titleVariants.map((t) => ({
                id: t.id, text: t.text, rubricScore: t.rubricScore, isSelected: t.isSelected, rationale: t.rationale,
              }))} />
            )}
          </Card>

          <Card title="Thumbnails" subtitle="Rubric scores, not CTR predictions">
            {p.thumbnails.length === 0 ? <Empty>No thumbnail concepts.</Empty> : (
              <ThumbnailList projectId={p.id} canEdit={canEdit} thumbs={await Promise.all(p.thumbnails.map(async (t) => ({
                id: t.id, headline: t.headline, concept: t.concept, rubricScore: t.rubricScore,
                isSelected: t.isSelected, misleadingRisk: t.misleadingRisk,
                url: t.storageKey ? await storage.signedUrl(t.storageKey) : null,
              })))} />
            )}
          </Card>

          <Card title="Cost" subtitle="Actual, from the ledger">
            <div className="space-y-1 text-sm">
              {Object.entries(
                p.costRecords.reduce<Record<string, number>>((acc, c) => {
                  acc[c.stage] = (acc[c.stage] ?? 0) + c.usd.toNumber();
                  return acc;
                }, {}),
              ).map(([stage, v]) => (
                <div key={stage} className="flex justify-between">
                  <span className="text-paper-muted">{stage}</span>
                  <span className="tnum">{money(v)}</span>
                </div>
              ))}
              <div className="mt-2 flex justify-between border-t border-ink-line pt-2 font-medium">
                <span>Total</span><span className="tnum">{money(totalCost)}</span>
              </div>
            </div>
          </Card>
        </div>
      </div>

      {/* ── Fact check ─────────────────────────────────────────────── */}
      <Card
        title="Fact check"
        subtitle={p.factCheck ? `${p.factCheck.verdict} · ${p.factCheck.highRiskCount} high · ${p.factCheck.mediumRiskCount} medium · ${p.factCheck.lowRiskCount} low` : undefined}
        right={p.factCheck && <Badge tone={p.factCheck.verdict === 'PASS' ? 'good' : 'bad'}>{p.factCheck.verdict}</Badge>}
      >
        {findings.length === 0 ? <Empty>No findings.</Empty> : (
          <Table head={['Risk', 'Section', 'Assertion', 'Issue', 'Suggested fix']}>
            {findings.map((f, i) => (
              <tr key={i} className="align-top">
                <td className="py-2 pr-4">
                  <Badge tone={f.risk === 'HIGH' ? 'bad' : f.risk === 'MEDIUM' ? 'warn' : 'neutral'}>{f.risk}</Badge>
                </td>
                <td className="py-2 pr-4 font-mono text-xs text-paper-faint">{f.sectionId}</td>
                <td className="py-2 pr-4 text-xs">{f.assertion.slice(0, 80)}</td>
                <td className="py-2 pr-4 text-xs text-paper-muted">{f.issue}</td>
                <td className="py-2 pr-4 text-xs text-paper-faint">{f.suggestedFix ?? '—'}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {/* ── Sources and claims ─────────────────────────────────────── */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Claims" subtitle={`${p.research?.claims.length ?? 0} extracted`}>
          {!p.research?.claims.length ? <Empty>No claims.</Empty> : (
            <div className="space-y-3">
              {p.research.claims.map((c) => (
                <div key={c.id} className="rounded border border-ink-line bg-ink p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[10px] text-paper-faint">{c.key}</span>
                    <Badge tone={c.confidence === 'HIGH' ? 'good' : c.confidence === 'MEDIUM' ? 'warn' : 'neutral'}>{c.confidence}</Badge>
                    <Badge tone={c.status === 'VERIFIED' ? 'good' : c.status === 'DISPUTED' ? 'warn' : 'bad'}>{c.status}</Badge>
                    <Badge>{c.kind}</Badge>
                    {c.asOf && <span className="text-[11px] text-paper-faint">as of {c.asOf.toISOString().slice(0, 10)}</span>}
                  </div>
                  <p className="mt-1.5 text-sm text-paper-muted">{c.text}</p>
                  <ul className="mt-1.5 space-y-0.5">
                    {c.sourceLinks.map((l) => (
                      <li key={l.sourceId} className="truncate text-[11px]">
                        <a href={l.source.url} target="_blank" rel="noreferrer noopener" className="text-accent hover:underline">
                          {l.source.publisher}
                        </a>
                        <span className="ml-1.5 text-paper-faint">{l.source.tier}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card title="Sources" subtitle={`${p.research?.sources.length ?? 0} retrieved · coverage ${p.research?.coverageScore?.toFixed(0) ?? '—'}`}>
          {!p.research?.sources.length ? <Empty>No sources.</Empty> : (
            <Table head={['Publisher', 'Tier', 'Reliability', 'Status']}>
              {p.research.sources.map((s) => (
                <tr key={s.id}>
                  <td className="max-w-[220px] truncate py-2 pr-4">
                    <a href={s.url} target="_blank" rel="noreferrer noopener" className="text-accent hover:underline">{s.publisher}</a>
                  </td>
                  <td className="py-2 pr-4 text-xs text-paper-faint">{s.tier}</td>
                  <td className="tnum py-2 pr-4">{s.reliability.toFixed(0)}</td>
                  <td className="py-2 pr-4 text-xs">
                    {s.unavailableReason ? <span className="text-warn">{s.unavailableReason.slice(0, 40)}</span> : <span className="text-good">usable</span>}
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>

      {/* ── Copyright + analytics ──────────────────────────────────── */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Asset registry" subtitle="Licence and copyright risk per asset">
          {p.assets.length === 0 ? <Empty>No assets.</Empty> : (
            <Table head={['Kind', 'Provider', 'Licence', 'Risk']}>
              {p.assets.slice(0, 40).map((a) => (
                <tr key={a.id}>
                  <td className="py-2 pr-4 text-xs">{a.kind}</td>
                  <td className="py-2 pr-4 text-xs text-paper-muted">{a.provider}</td>
                  <td className="max-w-[240px] truncate py-2 pr-4 text-xs text-paper-faint">{a.licence ?? '—'}</td>
                  <td className="py-2 pr-4">
                    <Badge tone={a.copyrightRisk === 'NONE' ? 'good' : a.copyrightRisk === 'HIGH' ? 'bad' : 'warn'}>
                      {a.copyrightRisk}
                    </Badge>
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Card>

        <Card title="Analytics" subtitle={p.youtubeVideo ? `${p.youtubeVideo.youtubeId} · ${p.youtubeVideo.visibility}` : 'Not published'}>
          {!p.youtubeVideo?.snapshots.length ? <Empty>No analytics yet.</Empty> : (
            <Table head={['Date', 'Views', 'CTR', 'Avg viewed', 'Subs', 'Revenue']}>
              {p.youtubeVideo.snapshots.slice(0, 10).map((s) => (
                <tr key={s.id}>
                  <td className="py-2 pr-4 text-xs text-paper-muted">{s.asOf.toISOString().slice(0, 10)}</td>
                  <td className="tnum py-2 pr-4">{num(s.views)}</td>
                  <td className="tnum py-2 pr-4">{pct(s.ctr)}</td>
                  <td className="tnum py-2 pr-4">{pct(s.averageViewPercentage)}</td>
                  <td className="tnum py-2 pr-4">{num(s.subscribersGained)}</td>
                  <td className="tnum py-2 pr-4">{money(s.estimatedRevenueUsd)}</td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>

      {p.approvalEvents.length > 0 && (
        <Card title="Approval history">
          <ul className="space-y-2 text-sm">
            {p.approvalEvents.map((e) => (
              <li key={e.id} className="flex gap-3">
                <Badge tone={e.decision === 'APPROVED' ? 'good' : e.decision === 'REJECTED' ? 'bad' : 'warn'}>{e.decision}</Badge>
                <span className="text-paper-muted">{e.user?.email ?? 'system'}</span>
                <span className="text-paper-faint">{ago(e.createdAt)}</span>
                {e.note && <span className="text-paper-faint">— {e.note}</span>}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wider text-paper-faint">{label}</dt>
      <dd className="mt-0.5 text-paper-muted">{value}</dd>
    </div>
  );
}

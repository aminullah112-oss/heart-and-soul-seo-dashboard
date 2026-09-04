'use client';

import { useState, useTransition } from 'react';
import { approveVideo, publishNow, rejectVideo, requestRevision, retryStage } from '@/lib/actions';

export function ReviewActions(props: {
  projectId: string;
  stage: string;
  qcPassed: boolean;
  hasSelectedTitle: boolean;
  hasSelectedThumbnail: boolean;
  publishingJobs: Array<{ id: string; status: string; visibility: string }>;
}) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [note, setNote] = useState('');
  const [visibility, setVisibility] = useState<'PRIVATE' | 'UNLISTED' | 'PUBLIC'>('PRIVATE');
  const [scheduledFor, setScheduledFor] = useState('');
  const [panel, setPanel] = useState<'approve' | 'revise' | 'reject' | null>(null);

  const run = (fn: () => Promise<{ ok: boolean; message: string }>) =>
    start(async () => {
      const r = await fn();
      setMsg({ ok: r.ok, text: r.message });
    });

  const btn = 'rounded border px-3 py-1.5 text-xs transition disabled:opacity-40';
  const blockers: string[] = [];
  if (!props.qcPassed) blockers.push('QC has not passed');
  if (!props.hasSelectedTitle) blockers.push('no title selected');
  if (!props.hasSelectedThumbnail) blockers.push('no thumbnail selected');

  const pendingJob = props.publishingJobs.find((j) => j.status === 'SCHEDULED');

  return (
    <div className="rounded-lg border border-ink-line bg-ink-raised">
      <header className="border-b border-ink-line px-5 py-3">
        <h2 className="text-sm font-semibold">Review decision</h2>
        <p className="mt-0.5 text-xs text-paper-faint">Uploading requires an explicit approval, recorded against your account.</p>
      </header>

      <div className="space-y-3 p-5">
        {blockers.length > 0 && (
          <ul className="rounded border border-warn/30 bg-warn/10 px-3 py-2 text-xs text-warn">
            {blockers.map((b) => <li key={b}>· {b}</li>)}
          </ul>
        )}

        <div className="flex flex-wrap gap-2">
          <button className={`${btn} border-good/40 text-good hover:bg-good/10`}
            disabled={pending || blockers.length > 0}
            onClick={() => setPanel(panel === 'approve' ? null : 'approve')}>
            Approve
          </button>
          <button className={`${btn} border-warn/40 text-warn hover:bg-warn/10`} disabled={pending}
            onClick={() => setPanel(panel === 'revise' ? null : 'revise')}>
            Request revision
          </button>
          <button className={`${btn} border-bad/40 text-bad hover:bg-bad/10`} disabled={pending}
            onClick={() => setPanel(panel === 'reject' ? null : 'reject')}>
            Reject
          </button>
          <button className={`${btn} border-ink-line text-paper-muted hover:bg-ink`} disabled={pending}
            onClick={() => run(() => retryStage(props.projectId, props.stage))}>
            Retry {props.stage}
          </button>
        </div>

        {panel === 'approve' && (
          <div className="space-y-2 rounded border border-ink-line bg-ink p-3">
            <label className="block text-[11px] uppercase tracking-wider text-paper-faint">Visibility</label>
            <select value={visibility} onChange={(e) => setVisibility(e.target.value as typeof visibility)}
              className="w-full rounded border border-ink-line bg-ink-raised px-2 py-1.5 text-xs">
              <option value="PRIVATE">Private (recommended — review on YouTube first)</option>
              <option value="UNLISTED">Unlisted</option>
              <option value="PUBLIC">Public</option>
            </select>
            <label className="block text-[11px] uppercase tracking-wider text-paper-faint">Schedule (optional)</label>
            <input type="datetime-local" value={scheduledFor} onChange={(e) => setScheduledFor(e.target.value)}
              className="w-full rounded border border-ink-line bg-ink-raised px-2 py-1.5 text-xs" />
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)"
              className="w-full rounded border border-ink-line bg-ink-raised px-2 py-1.5 text-xs" />
            <button className={`${btn} w-full border-good/40 text-good hover:bg-good/10`} disabled={pending}
              onClick={() => run(() => approveVideo(props.projectId, { visibility, scheduledFor: scheduledFor || null, note }))}>
              Confirm approval
            </button>
          </div>
        )}

        {panel === 'revise' && (
          <div className="space-y-2 rounded border border-ink-line bg-ink p-3">
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3}
              placeholder="What needs to change? The project returns to the script stage; research is kept."
              className="w-full rounded border border-ink-line bg-ink-raised px-2 py-1.5 text-xs" />
            <button className={`${btn} w-full border-warn/40 text-warn hover:bg-warn/10`} disabled={pending || !note.trim()}
              onClick={() => run(() => requestRevision(props.projectId, note))}>
              Send back for revision
            </button>
          </div>
        )}

        {panel === 'reject' && (
          <div className="space-y-2 rounded border border-ink-line bg-ink p-3">
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Reason"
              className="w-full rounded border border-ink-line bg-ink-raised px-2 py-1.5 text-xs" />
            <button className={`${btn} w-full border-bad/40 text-bad hover:bg-bad/10`} disabled={pending}
              onClick={() => run(() => rejectVideo(props.projectId, note))}>
              Abandon this video
            </button>
          </div>
        )}

        {pendingJob && (
          <div className="rounded border border-accent/30 bg-accent/5 p-3">
            <p className="text-xs text-paper-muted">
              Approved and scheduled as <strong>{pendingJob.visibility}</strong>. The worker uploads it automatically.
            </p>
            <button className={`${btn} mt-2 w-full border-accent/40 text-accent hover:bg-accent/10`} disabled={pending}
              onClick={() => run(() => publishNow(pendingJob.id))}>
              Upload now
            </button>
          </div>
        )}

        {msg && <p className={`text-xs ${msg.ok ? 'text-good' : 'text-bad'}`}>{msg.text}</p>}
      </div>
    </div>
  );
}

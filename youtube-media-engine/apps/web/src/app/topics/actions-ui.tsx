'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { approveTopic, forceApproveTopic, rejectTopic, startProduction } from '@/lib/actions';

export function TopicActions(props: {
  topicId: string;
  status: string;
  gatesPassed: boolean;
  hasProject: boolean;
  projectId: string | null;
}) {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [overrideNote, setOverrideNote] = useState('');
  const [showOverride, setShowOverride] = useState(false);

  const run = (fn: () => Promise<{ ok: boolean; message: string }>) =>
    start(async () => {
      const result = await fn();
      setMessage({ ok: result.ok, text: result.message });
    });

  const btn = 'rounded border border-ink-line px-2.5 py-1 text-xs transition disabled:opacity-40';

  return (
    <div className="mt-3 border-t border-ink-line pt-3">
      <div className="flex flex-wrap items-center gap-2">
        {props.hasProject && props.projectId ? (
          <Link href={`/videos/${props.projectId}`} className={`${btn} border-accent/40 text-accent hover:bg-accent/10`}>
            Open project
          </Link>
        ) : props.status === 'APPROVED' ? (
          <button className={`${btn} border-accent/40 text-accent hover:bg-accent/10`} disabled={pending}
            onClick={() => run(() => startProduction(props.topicId))}>
            Start production
          </button>
        ) : (
          <>
            <button className={`${btn} border-good/40 text-good hover:bg-good/10`} disabled={pending}
              onClick={() => run(() => approveTopic(props.topicId))}>
              Approve
            </button>
            <button className={`${btn} hover:bg-ink`} disabled={pending}
              onClick={() => run(() => rejectTopic(props.topicId))}>
              Reject
            </button>
            {!props.gatesPassed && (
              <button className={`${btn} border-warn/40 text-warn hover:bg-warn/10`} disabled={pending}
                onClick={() => setShowOverride((v) => !v)}>
                Approve anyway…
              </button>
            )}
          </>
        )}
        {pending && <span className="text-xs text-paper-faint">working…</span>}
      </div>

      {showOverride && (
        <div className="mt-2 flex gap-2">
          <input
            value={overrideNote}
            onChange={(e) => setOverrideNote(e.target.value)}
            placeholder="Why are you overriding the score gate? (recorded in the audit log)"
            className="flex-1 rounded border border-ink-line bg-ink px-2.5 py-1.5 text-xs outline-none focus:border-warn"
          />
          <button className={`${btn} border-warn/40 text-warn hover:bg-warn/10`} disabled={pending || !overrideNote.trim()}
            onClick={() => run(() => forceApproveTopic(props.topicId, overrideNote))}>
            Confirm override
          </button>
        </div>
      )}

      {message && (
        <p className={`mt-2 text-xs ${message.ok ? 'text-good' : 'text-bad'}`}>{message.text}</p>
      )}
    </div>
  );
}

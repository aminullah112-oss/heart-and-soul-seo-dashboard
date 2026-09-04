'use client';

import { useState, useTransition } from 'react';
import { updateScoringWeights } from '@/lib/actions';

export function WeightsEditor(props: { channelId: string; initial: Record<string, number>; canEdit: boolean }) {
  const [weights, setWeights] = useState(props.initial);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const total = Object.values(weights).reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-2">
      {Object.entries(weights).map(([dim, value]) => (
        <div key={dim} className="flex items-center gap-3">
          <label htmlFor={dim} className="w-44 shrink-0 text-xs text-paper-muted">
            {dim}
            {dim === 'competition' && <span className="ml-1 text-paper-faint">(inverted)</span>}
          </label>
          <input
            id={dim} type="range" min={0} max={0.3} step={0.01} value={value} disabled={!props.canEdit}
            onChange={(e) => setWeights({ ...weights, [dim]: Number(e.target.value) })}
            className="h-1 flex-1 accent-accent"
          />
          <span className="tnum w-16 text-right text-xs text-paper-faint">
            {((value / (total || 1)) * 100).toFixed(1)}%
          </span>
        </div>
      ))}

      {props.canEdit && (
        <div className="flex items-center gap-3 pt-2">
          <button
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await updateScoringWeights(props.channelId, weights);
                setMsg({ ok: r.ok, text: r.message });
              })
            }
            className="rounded border border-accent/40 px-3 py-1.5 text-xs text-accent transition hover:bg-accent/10 disabled:opacity-40"
          >
            {pending ? 'Saving…' : 'Save weights'}
          </button>
          <button
            onClick={() => setWeights(props.initial)}
            className="rounded border border-ink-line px-3 py-1.5 text-xs text-paper-muted hover:bg-ink"
          >
            Reset
          </button>
          {msg && <span className={`text-xs ${msg.ok ? 'text-good' : 'text-bad'}`}>{msg.text}</span>}
        </div>
      )}
    </div>
  );
}

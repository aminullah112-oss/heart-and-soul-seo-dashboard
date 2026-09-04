'use client';

import { useState, useTransition } from 'react';
import { selectTitle, selectThumbnail } from '@/lib/actions';

export function TitleList(props: {
  projectId: string;
  canEdit: boolean;
  titles: Array<{ id: string; text: string; rubricScore: number; isSelected: boolean; rationale: string }>;
}) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  return (
    <div className="space-y-1.5">
      {props.titles.map((t) => (
        <button
          key={t.id}
          disabled={!props.canEdit || pending}
          onClick={() =>
            start(async () => {
              const r = await selectTitle(props.projectId, t.id);
              setMsg(r.message);
            })
          }
          title={t.rationale}
          className={`block w-full rounded border px-3 py-2 text-left text-sm transition disabled:cursor-default ${
            t.isSelected ? 'border-accent bg-accent/10' : 'border-ink-line bg-ink hover:border-accent/40'
          }`}
        >
          <div className="flex items-start justify-between gap-3">
            <span className={t.isSelected ? 'text-paper' : 'text-paper-muted'}>{t.text}</span>
            <span className="tnum shrink-0 text-xs text-paper-faint">{t.rubricScore.toFixed(0)}</span>
          </div>
          <div className="mt-0.5 text-[11px] text-paper-faint">{t.text.length}/100 chars</div>
        </button>
      ))}
      {msg && <p className="text-xs text-good">{msg}</p>}
    </div>
  );
}

export function ThumbnailList(props: {
  projectId: string;
  canEdit: boolean;
  thumbs: Array<{
    id: string; headline: string; concept: string; rubricScore: number;
    isSelected: boolean; misleadingRisk: string; url: string | null;
  }>;
}) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  return (
    <div className="space-y-2">
      {props.thumbs.map((t) => (
        <button
          key={t.id}
          disabled={!props.canEdit || pending}
          onClick={() =>
            start(async () => {
              const r = await selectThumbnail(props.projectId, t.id);
              setMsg(r.message);
            })
          }
          className={`block w-full overflow-hidden rounded border text-left transition disabled:cursor-default ${
            t.isSelected ? 'border-accent' : 'border-ink-line hover:border-accent/40'
          }`}
        >
          {t.url && (
            <img src={t.url} alt={t.headline} className="w-full" loading="lazy" />
          )}
          <div className="bg-ink px-3 py-2">
            <div className="flex items-start justify-between gap-3">
              <span className="text-sm font-medium">{t.headline}</span>
              <span className="tnum shrink-0 text-xs text-paper-faint">{t.rubricScore.toFixed(0)}</span>
            </div>
            <p className="mt-0.5 text-[11px] text-paper-faint">{t.concept}</p>
            {t.misleadingRisk !== 'NONE' && (
              <p className="mt-1 text-[11px] text-warn">misleading risk: {t.misleadingRisk}</p>
            )}
          </div>
        </button>
      ))}
      {msg && <p className="text-xs text-good">{msg}</p>}
    </div>
  );
}

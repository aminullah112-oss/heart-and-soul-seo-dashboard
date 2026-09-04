import Link from 'next/link';
import type { ReactNode } from 'react';

export function Card({ title, subtitle, children, right }: { title?: string; subtitle?: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="rounded-lg border border-ink-line bg-ink-raised">
      {(title || right) && (
        <header className="flex items-start justify-between gap-4 border-b border-ink-line px-5 py-3">
          <div>
            {title && <h2 className="text-sm font-semibold">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-paper-faint">{subtitle}</p>}
          </div>
          {right}
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: string; tone?: 'good' | 'warn' | 'bad' }) {
  const toneClass = tone === 'good' ? 'text-good' : tone === 'warn' ? 'text-warn' : tone === 'bad' ? 'text-bad' : 'text-paper';
  return (
    <div className="rounded-lg border border-ink-line bg-ink-raised px-5 py-4">
      <div className="text-[11px] uppercase tracking-wider text-paper-faint">{label}</div>
      <div className={`tnum mt-1 text-2xl font-semibold ${toneClass}`}>{value}</div>
      {hint && <div className="mt-1 text-xs text-paper-faint">{hint}</div>}
    </div>
  );
}

const BADGE_TONES: Record<string, string> = {
  neutral: 'bg-ink text-paper-muted border-ink-line',
  good: 'bg-good/10 text-good border-good/30',
  warn: 'bg-warn/10 text-warn border-warn/30',
  bad: 'bg-bad/10 text-bad border-bad/30',
  accent: 'bg-accent/10 text-accent border-accent/30',
};

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: keyof typeof BADGE_TONES }) {
  return (
    <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] font-medium ${BADGE_TONES[tone]}`}>
      {children}
    </span>
  );
}

export function ScoreBar({ value, max = 100 }: { value: number; max?: number }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const tone = pct >= 75 ? 'bg-good' : pct >= 50 ? 'bg-warn' : 'bg-bad';
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink">
      <div className={`h-full rounded-full ${tone}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-sm text-paper-faint">{children}</p>;
}

export function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b border-ink-line text-left text-[11px] uppercase tracking-wider text-paper-faint">
            {head.map((h) => (
              <th key={h} className="pb-2 pr-4 font-medium">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-ink-line/60">{children}</tbody>
      </table>
    </div>
  );
}

export function LinkCell({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="text-accent hover:underline">
      {children}
    </Link>
  );
}

export function money(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return `$${n.toFixed(n < 1 ? 4 : 2)}`;
}

export function num(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined) return '—';
  return n.toLocaleString(undefined, { maximumFractionDigits: digits });
}

export function pct(n: number | null | undefined): string {
  return n === null || n === undefined ? '—' : `${n.toFixed(1)}%`;
}

export function ago(d: Date | string | null | undefined): string {
  if (!d) return '—';
  const ms = Date.now() - new Date(d).getTime();
  const mins = Math.round(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

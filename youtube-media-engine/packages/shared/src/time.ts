export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** "8m 32s" for logs and dashboard cells. */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rem = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${rem}s`;
  return `${rem}s`;
}

/** "00:01:23.450" — ffmpeg / chapter timestamps. */
export function toTimecode(seconds: number, opts: { millis?: boolean; comma?: boolean } = {}): string {
  const total = Math.max(0, seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = Math.floor(total % 60);
  const ms = Math.round((total - Math.floor(total)) * 1000);
  const base = `${pad(h)}:${pad(m)}:${pad(s)}`;
  if (!opts.millis) return base;
  return `${base}${opts.comma ? ',' : '.'}${String(ms).padStart(3, '0')}`;
}

/** YouTube chapter format: 0:00 / 12:34 / 1:02:03 */
export function toChapterStamp(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

const pad = (n: number) => String(n).padStart(2, '0');

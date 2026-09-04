import { theme } from './theme.js';

/** XML-escape. Company names contain ampersands; unescaped they break the SVG. */
export function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Approximate text width.
 *
 * SVG has no layout engine available to us before rasterisation, so line
 * breaking has to be estimated. The ratios below are measured against DejaVu
 * Sans at the weights used here. They are deliberately slightly generous —
 * over-estimating width wraps a line early, which looks fine; under-estimating
 * pushes text past the frame edge, which does not.
 */
const AVG_CHAR_RATIO = { normal: 0.55, bold: 0.6 } as const;

export function estimateTextWidth(text: string, fontSize: number, weight: 'normal' | 'bold' = 'normal'): number {
  // Wide and narrow characters differ enough to be worth correcting for.
  let units = 0;
  for (const ch of text) {
    if (/[ilj'.,:;|!\[\]]/.test(ch)) units += 0.42;
    else if (/[A-Z0-9@#%&WM]/.test(ch)) units += 1.15;
    else units += 1;
  }
  return units * fontSize * AVG_CHAR_RATIO[weight];
}

export function wrapText(
  text: string,
  maxWidth: number,
  fontSize: number,
  weight: 'normal' | 'bold' = 'normal',
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (estimateTextWidth(candidate, fontSize, weight) > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

export interface TextBlockOptions {
  x: number;
  y: number;
  fontSize: number;
  lineHeight?: number;
  fill?: string;
  weight?: 'normal' | 'bold';
  anchor?: 'start' | 'middle' | 'end';
  maxWidth?: number;
  maxLines?: number;
  letterSpacing?: number;
}

export function textBlock(text: string, o: TextBlockOptions): string {
  const weight = o.weight ?? 'normal';
  const lineHeight = o.lineHeight ?? o.fontSize * 1.3;
  let lines = o.maxWidth ? wrapText(text, o.maxWidth, o.fontSize, weight) : [text];

  if (o.maxLines && lines.length > o.maxLines) {
    lines = lines.slice(0, o.maxLines);
    const last = lines[lines.length - 1]!;
    lines[lines.length - 1] = `${last.replace(/[\s,.;:]+$/, '')}…`;
  }

  return lines
    .map(
      (line, i) =>
        `<text x="${o.x}" y="${o.y + i * lineHeight}" fill="${o.fill ?? theme.text}" ` +
        `font-family="${theme.fontStack}" font-size="${o.fontSize}" font-weight="${weight}" ` +
        `text-anchor="${o.anchor ?? 'start'}"` +
        (o.letterSpacing ? ` letter-spacing="${o.letterSpacing}"` : '') +
        `>${esc(line)}</text>`,
    )
    .join('\n');
}

export function svgDocument(width: number, height: number, body: string, background = theme.bg): string {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<rect width="${width}" height="${height}" fill="${background}"/>`,
    body,
    '</svg>',
  ].join('\n');
}

/** Transparent overlay document — used for lower thirds composited over footage. */
export function svgOverlay(width: number, height: number, body: string): string {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    body,
    '</svg>',
  ].join('\n');
}

/** Human-readable axis numbers: 1500000 -> "1.5M". */
export function formatAxisValue(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1e12) return `${trim(v / 1e12)}T`;
  if (abs >= 1e9) return `${trim(v / 1e9)}B`;
  if (abs >= 1e6) return `${trim(v / 1e6)}M`;
  if (abs >= 1e3) return `${trim(v / 1e3)}K`;
  return trim(v);
}

function trim(n: number): string {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

/**
 * "Nice" axis ticks — round numbers a viewer can read at a glance rather than
 * 7 evenly spaced values ending in .3333.
 */
export function niceScale(min: number, max: number, targetTicks = 5): { min: number; max: number; step: number; ticks: number[] } {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1, step: 1, ticks: [0, 1] };
  if (min === max) {
    const pad = Math.abs(min) * 0.1 || 1;
    min -= pad;
    max += pad;
  }
  const range = max - min;
  const rawStep = range / Math.max(1, targetTicks);
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalised = rawStep / magnitude;
  const stepMultiplier = normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 5 ? 5 : 10;
  const step = stepMultiplier * magnitude;

  const niceMin = Math.floor(min / step) * step;
  const niceMax = Math.ceil(max / step) * step;

  const ticks: number[] = [];
  // Deriving each tick from the index avoids compounding error, but binary
  // floating point still cannot represent 0.2 exactly, so 3 * 0.2 lands on
  // 0.6000000000000001. Round to the precision the step itself implies.
  const decimals = Math.max(0, Math.min(10, -Math.floor(Math.log10(step)) + 1));
  const count = Math.round((niceMax - niceMin) / step);
  for (let i = 0; i <= count; i++) ticks.push(Number((niceMin + i * step).toFixed(decimals)));

  return { min: niceMin, max: niceMax, step, ticks };
}

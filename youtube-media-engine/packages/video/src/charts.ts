import type { ChartSpec } from '@yme/shared';
import { theme, type Dimensions } from './theme.js';
import { esc, formatAxisValue, niceScale, svgDocument, textBlock, estimateTextWidth } from './svg.js';

/**
 * Data visualisation engine (spec §16).
 *
 * Every chart carries its unit and its source note in the frame. A chart
 * without units is misleading and a chart without a source is unciteable, and
 * both are the kind of thing that only gets noticed in the comments.
 *
 * The renderer draws exactly the numbers it is given. It has no ability to
 * invent, interpolate or extend a series — the upstream validator in
 * @yme/agents/visual-director is what guarantees those numbers trace to a
 * claim, and this stage would happily render nonsense if handed nonsense.
 */

export interface ChartRenderOptions extends Dimensions {
  /** Rendered as a footer line, e.g. "Source: SEC filings". */
  sourceNote: string;
}

export function renderChartSvg(spec: ChartSpec, opts: ChartRenderOptions): string {
  switch (spec.type) {
    case 'bar':
    case 'stacked-bar':
      return barChart(spec, opts);
    case 'line':
    case 'area':
      return lineChart(spec, opts);
    case 'donut':
      return donutChart(spec, opts);
  }
}

interface Frame {
  padLeft: number;
  padRight: number;
  padTop: number;
  padBottom: number;
  plotWidth: number;
  plotHeight: number;
  titleY: number;
}

function frameFor(opts: ChartRenderOptions, hasSubtitle: boolean): Frame {
  const scale = opts.width / 1920;
  const padLeft = 190 * scale;
  const padRight = 110 * scale;
  const padTop = (hasSubtitle ? 250 : 205) * scale;
  // Bottom band holds three stacked rows: category labels, legend, source note.
  // 175 was too tight and the legend overlapped the axis labels.
  const padBottom = 232 * scale;
  return {
    padLeft,
    padRight,
    padTop,
    padBottom,
    plotWidth: opts.width - padLeft - padRight,
    plotHeight: opts.height - padTop - padBottom,
    titleY: 105 * scale,
  };
}

function header(spec: ChartSpec, opts: ChartRenderOptions, f: Frame): string {
  const scale = opts.width / 1920;
  const parts = [
    textBlock(spec.title, {
      x: f.padLeft,
      y: f.titleY,
      fontSize: 52 * scale,
      weight: 'bold',
      maxWidth: f.plotWidth,
      maxLines: 1,
    }),
  ];
  if (spec.subtitle) {
    parts.push(
      textBlock(spec.subtitle, {
        x: f.padLeft,
        y: f.titleY + 52 * scale,
        fontSize: 30 * scale,
        fill: theme.textMuted,
        maxWidth: f.plotWidth,
        maxLines: 1,
      }),
    );
  }
  parts.push(
    textBlock(spec.unit, {
      x: f.padLeft,
      y: f.padTop - 30 * scale,
      fontSize: 25 * scale,
      fill: theme.textFaint,
      maxLines: 1,
    }),
  );
  parts.push(
    textBlock(opts.sourceNote, {
      x: f.padLeft,
      y: opts.height - 46 * scale,
      fontSize: 24 * scale,
      fill: theme.textFaint,
      maxWidth: opts.width - f.padLeft - f.padRight,
      maxLines: 1,
    }),
  );
  return parts.join('\n');
}

function legend(spec: ChartSpec, opts: ChartRenderOptions, f: Frame): string {
  if (spec.series.length < 2) return '';
  const scale = opts.width / 1920;
  const fontSize = 26 * scale;
  const swatch = 20 * scale;
  let x = f.padLeft;
  const y = opts.height - 112 * scale;
  const out: string[] = [];

  for (const [i, s] of spec.series.entries()) {
    const colour = theme.series[i % theme.series.length]!;
    out.push(
      `<rect x="${x}" y="${y - swatch * 0.8}" width="${swatch}" height="${swatch}" rx="${swatch * 0.2}" fill="${colour}"/>`,
    );
    out.push(
      `<text x="${x + swatch * 1.6}" y="${y}" fill="${theme.textMuted}" font-family="${theme.fontStack}" font-size="${fontSize}">${esc(s.name)}</text>`,
    );
    x += swatch * 1.6 + estimateTextWidth(s.name, fontSize) + 46 * scale;
  }
  return out.join('\n');
}

function gridAndAxis(
  ticks: number[],
  min: number,
  max: number,
  opts: ChartRenderOptions,
  f: Frame,
): string {
  const scale = opts.width / 1920;
  const out: string[] = [];
  const range = max - min || 1;

  for (const t of ticks) {
    const y = f.padTop + f.plotHeight - ((t - min) / range) * f.plotHeight;
    // The zero line is emphasised: it is the only gridline that changes meaning.
    const isZero = Math.abs(t) < 1e-9;
    out.push(
      `<line x1="${f.padLeft}" y1="${y}" x2="${f.padLeft + f.plotWidth}" y2="${y}" ` +
        `stroke="${isZero ? theme.axis : theme.grid}" stroke-width="${isZero ? 2 * scale : 1 * scale}"/>`,
    );
    out.push(
      `<text x="${f.padLeft - 22 * scale}" y="${y + 9 * scale}" fill="${theme.textFaint}" ` +
        `font-family="${theme.fontStack}" font-size="${26 * scale}" text-anchor="end">${esc(formatAxisValue(t))}</text>`,
    );
  }
  return out.join('\n');
}

function barChart(spec: ChartSpec, opts: ChartRenderOptions): string {
  const f = frameFor(opts, Boolean(spec.subtitle));
  const scale = opts.width / 1920;
  const stacked = spec.type === 'stacked-bar';

  const labels = spec.series[0]?.points.map((p) => p.label) ?? [];
  const groupCount = labels.length || 1;

  const values = stacked
    ? labels.map((_, i) => spec.series.reduce((sum, s) => sum + (s.points[i]?.value ?? 0), 0))
    : spec.series.flatMap((s) => s.points.map((p) => p.value));

  const { min, max, ticks } = niceScale(Math.min(0, ...values), Math.max(...values, 0));
  const range = max - min || 1;

  const slot = f.plotWidth / groupCount;
  const barGap = slot * 0.28;
  const usable = slot - barGap;
  const barWidth = stacked ? usable : usable / Math.max(1, spec.series.length);

  const bars: string[] = [];
  const yOf = (v: number) => f.padTop + f.plotHeight - ((v - min) / range) * f.plotHeight;
  const zeroY = yOf(0);

  for (let g = 0; g < groupCount; g++) {
    const groupX = f.padLeft + g * slot + barGap / 2;

    if (stacked) {
      let cursor = 0;
      for (const [si, s] of spec.series.entries()) {
        const v = s.points[g]?.value ?? 0;
        const top = yOf(cursor + v);
        const bottom = yOf(cursor);
        cursor += v;
        bars.push(
          `<rect x="${groupX}" y="${Math.min(top, bottom)}" width="${barWidth}" ` +
            `height="${Math.max(1, Math.abs(bottom - top))}" fill="${theme.series[si % theme.series.length]}"/>`,
        );
      }
      bars.push(
        `<text x="${groupX + barWidth / 2}" y="${yOf(cursor) - 18 * scale}" fill="${theme.text}" ` +
          `font-family="${theme.fontStack}" font-size="${27 * scale}" font-weight="bold" text-anchor="middle">` +
          `${esc(formatAxisValue(cursor))}</text>`,
      );
    } else {
      for (const [si, s] of spec.series.entries()) {
        const v = s.points[g]?.value ?? 0;
        const x = groupX + si * barWidth;
        const y = yOf(v);
        const h = Math.max(1, Math.abs(zeroY - y));
        bars.push(
          `<rect x="${x}" y="${Math.min(y, zeroY)}" width="${barWidth * 0.86}" height="${h}" ` +
            `rx="${3 * scale}" fill="${theme.series[si % theme.series.length]}"/>`,
        );
        // Value labels only when there is room; otherwise they collide.
        if (spec.series.length <= 2 && groupCount <= 12) {
          bars.push(
            `<text x="${x + barWidth * 0.43}" y="${Math.min(y, zeroY) - 16 * scale}" fill="${theme.text}" ` +
              `font-family="${theme.fontStack}" font-size="${26 * scale}" text-anchor="middle">` +
              `${esc(formatAxisValue(v))}</text>`,
          );
        }
      }
    }

    const label = labels[g] ?? '';
    bars.push(
      `<text x="${groupX + usable / 2}" y="${f.padTop + f.plotHeight + 44 * scale}" fill="${theme.textMuted}" ` +
        `font-family="${theme.fontStack}" font-size="${27 * scale}" text-anchor="middle">${esc(label)}</text>`,
    );
  }

  return svgDocument(
    opts.width,
    opts.height,
    [header(spec, opts, f), gridAndAxis(ticks, min, max, opts, f), bars.join('\n'), legend(spec, opts, f)].join('\n'),
  );
}

function lineChart(spec: ChartSpec, opts: ChartRenderOptions): string {
  const f = frameFor(opts, Boolean(spec.subtitle));
  const scale = opts.width / 1920;
  const area = spec.type === 'area';

  const values = spec.series.flatMap((s) => s.points.map((p) => p.value));
  const { min, max, ticks } = niceScale(Math.min(...values), Math.max(...values));
  const range = max - min || 1;

  const labels = spec.series[0]?.points.map((p) => p.label) ?? [];
  const n = Math.max(2, labels.length);
  const xOf = (i: number) => f.padLeft + (i / (n - 1)) * f.plotWidth;
  const yOf = (v: number) => f.padTop + f.plotHeight - ((v - min) / range) * f.plotHeight;

  const paths: string[] = [];
  for (const [si, s] of spec.series.entries()) {
    const colour = theme.series[si % theme.series.length]!;
    const pts = s.points.map((p, i) => `${xOf(i)},${yOf(p.value)}`);
    if (pts.length < 2) continue;

    if (area) {
      paths.push(
        `<path d="M ${xOf(0)},${yOf(min)} L ${pts.join(' L ')} L ${xOf(s.points.length - 1)},${yOf(min)} Z" ` +
          `fill="${colour}" fill-opacity="0.16"/>`,
      );
    }
    paths.push(
      `<polyline points="${pts.join(' ')}" fill="none" stroke="${colour}" stroke-width="${5 * scale}" ` +
        `stroke-linejoin="round" stroke-linecap="round"/>`,
    );
    for (const [i, p] of s.points.entries()) {
      paths.push(`<circle cx="${xOf(i)}" cy="${yOf(p.value)}" r="${7 * scale}" fill="${theme.bg}" stroke="${colour}" stroke-width="${4 * scale}"/>`);
    }
    // Label the final point: the viewer's eye ends there.
    const last = s.points.at(-1);
    if (last) {
      paths.push(
        `<text x="${xOf(s.points.length - 1)}" y="${yOf(last.value) - 24 * scale}" fill="${theme.text}" ` +
          `font-family="${theme.fontStack}" font-size="${28 * scale}" font-weight="bold" text-anchor="end">` +
          `${esc(formatAxisValue(last.value))}</text>`,
      );
    }
  }

  const xLabels = labels.map(
    (l, i) =>
      `<text x="${xOf(i)}" y="${f.padTop + f.plotHeight + 44 * scale}" fill="${theme.textMuted}" ` +
      `font-family="${theme.fontStack}" font-size="${27 * scale}" text-anchor="middle">${esc(l)}</text>`,
  );

  return svgDocument(
    opts.width,
    opts.height,
    [
      header(spec, opts, f),
      gridAndAxis(ticks, min, max, opts, f),
      paths.join('\n'),
      xLabels.join('\n'),
      legend(spec, opts, f),
    ].join('\n'),
  );
}

function donutChart(spec: ChartSpec, opts: ChartRenderOptions): string {
  const f = frameFor(opts, Boolean(spec.subtitle));
  const scale = opts.width / 1920;
  const points = spec.series[0]?.points ?? [];
  const total = points.reduce((a, p) => a + Math.max(0, p.value), 0);

  const cx = f.padLeft + f.plotWidth * 0.32;
  const cy = f.padTop + f.plotHeight / 2;
  const outer = Math.min(f.plotHeight, f.plotWidth * 0.5) / 2;
  const inner = outer * 0.58;

  const segments: string[] = [];
  const rows: string[] = [];
  let angle = -Math.PI / 2;

  for (const [i, p] of points.entries()) {
    const fraction = total > 0 ? Math.max(0, p.value) / total : 0;
    const sweep = fraction * Math.PI * 2;
    const colour = theme.series[i % theme.series.length]!;

    if (fraction > 0.0001) {
      segments.push(donutSegment(cx, cy, inner, outer, angle, angle + sweep, colour));
    }
    angle += sweep;

    const rowY = f.padTop + 46 * scale + i * 56 * scale;
    const legendX = f.padLeft + f.plotWidth * 0.6;
    const labelX = legendX + 44 * scale;
    const valueText = `${formatAxisValue(p.value)} (${(fraction * 100).toFixed(1)}%)`;
    const valueWidth = estimateTextWidth(valueText, 30 * scale);
    // The value is right-aligned to the frame edge, so the label has to be
    // clipped to whatever is left. Without this, a long segment name renders
    // straight through the number.
    const labelWidth = opts.width - f.padRight - valueWidth - labelX - 28 * scale;
    rows.push(
      `<rect x="${legendX}" y="${rowY - 22 * scale}" width="${26 * scale}" height="${26 * scale}" rx="${5 * scale}" fill="${colour}"/>`,
      textBlock(p.label, { x: labelX, y: rowY, fontSize: 30 * scale, maxWidth: Math.max(80 * scale, labelWidth), maxLines: 1 }),
      `<text x="${opts.width - f.padRight}" y="${rowY}" fill="${theme.textMuted}" font-family="${theme.fontStack}" ` +
        `font-size="${30 * scale}" text-anchor="end">${esc(valueText)}</text>`,
    );
  }

  return svgDocument(opts.width, opts.height, [header(spec, opts, f), segments.join('\n'), rows.join('\n')].join('\n'));
}

function donutSegment(cx: number, cy: number, r0: number, r1: number, a0: number, a1: number, fill: string): string {
  // A full circle cannot be expressed as a single arc — the start and end
  // points coincide and the path collapses. Two half-arcs instead.
  if (a1 - a0 >= Math.PI * 2 - 1e-6) {
    return (
      `<path d="M ${cx - r1} ${cy} A ${r1} ${r1} 0 1 1 ${cx + r1} ${cy} A ${r1} ${r1} 0 1 1 ${cx - r1} ${cy} Z ` +
      `M ${cx - r0} ${cy} A ${r0} ${r0} 0 1 0 ${cx + r0} ${cy} A ${r0} ${r0} 0 1 0 ${cx - r0} ${cy} Z" ` +
      `fill="${fill}" fill-rule="evenodd"/>`
    );
  }
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const p = (r: number, a: number) => `${(cx + r * Math.cos(a)).toFixed(2)} ${(cy + r * Math.sin(a)).toFixed(2)}`;
  return (
    `<path d="M ${p(r1, a0)} A ${r1} ${r1} 0 ${large} 1 ${p(r1, a1)} L ${p(r0, a1)} ` +
    `A ${r0} ${r0} 0 ${large} 0 ${p(r0, a0)} Z" fill="${fill}"/>`
  );
}

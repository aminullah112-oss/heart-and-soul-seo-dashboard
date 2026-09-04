import { describe, it, expect } from 'vitest';
import { niceScale, formatAxisValue, wrapText, estimateTextWidth, esc } from '../svg.js';
import { renderChartSvg } from '../charts.js';
import type { ChartSpec } from '@yme/shared';

describe('axis scaling', () => {
  it('produces round tick values a viewer can read', () => {
    const { ticks } = niceScale(0, 47.5);
    expect(ticks).toEqual([0, 10, 20, 30, 40, 50]);
  });

  it('does not accumulate floating point drift across ticks', () => {
    const { ticks } = niceScale(0, 1);
    for (const t of ticks) expect(Number(t.toFixed(10))).toBe(t);
  });

  it('handles a flat series without collapsing the axis', () => {
    const { min, max } = niceScale(5, 5);
    expect(max).toBeGreaterThan(min);
  });

  it('handles negative ranges', () => {
    const { min, max, ticks } = niceScale(-40, 20);
    expect(min).toBeLessThanOrEqual(-40);
    expect(max).toBeGreaterThanOrEqual(20);
    expect(ticks).toContain(0);
  });

  it('survives non-finite input rather than emitting NaN coordinates', () => {
    const { ticks } = niceScale(Number.NaN, Number.POSITIVE_INFINITY);
    for (const t of ticks) expect(Number.isFinite(t)).toBe(true);
  });
});

describe('axis formatting', () => {
  it('abbreviates magnitudes', () => {
    expect(formatAxisValue(1_500_000_000)).toBe('1.5B');
    expect(formatAxisValue(2_000_000)).toBe('2M');
    expect(formatAxisValue(47.5)).toBe('47.5');
  });
});

describe('text layout', () => {
  it('wraps on word boundaries within the width budget', () => {
    const lines = wrapText('How NVIDIA turned a gaming chip into the AI toll booth', 300, 40);
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines) expect(estimateTextWidth(l, 40)).toBeLessThanOrEqual(320);
  });

  it('escapes XML so a company name with an ampersand cannot break the document', () => {
    expect(esc('Procter & Gamble "P&G"')).toBe('Procter &amp; Gamble &quot;P&amp;G&quot;');
  });
});

describe('chart rendering', () => {
  const spec: ChartSpec = {
    type: 'bar',
    title: 'Reported data-centre revenue',
    subtitle: 'By fiscal year',
    unit: 'USD billions',
    series: [{ name: 'Data centre', points: [
      { label: 'FY22', value: 10.6 }, { label: 'FY23', value: 15 }, { label: 'FY24', value: 47.5 },
    ] }],
    sourceClaimKey: 'nvda-dc',
    sourceNote: 'Source: company filings',
  };

  it('always renders the unit and the source note in frame', () => {
    // A chart without units is misleading and one without a source is
    // unciteable. Both must be non-optional in the output.
    const svg = renderChartSvg(spec, { width: 1920, height: 1080, sourceNote: 'Source: SEC 10-K' });
    expect(svg).toContain('USD billions');
    expect(svg).toContain('Source: SEC 10-K');
  });

  it('emits no NaN coordinates for any chart type', () => {
    for (const type of ['bar', 'line', 'area', 'stacked-bar', 'donut'] as const) {
      const svg = renderChartSvg({ ...spec, type }, { width: 1920, height: 1080, sourceNote: 'Source: test' });
      expect(svg, `${type} chart emitted NaN`).not.toMatch(/NaN/);
      expect(svg.startsWith('<svg')).toBe(true);
    }
  });

  it('renders a full-circle donut without collapsing the arc path', () => {
    // A single 100% segment cannot be drawn as one arc: start and end points
    // coincide and the path disappears.
    const svg = renderChartSvg(
      { ...spec, type: 'donut', series: [{ name: 'All', points: [{ label: 'Only', value: 100 }, { label: 'None', value: 0 }] }] },
      { width: 1920, height: 1080, sourceNote: 'Source: test' },
    );
    expect(svg).toContain('fill-rule="evenodd"');
    expect(svg).not.toMatch(/NaN/);
  });

  it('scales cleanly to 4K', () => {
    const svg = renderChartSvg(spec, { width: 3840, height: 2160, sourceNote: 'Source: test' });
    expect(svg).toContain('width="3840"');
    expect(svg).not.toMatch(/NaN/);
  });
});

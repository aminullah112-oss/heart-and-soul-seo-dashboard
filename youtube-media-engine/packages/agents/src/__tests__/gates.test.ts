import { describe, it, expect } from 'vitest';
import { validateChart, splitLongScenes, MAX_SCENE_SECONDS } from '../visual-director.js';
import { assessCopyright, assessVisualQuality } from '../qc.js';
import { scoreScriptQuality } from '../scriptwriter.js';
import { deriveChapters } from '../packaging.js';
import type { ChartSpec, ScriptSection } from '@yme/shared';

const chart = (over: Partial<ChartSpec> = {}): ChartSpec => ({
  type: 'bar',
  title: 'Revenue',
  unit: 'USD billions',
  series: [{ name: 'x', points: [{ label: 'FY23', value: 15 }, { label: 'FY24', value: 47.5 }] }],
  sourceClaimKey: 'nvda-dc',
  sourceNote: 'Source: filings',
  ...over,
});

const claims = new Map([
  ['nvda-dc', { key: 'nvda-dc', kind: 'QUANTITATIVE', status: 'VERIFIED' }],
  ['nvda-story', { key: 'nvda-story', kind: 'CAUSAL', status: 'VERIFIED' }],
  ['nvda-dead', { key: 'nvda-dead', kind: 'FINANCIAL', status: 'REJECTED' }],
]);

describe('chart traceability', () => {
  it('accepts a chart backed by a quantitative claim', () => {
    expect(validateChart(chart(), claims)).toBeNull();
  });

  it('rejects a chart citing a claim that does not exist', () => {
    // This is the fabrication guard: a model will happily invent a plausible
    // revenue series if nothing checks the citation resolves.
    const reason = validateChart(chart({ sourceClaimKey: 'invented-key' }), claims);
    expect(reason).toMatch(/does not exist/);
  });

  it('rejects a chart citing a rejected claim', () => {
    expect(validateChart(chart({ sourceClaimKey: 'nvda-dead' }), claims)).toMatch(/rejected/);
  });

  it('rejects a chart built on a claim that carries no data series', () => {
    expect(validateChart(chart({ sourceClaimKey: 'nvda-story' }), claims)).toMatch(/CAUSAL/);
  });

  it('rejects a chart with fewer than two points', () => {
    const single = chart({ series: [{ name: 'x', points: [{ label: 'FY24', value: 47.5 }] }] });
    expect(validateChart(single, claims)).toMatch(/fewer than two/);
  });

  it('rejects non-finite values rather than emitting NaN geometry', () => {
    const bad = chart({ series: [{ name: 'x', points: [{ label: 'a', value: 1 }, { label: 'b', value: Number.NaN }] }] });
    expect(validateChart(bad, claims)).toMatch(/non-finite/);
  });
});

describe('shot pacing', () => {
  const scene = (id: string, narration: string, seconds: number, chartSpec: ChartSpec | null = null) => ({
    id, sectionId: 's1', index: 0, narration,
    visualKind: (chartSpec ? 'CHART' : 'STOCK_VIDEO') as never,
    visualQuery: 'query', onScreenText: null, chart: chartSpec, estimatedSeconds: seconds,
  });

  it('splits a scene that would hold one shot past the ceiling', () => {
    // Warning about this was not enough: it produced a 29-second average shot
    // length, which is the slideshow spec §18 forbids.
    const long = 'One sentence here. Two sentences here. Three sentences here. Four sentences here. Five here. Six here.';
    const out = splitLongScenes([scene('a', long, 30)], MAX_SCENE_SECONDS);
    expect(out.length).toBeGreaterThan(1);
    for (const s of out) expect(s.estimatedSeconds).toBeLessThan(30);
  });

  it('never splits a chart scene', () => {
    // The chart is the shot. Cutting away mid-explanation defeats drawing it.
    const long = 'A. B. C. D. E. F. G. H.';
    const out = splitLongScenes([scene('c', long, 40, chart())], MAX_SCENE_SECONDS);
    expect(out).toHaveLength(1);
  });

  it('leaves scenes under the ceiling untouched', () => {
    const out = splitLongScenes([scene('a', 'Short.', 5)], MAX_SCENE_SECONDS);
    expect(out).toHaveLength(1);
    expect(out[0]?.id).toBe('a');
  });

  it('does not split a single unbroken sentence', () => {
    const out = splitLongScenes([scene('a', 'One very long sentence with no internal punctuation at all', 30)], MAX_SCENE_SECONDS);
    expect(out).toHaveLength(1);
  });

  it('reindexes contiguously and keeps ids unique', () => {
    const long = 'A one. B two. C three. D four. E five. F six.';
    const out = splitLongScenes([scene('a', long, 30), scene('b', long, 30)], MAX_SCENE_SECONDS);
    expect(out.map((s) => s.index)).toEqual(out.map((_, i) => i));
    expect(new Set(out.map((s) => s.id)).size).toBe(out.length);
  });

  it('carries the section heading only on the first piece', () => {
    const long = 'A one. B two. C three. D four. E five. F six.';
    const withText = { ...scene('a', long, 30), onScreenText: 'The mechanism' };
    const out = splitLongScenes([withText], MAX_SCENE_SECONDS);
    expect(out[0]?.onScreenText).toBe('The mechanism');
    for (const s of out.slice(1)) expect(s.onScreenText).toBeNull();
  });
});

describe('copyright assessment', () => {
  const asset = (over: Record<string, unknown> = {}) => ({
    kind: 'STOCK_VIDEO', copyrightRisk: 'LOW', licence: 'Pexels License',
    clearedAt: null, provider: 'pexels', ...over,
  }) as never;

  it('fails on any high-risk asset', () => {
    expect(assessCopyright([asset(), asset({ copyrightRisk: 'HIGH' })]).verdict).toBe('FAIL');
  });

  it('warns on unassessed risk', () => {
    expect(assessCopyright([asset({ copyrightRisk: 'UNKNOWN' })]).verdict).toBe('WARNING');
  });

  it('warns when a third-party asset has no recorded licence', () => {
    expect(assessCopyright([asset({ licence: null })]).verdict).toBe('WARNING');
  });

  it('ignores assets this system generated itself', () => {
    // Charts and voiceovers carry no third-party rights.
    const result = assessCopyright([
      asset({ kind: 'CHART_PNG', licence: null, provider: 'internal', copyrightRisk: 'NONE' }),
      asset({ kind: 'AUDIO_VOICE', licence: null, provider: 'internal', copyrightRisk: 'NONE' }),
    ]);
    expect(result.verdict).toBe('PASS');
  });
});

describe('visual quality', () => {
  it('penalises slideshow pacing hard', () => {
    const slideshow = assessVisualQuality({ sceneCount: 10, chartCount: 2, durationSeconds: 600, assetsWithoutSource: 0 });
    const paced = assessVisualQuality({ sceneCount: 80, chartCount: 2, durationSeconds: 600, assetsWithoutSource: 0 });
    expect(paced.score).toBeGreaterThan(slideshow.score);
    expect(slideshow.warnings.join(' ')).toMatch(/slideshow/);
  });

  it('flags a business explainer with no data visualisation', () => {
    const result = assessVisualQuality({ sceneCount: 60, chartCount: 0, durationSeconds: 600, assetsWithoutSource: 0 });
    expect(result.warnings.join(' ')).toMatch(/data visualisation/);
  });

  it('penalises placeholders proportionally', () => {
    const few = assessVisualQuality({ sceneCount: 60, chartCount: 2, durationSeconds: 600, assetsWithoutSource: 2 });
    const many = assessVisualQuality({ sceneCount: 60, chartCount: 2, durationSeconds: 600, assetsWithoutSource: 40 });
    expect(few.score).toBeGreaterThan(many.score);
  });

  it('never returns a score outside 0-100', () => {
    const worst = assessVisualQuality({ sceneCount: 1, chartCount: 0, durationSeconds: 3600, assetsWithoutSource: 500 });
    expect(worst.score).toBeGreaterThanOrEqual(0);
    expect(worst.score).toBeLessThanOrEqual(100);
  });
});

describe('script quality', () => {
  const section = (id: string, words: number, claims: string[] = [], opening = 'The mechanism here'): ScriptSection => ({
    id, heading: id, claimKeys: claims, openLoop: 'why?',
    narration: `${opening} ${Array.from({ length: Math.max(0, words - 3) }, () => 'word').join(' ')}`,
  });

  it('penalises a script far off its target length', () => {
    const onTarget = scoreScriptQuality({ sections: [section('a', 1500, ['k'])], wordCount: 1500, targetWords: 1500, aiTells: [] });
    const short = scoreScriptQuality({ sections: [section('a', 400, ['k'])], wordCount: 400, targetWords: 1500, aiTells: [] });
    expect(onTarget).toBeGreaterThan(short);
  });

  it('penalises banned filler phrases', () => {
    const clean = scoreScriptQuality({ sections: [section('a', 1500, ['k'])], wordCount: 1500, targetWords: 1500, aiTells: [] });
    const filler = scoreScriptQuality({ sections: [section('a', 1500, ['k'])], wordCount: 1500, targetWords: 1500, aiTells: ['game changer', 'delve into'] });
    expect(clean).toBeGreaterThan(filler);
  });

  it('penalises sections that all open the same way', () => {
    const varied = [section('a', 300, ['k'], 'First we look'), section('b', 300, ['k'], 'Then the money'), section('c', 300, ['k'], 'Finally the lesson')];
    const same = [section('a', 300, ['k']), section('b', 300, ['k']), section('c', 300, ['k'])];
    const v = scoreScriptQuality({ sections: varied, wordCount: 900, targetWords: 900, aiTells: [] });
    const s = scoreScriptQuality({ sections: same, wordCount: 900, targetWords: 900, aiTells: [] });
    expect(v).toBeGreaterThan(s);
  });

  it('penalises a script that is mostly unsupported opinion', () => {
    const supported = Array.from({ length: 5 }, (_, i) => section(`s${i}`, 300, ['k']));
    const opinion = Array.from({ length: 5 }, (_, i) => section(`s${i}`, 300, []));
    const a = scoreScriptQuality({ sections: supported, wordCount: 1500, targetWords: 1500, aiTells: [] });
    const b = scoreScriptQuality({ sections: opinion, wordCount: 1500, targetWords: 1500, aiTells: [] });
    expect(a).toBeGreaterThan(b);
  });

  it('stays within 0-100', () => {
    const awful = scoreScriptQuality({
      sections: [section('a', 5, [])], wordCount: 5, targetWords: 2000,
      aiTells: ['a', 'b', 'c', 'd', 'e', 'f'],
    });
    expect(awful).toBeGreaterThanOrEqual(0);
    expect(awful).toBeLessThanOrEqual(100);
  });
});

describe('chapters', () => {
  it('derives chapter times from real scene offsets and forces the first to zero', () => {
    // YouTube ignores a chapter list whose first entry is not 0:00.
    const scenes = [
      { sectionId: 's1', startSeconds: 4, index: 0 },
      { sectionId: 's1', startSeconds: 12, index: 1 },
      { sectionId: 's2', startSeconds: 95, index: 2 },
      { sectionId: 's3', startSeconds: 260, index: 3 },
    ];
    const sections = [
      { id: 's1', heading: 'Hook', narration: '', claimKeys: [], openLoop: null },
      { id: 's2', heading: 'Mechanism', narration: '', claimKeys: [], openLoop: null },
      { id: 's3', heading: 'Money', narration: '', claimKeys: [], openLoop: null },
    ];
    const chapters = deriveChapters(scenes, sections);
    expect(chapters[0]).toEqual({ seconds: 0, label: 'Hook' });
    expect(chapters.map((c) => c.seconds)).toEqual([0, 95, 260]);
  });

  it('skips sections with no scenes rather than emitting a bogus timestamp', () => {
    const chapters = deriveChapters(
      [{ sectionId: 's1', startSeconds: 0, index: 0 }],
      [
        { id: 's1', heading: 'Hook', narration: '', claimKeys: [], openLoop: null },
        { id: 'ghost', heading: 'Never rendered', narration: '', claimKeys: [], openLoop: null },
      ],
    );
    expect(chapters).toHaveLength(1);
  });
});

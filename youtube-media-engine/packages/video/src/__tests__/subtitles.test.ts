import { describe, it, expect } from 'vitest';
import { buildCues, chunkNarration, toSrt, toVtt, toAss, MAX_CHARS_PER_LINE, MAX_CUE_SECONDS } from '../subtitles.js';

const scene = (narration: string, start: number, duration: number) => ({
  narration,
  startSeconds: start,
  durationSeconds: duration,
});

describe('cue construction', () => {
  const long =
    'NVIDIA spent fifteen years making its chips the only ones researchers knew how to program and then charged rent on that habit which is a far more durable position than shipping faster silicon.';

  it('never emits a cue with more than the allowed lines', () => {
    // Regression: overflow lines used to be crammed into one cue, producing a
    // five-line caption block that covered the shot it was captioning.
    const cues = buildCues([scene(long, 0, 18)]);
    for (const c of cues) expect(c.lines.length).toBeLessThanOrEqual(2);
  });

  it('never exceeds the line width', () => {
    const cues = buildCues([scene(long, 0, 18)]);
    for (const c of cues) for (const line of c.lines) expect(line.length).toBeLessThanOrEqual(MAX_CHARS_PER_LINE);
  });

  it('respects a narrower profile for vertical Shorts', () => {
    const cues = buildCues([scene(long, 0, 18)], { maxCharsPerLine: 22, maxLinesPerCue: 3 });
    for (const c of cues) {
      expect(c.lines.length).toBeLessThanOrEqual(3);
      for (const line of c.lines) expect(line.length).toBeLessThanOrEqual(22);
    }
  });

  it('produces non-overlapping, monotonically increasing cues', () => {
    const cues = buildCues([scene(long, 0, 18), scene('A second scene follows immediately.', 18, 6)]);
    for (let i = 1; i < cues.length; i++) {
      expect(cues[i]!.start).toBeGreaterThanOrEqual(cues[i - 1]!.end);
      expect(cues[i]!.end).toBeGreaterThan(cues[i]!.start);
    }
  });

  it('starts at the scene offset it was given', () => {
    const cues = buildCues([scene('Short sentence here.', 42, 4)]);
    expect(cues[0]?.start).toBeCloseTo(42, 3);
  });

  it('caps individual cue duration', () => {
    const cues = buildCues([scene('One short line.', 0, 60)]);
    for (const c of cues) expect(c.end - c.start).toBeLessThanOrEqual(MAX_CUE_SECONDS + 0.001);
  });
});

describe('chunking', () => {
  it('breaks a long sentence on clause boundaries first', () => {
    const chunks = chunkNarration(
      'Costco runs merchandise near break-even, which sounds irrational, until you look at the membership line.',
      50,
    );
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(60);
  });

  it('falls back to word boundaries when there is no punctuation to break on', () => {
    const words = Array.from({ length: 40 }, () => 'word').join(' ');
    const chunks = chunkNarration(words, 40);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(45);
  });

  it('returns the input when it already fits', () => {
    expect(chunkNarration('Short enough.', 100)).toEqual(['Short enough.']);
  });
});

describe('serialisation', () => {
  const cues = buildCues([scene('First sentence here. Second sentence follows.', 0, 8)]);

  it('emits SRT with comma decimal separators', () => {
    const srt = toSrt(cues);
    expect(srt).toMatch(/^1\n00:00:00,000 --> /);
    expect(srt.endsWith('\n')).toBe(true);
  });

  it('emits WebVTT with a header and dot separators', () => {
    const vtt = toVtt(cues);
    expect(vtt.startsWith('WEBVTT')).toBe(true);
    expect(vtt).toMatch(/00:00:00\.000 --> /);
  });

  it('emits ASS with a style line and matching resolution', () => {
    const ass = toAss(cues, { width: 1080, height: 1920 });
    expect(ass).toContain('PlayResX: 1080');
    expect(ass).toContain('PlayResY: 1920');
    expect(ass).toContain('[Events]');
    expect(ass).toMatch(/Dialogue: 0,\d:\d\d:\d\d\.\d\d,/);
  });

  it('escapes ASS control characters so a brace in narration cannot break rendering', () => {
    const braced = buildCues([scene('The margin {is} the story.', 0, 4)]);
    const ass = toAss(braced, { width: 1920, height: 1080 });
    expect(ass).toContain('\\{is\\}');
  });

  it('joins multi-line cues with the ASS line separator', () => {
    const multi = buildCues([
      scene('A considerably longer sentence that will certainly wrap onto two lines.', 0, 6),
    ]);
    const ass = toAss(multi, { width: 1920, height: 1080 });
    if (multi.some((c) => c.lines.length > 1)) expect(ass).toContain('\\N');
  });
});

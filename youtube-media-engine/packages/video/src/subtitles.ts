import { splitSentences, toTimecode, wrapForCaption, countWords } from '@yme/shared';

/**
 * Caption generation (spec §19).
 *
 * Timing comes from measured scene audio durations, not from a speech-to-text
 * pass. Since this system wrote the narration and synthesised the audio, it
 * already knows exactly what was said and for how long — running ASR over the
 * result to recover information it started with would add cost and introduce
 * transcription errors into a transcript that is currently exact.
 *
 * Within a scene, cues are distributed by word count, which tracks speaking
 * time closely enough that drift stays under a syllable.
 */

export interface CaptionSource {
  narration: string;
  startSeconds: number;
  durationSeconds: number;
}

export interface Cue {
  index: number;
  start: number;
  end: number;
  lines: string[];
}

export const MAX_CUE_SECONDS = 6;
export const MIN_CUE_SECONDS = 0.9;
export const MAX_CHARS_PER_LINE = 42;
export const MAX_LINES_PER_CUE = 2;

export interface CueOptions {
  /**
   * Characters per line. 42 suits a 16:9 frame at the default caption size;
   * Shorts use a much larger font on a narrower frame and need roughly half
   * that, or the renderer silently wraps to five lines and covers the shot.
   */
  maxCharsPerLine?: number;
  maxLinesPerCue?: number;
}

export function buildCues(scenes: CaptionSource[], opts: CueOptions = {}): Cue[] {
  const maxChars = opts.maxCharsPerLine ?? MAX_CHARS_PER_LINE;
  const maxLines = opts.maxLinesPerCue ?? MAX_LINES_PER_CUE;
  const cues: Cue[] = [];
  let index = 1;

  for (const scene of scenes) {
    const chunks = chunkNarration(scene.narration, maxChars * maxLines);
    const totalWords = chunks.reduce((a, c) => a + countWords(c), 0) || 1;

    let cursor = scene.startSeconds;
    for (const chunk of chunks) {
      const share = countWords(chunk) / totalWords;
      const rawDuration = scene.durationSeconds * share;
      const duration = Math.max(MIN_CUE_SECONDS, Math.min(MAX_CUE_SECONDS, rawDuration));
      const end = Math.min(cursor + duration, scene.startSeconds + scene.durationSeconds);

      // wrapForCaption returns however many lines the text needs. Anything
      // beyond maxLines becomes a second cue rather than a taller caption
      // block — an over-tall block covers the shot it is captioning.
      const allLines = wrapForCaption(chunk, maxChars, maxLines);
      const groups: string[][] = [];
      for (let i = 0; i < allLines.length; i += maxLines) groups.push(allLines.slice(i, i + maxLines));

      const slice = (end - cursor) / Math.max(1, groups.length);
      for (const [gi, lines] of groups.entries()) {
        const gStart = cursor + gi * slice;
        cues.push({
          index: index++,
          start: gStart,
          end: Math.max(gStart + MIN_CUE_SECONDS, gStart + slice),
          lines,
        });
      }
      cursor = end;
    }
  }

  return dedupeOverlaps(cues);
}

/** Splits narration into cue-sized chunks: sentences, then clauses, then words. */
export function chunkNarration(text: string, budget = MAX_CHARS_PER_LINE * MAX_LINES_PER_CUE): string[] {
  const out: string[] = [];
  for (const sentence of splitSentences(text)) {
    if (sentence.length <= budget) {
      out.push(sentence);
      continue;
    }
    // Break at clause boundaries first — mid-phrase breaks read badly.
    const clauses = sentence.split(/(?<=[,;:—–])\s+/).flatMap((c) => splitOnWords(c, budget));
    let buffer = '';
    for (const clause of clauses) {
      const candidate = buffer ? `${buffer} ${clause}` : clause;
      if (candidate.length > budget && buffer) {
        out.push(buffer);
        buffer = clause;
      } else {
        buffer = candidate;
      }
    }
    if (buffer) out.push(buffer);
  }
  return out.length ? out : [text];
}

/** Last resort for a clause with no internal punctuation to break on. */
function splitOnWords(text: string, budget: number): string[] {
  if (text.length <= budget) return [text];
  const words = text.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let buffer = '';
  for (const w of words) {
    const candidate = buffer ? `${buffer} ${w}` : w;
    if (candidate.length > budget && buffer) {
      out.push(buffer);
      buffer = w;
    } else {
      buffer = candidate;
    }
  }
  if (buffer) out.push(buffer);
  return out;
}

/** Cues must never overlap; players render overlapping cues unpredictably. */
function dedupeOverlaps(cues: Cue[]): Cue[] {
  for (let i = 1; i < cues.length; i++) {
    const prev = cues[i - 1]!;
    const cur = cues[i]!;
    if (cur.start < prev.end) cur.start = prev.end;
    if (cur.end <= cur.start) cur.end = cur.start + MIN_CUE_SECONDS;
  }
  return cues;
}

export function toSrt(cues: Cue[]): string {
  return (
    cues
      .map(
        (c) =>
          `${c.index}\n${toTimecode(c.start, { millis: true, comma: true })} --> ${toTimecode(c.end, { millis: true, comma: true })}\n${c.lines.join('\n')}`,
      )
      .join('\n\n') + '\n'
  );
}

export function toVtt(cues: Cue[]): string {
  return (
    'WEBVTT\n\n' +
    cues
      .map(
        (c) =>
          `${c.index}\n${toTimecode(c.start, { millis: true })} --> ${toTimecode(c.end, { millis: true })}\n${c.lines.join('\n')}`,
      )
      .join('\n\n') +
    '\n'
  );
}

/**
 * ASS for burned-in captions. Used for Shorts, where captions are expected and
 * most viewing is sound-off. Long-form ships soft subtitles instead — burning
 * them in is irreversible and stops viewers turning them off.
 */
export function toAss(cues: Cue[], opts: { width: number; height: number; fontSize?: number }): string {
  const fontSize = opts.fontSize ?? Math.round(opts.height * 0.038);
  const marginV = Math.round(opts.height * 0.16);

  const header = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${opts.width}`,
    `PlayResY: ${opts.height}`,
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    // &HAABBGGRR — ASS colours are BGR with an inverted alpha byte.
    `Style: Default,DejaVu Sans,${fontSize},&H00F2EDE9,&H00F2EDE9,&H00161110,&H96000000,-1,0,0,0,100,100,0,0,1,${Math.max(2, Math.round(fontSize * 0.09))},0,2,60,60,${marginV},1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ].join('\n');

  const events = cues.map(
    (c) =>
      `Dialogue: 0,${assTime(c.start)},${assTime(c.end)},Default,,0,0,0,,${c.lines
        .map((l) => l.replace(/\\/g, '\\\\').replace(/\{/g, '\\{').replace(/\}/g, '\\}'))
        .join('\\N')}`,
  );

  return `${header}\n${events.join('\n')}\n`;
}

function assTime(seconds: number): string {
  const s = Math.max(0, seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  const cs = Math.round((s - Math.floor(s)) * 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(Math.min(99, cs)).padStart(2, '0')}`;
}

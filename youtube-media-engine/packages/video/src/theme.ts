/**
 * Visual system for rendered frames.
 *
 * One palette, used by charts, cards and thumbnails alike, so a video does not
 * look like three different channels spliced together. Colours are chosen for
 * contrast on a dark ground and to stay distinguishable in the 8-bit 4:2:0
 * chroma subsampling YouTube re-encodes to — saturated reds and thin cyans
 * fringe badly after that pass, so they are avoided.
 */
export const theme = {
  bg: '#0E1116',
  bgElevated: '#151A21',
  grid: '#232A34',
  axis: '#3A4453',
  text: '#E9EDF2',
  textMuted: '#95A0AF',
  textFaint: '#5C6675',
  accent: '#4E9BFF',
  series: ['#4E9BFF', '#F0B429', '#5CD6A0', '#E8746B', '#B07CFF', '#4FC3D9'],
  positive: '#5CD6A0',
  negative: '#E8746B',

  fontStack: "'DejaVu Sans', 'Liberation Sans', 'Noto Sans', sans-serif",
  fontMono: "'DejaVu Sans Mono', 'Liberation Mono', monospace",
} as const;

export interface Dimensions {
  width: number;
  height: number;
}

export const RESOLUTIONS: Record<string, Dimensions> = {
  '1080p': { width: 1920, height: 1080 },
  '4k': { width: 3840, height: 2160 },
};

export const SHORT_RESOLUTION: Dimensions = { width: 1080, height: 1920 };

export function resolutionFor(name: string): Dimensions {
  return RESOLUTIONS[name] ?? RESOLUTIONS['1080p']!;
}

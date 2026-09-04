import { theme, type Dimensions } from './theme.js';
import { esc, svgDocument, svgOverlay, textBlock, wrapText } from './svg.js';

/**
 * Full-frame and overlay cards.
 *
 * These carry the channel's typography. A "text card" here is not a fallback
 * for a missing asset — a well-set statement on a clean ground is a legitimate
 * documentary shot, and it is the one visual this system can always produce
 * without depending on a stock library.
 */

export interface TextCardOptions extends Dimensions {
  heading?: string | null;
  body: string;
  footnote?: string | null;
  accent?: string;
}

export function textCardSvg(o: TextCardOptions): string {
  const scale = o.width / 1920;
  const marginX = 180 * scale;
  const maxWidth = o.width - marginX * 2;
  const accent = o.accent ?? theme.accent;

  const bodySize = pickBodySize(o.body, maxWidth, o.height, scale);
  const bodyLines = wrapText(o.body, maxWidth, bodySize, 'bold');
  const lineHeight = bodySize * 1.22;
  const blockHeight = bodyLines.length * lineHeight;
  const startY = (o.height - blockHeight) / 2 + bodySize * 0.8;

  const parts: string[] = [
    // A thin accent rule reads as deliberate framing rather than a blank slide.
    `<rect x="${marginX}" y="${startY - bodySize * 1.9}" width="${96 * scale}" height="${6 * scale}" rx="${3 * scale}" fill="${accent}"/>`,
  ];

  if (o.heading) {
    parts.push(
      textBlock(o.heading.toUpperCase(), {
        x: marginX,
        y: startY - bodySize * 1.15,
        fontSize: 28 * scale,
        fill: theme.textMuted,
        weight: 'bold',
        letterSpacing: 3 * scale,
        maxWidth,
        maxLines: 1,
      }),
    );
  }

  parts.push(
    textBlock(o.body, {
      x: marginX,
      y: startY,
      fontSize: bodySize,
      lineHeight,
      weight: 'bold',
      maxWidth,
      maxLines: 6,
    }),
  );

  if (o.footnote) {
    parts.push(
      textBlock(o.footnote, {
        x: marginX,
        y: o.height - 70 * scale,
        fontSize: 24 * scale,
        fill: theme.textFaint,
        maxWidth,
        maxLines: 1,
      }),
    );
  }

  return svgDocument(o.width, o.height, parts.join('\n'));
}

function pickBodySize(body: string, maxWidth: number, height: number, scale: number): number {
  // Step down until the text fits in six lines. Fixed sizes either overflow on
  // long statements or look weak on short ones.
  for (const size of [92, 80, 68, 58, 50, 44].map((s) => s * scale)) {
    const lines = wrapText(body, maxWidth, size, 'bold');
    if (lines.length <= 6 && lines.length * size * 1.22 < height * 0.62) return size;
  }
  return 40 * scale;
}

/**
 * Placeholder used when a provider returned no bytes — which in MOCK_MODE is
 * every stock and generated visual. It says so on the frame, in the frame, so
 * a placeholder can never be mistaken for finished footage in review.
 */
export function placeholderCardSvg(o: Dimensions & { kind: string; query: string; reason: string }): string {
  const scale = o.width / 1920;
  const marginX = 160 * scale;

  const stripes = [
    `<defs><pattern id="hatch" width="${28 * scale}" height="${28 * scale}" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">` +
      `<rect width="${28 * scale}" height="${28 * scale}" fill="${theme.bg}"/>` +
      `<line x1="0" y1="0" x2="0" y2="${28 * scale}" stroke="${theme.grid}" stroke-width="${10 * scale}"/></pattern></defs>`,
    `<rect width="${o.width}" height="${o.height}" fill="url(#hatch)"/>`,
    `<rect x="${marginX}" y="${o.height * 0.28}" width="${o.width - marginX * 2}" height="${o.height * 0.44}" ` +
      `rx="${16 * scale}" fill="${theme.bgElevated}" stroke="${theme.axis}" stroke-width="${2 * scale}"/>`,
  ];

  const innerX = marginX + 56 * scale;
  const innerW = o.width - marginX * 2 - 112 * scale;

  return svgDocument(
    o.width,
    o.height,
    [
      ...stripes,
      textBlock('PLACEHOLDER — NO ASSET SOURCED', {
        x: innerX,
        y: o.height * 0.28 + 78 * scale,
        fontSize: 30 * scale,
        fill: theme.negative,
        weight: 'bold',
        letterSpacing: 2 * scale,
        maxWidth: innerW,
        maxLines: 1,
      }),
      textBlock(o.query, {
        x: innerX,
        y: o.height * 0.28 + 152 * scale,
        fontSize: 44 * scale,
        weight: 'bold',
        maxWidth: innerW,
        maxLines: 2,
      }),
      textBlock(`${o.kind} · ${o.reason}`, {
        x: innerX,
        y: o.height * 0.28 + 290 * scale,
        fontSize: 26 * scale,
        fill: theme.textMuted,
        maxWidth: innerW,
        maxLines: 2,
      }),
    ].join('\n'),
  );
}

/** Lower third composited over footage — transparent background. */
export function lowerThirdSvg(o: Dimensions & { text: string }): string {
  const scale = o.width / 1920;
  const barHeight = 118 * scale;
  const y = o.height - barHeight - 96 * scale;
  const fontSize = 40 * scale;
  const marginX = 120 * scale;

  return svgOverlay(
    o.width,
    o.height,
    [
      // Semi-opaque plate rather than pure text: white text over bright footage
      // is unreadable, and a scrim is cheaper than per-frame luminance analysis.
      `<rect x="0" y="${y}" width="${o.width}" height="${barHeight}" fill="${theme.bg}" fill-opacity="0.82"/>`,
      `<rect x="0" y="${y}" width="${8 * scale}" height="${barHeight}" fill="${theme.accent}"/>`,
      textBlock(o.text, {
        x: marginX,
        y: y + barHeight / 2 + fontSize * 0.34,
        fontSize,
        weight: 'bold',
        maxWidth: o.width - marginX * 2,
        maxLines: 1,
      }),
    ].join('\n'),
  );
}

/** Vertical caption block for Shorts — large, centred, high contrast. */
export function shortsCaptionSvg(o: Dimensions & { lines: string[] }): string {
  const scale = o.width / 1080;
  const fontSize = 62 * scale;
  const lineHeight = fontSize * 1.24;
  const totalHeight = o.lines.length * lineHeight;
  const startY = o.height * 0.72 - totalHeight / 2;

  const parts = o.lines.flatMap((line, i) => {
    const y = startY + i * lineHeight;
    return [
      // Stroke behind fill: the standard readability trick for text over
      // arbitrary video, and it survives YouTube's re-encode.
      `<text x="${o.width / 2}" y="${y}" fill="none" stroke="${theme.bg}" stroke-width="${12 * scale}" ` +
        `stroke-linejoin="round" font-family="${theme.fontStack}" font-size="${fontSize}" font-weight="bold" ` +
        `text-anchor="middle">${esc(line)}</text>`,
      `<text x="${o.width / 2}" y="${y}" fill="${theme.text}" font-family="${theme.fontStack}" ` +
        `font-size="${fontSize}" font-weight="bold" text-anchor="middle">${esc(line)}</text>`,
    ];
  });

  return svgOverlay(o.width, o.height, parts.join('\n'));
}

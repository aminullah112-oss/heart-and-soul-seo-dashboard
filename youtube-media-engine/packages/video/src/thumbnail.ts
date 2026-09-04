import { theme } from './theme.js';
import { esc, svgDocument, textBlock, wrapText, estimateTextWidth } from './svg.js';

/**
 * Thumbnail composition (spec §21).
 *
 * Composed rather than generated: a text-forward thumbnail at 1280x720 with
 * one focal element is both more legible at 168x94 (the size that actually
 * decides the click) and free of the "did an image model just draw a real
 * company's logo" problem.
 *
 * When an image provider is configured, the generated image becomes the
 * background layer and this supplies the typography over it.
 */

export interface ThumbnailInput {
  headline: string;
  /** Small kicker above the headline, e.g. the company name. */
  kicker?: string | null;
  /** One large figure, e.g. "$47.5B" — the single strongest thumbnail element. */
  statistic?: string | null;
  statisticCaption?: string | null;
  accent?: string;
  /** Data URI or file path of a background image, composited underneath. */
  backgroundHref?: string | null;
}

export const THUMB_WIDTH = 1280;
export const THUMB_HEIGHT = 720;

export function thumbnailSvg(input: ThumbnailInput): string {
  const accent = input.accent ?? theme.accent;
  const W = THUMB_WIDTH;
  const H = THUMB_HEIGHT;
  const margin = 78;

  const hasStat = Boolean(input.statistic);
  const textWidth = hasStat ? W * 0.54 : W - margin * 2;

  const parts: string[] = [];

  if (input.backgroundHref) {
    parts.push(
      `<image href="${esc(input.backgroundHref)}" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice"/>`,
      // Scrim: white text over an arbitrary photo is unreadable without one.
      `<rect width="${W}" height="${H}" fill="${theme.bg}" fill-opacity="0.62"/>`,
    );
  } else {
    parts.push(
      `<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">` +
        `<stop offset="0%" stop-color="${theme.bgElevated}"/>` +
        `<stop offset="100%" stop-color="${theme.bg}"/></linearGradient></defs>`,
      `<rect width="${W}" height="${H}" fill="url(#bg)"/>`,
      // Faint accent wash, so the frame is not a flat rectangle.
      `<circle cx="${W * 0.86}" cy="${H * 0.2}" r="${H * 0.5}" fill="${accent}" fill-opacity="0.07"/>`,
    );
  }

  const headlineSize = pickHeadlineSize(input.headline, textWidth);
  const lines = wrapText(input.headline.toUpperCase(), textWidth, headlineSize, 'bold');
  const lineHeight = headlineSize * 1.08;
  const blockTop = H / 2 - (lines.length * lineHeight) / 2 + headlineSize * 0.72;

  if (input.kicker) {
    parts.push(
      textBlock(input.kicker.toUpperCase(), {
        x: margin,
        y: blockTop - headlineSize * 0.95,
        fontSize: 30,
        fill: accent,
        weight: 'bold',
        letterSpacing: 4,
        maxWidth: textWidth,
        maxLines: 1,
      }),
    );
  }

  parts.push(
    textBlock(input.headline.toUpperCase(), {
      x: margin,
      y: blockTop,
      fontSize: headlineSize,
      lineHeight,
      weight: 'bold',
      maxWidth: textWidth,
      maxLines: 3,
    }),
  );

  parts.push(
    `<rect x="${margin}" y="${blockTop + lines.length * lineHeight - headlineSize * 0.3}" ` +
      `width="${Math.min(textWidth, 190)}" height="8" rx="4" fill="${accent}"/>`,
  );

  if (input.statistic) {
    const statX = W - margin;
    const statSize = fitStatSize(input.statistic, W * 0.38);
    parts.push(
      `<text x="${statX}" y="${H / 2 + statSize * 0.22}" fill="${accent}" font-family="${theme.fontStack}" ` +
        `font-size="${statSize}" font-weight="bold" text-anchor="end">${esc(input.statistic)}</text>`,
    );
    if (input.statisticCaption) {
      parts.push(
        textBlock(input.statisticCaption.toUpperCase(), {
          x: statX,
          y: H / 2 + statSize * 0.6,
          fontSize: 26,
          fill: theme.textMuted,
          weight: 'bold',
          anchor: 'end',
          letterSpacing: 2,
          maxWidth: W * 0.38,
          maxLines: 1,
        }),
      );
    }
  }

  return svgDocument(W, H, parts.join('\n'), theme.bg);
}

/**
 * Headline sizing. The floor is 54px, not lower: below roughly that, text is
 * illegible at the 168x94 the thumbnail is actually judged at. If a headline
 * cannot fit in three lines at 54px it is too long, and the text is truncated
 * rather than shrunk into unreadability.
 */
function pickHeadlineSize(text: string, maxWidth: number): number {
  for (const size of [104, 92, 82, 72, 64, 54]) {
    if (wrapText(text.toUpperCase(), maxWidth, size, 'bold').length <= 3) return size;
  }
  return 54;
}

function fitStatSize(stat: string, maxWidth: number): number {
  for (const size of [148, 128, 110, 94, 80]) {
    if (estimateTextWidth(stat, size, 'bold') <= maxWidth) return size;
  }
  return 72;
}

/**
 * Legibility check at browse size. Returns problems rather than a score —
 * "headline is 9 words" is actionable, "legibility: 62" is not.
 */
export function checkThumbnailLegibility(input: ThumbnailInput): string[] {
  const problems: string[] = [];
  const words = input.headline.trim().split(/\s+/).length;

  if (words > 6) problems.push(`Headline is ${words} words; over six is unreadable at browse size`);
  if (input.headline.length > 42) problems.push(`Headline is ${input.headline.length} characters; aim for under 42`);
  if (pickHeadlineSize(input.headline, THUMB_WIDTH * 0.54) <= 54 && words > 4) {
    problems.push('Headline only fits at the minimum legible size — shorten it');
  }
  if (input.statistic && input.statistic.length > 8) {
    problems.push(`Statistic "${input.statistic}" is too long to read as a single glance element`);
  }
  return problems;
}

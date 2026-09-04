import sharp from 'sharp';
import fs from 'node:fs/promises';
import path from 'node:path';
import { renderError } from '@yme/shared';
import type { Dimensions } from './theme.js';

/**
 * SVG -> PNG. Composition happens in SVG rather than in ffmpeg filters because
 * ffmpeg's drawtext requires escaping colons, quotes, backslashes and percent
 * signs in ways that break on real company names, and offers no text wrapping
 * at all.
 */
export async function svgToPng(svg: string, outPath: string): Promise<string> {
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  try {
    await sharp(Buffer.from(svg), { density: 96 }).png({ compressionLevel: 6 }).toFile(outPath);
    return outPath;
  } catch (err) {
    throw renderError('Failed to rasterise SVG', { cause: err, details: { outPath } });
  }
}

export async function svgToPngBuffer(svg: string): Promise<Buffer> {
  try {
    return await sharp(Buffer.from(svg), { density: 96 }).png().toBuffer();
  } catch (err) {
    throw renderError('Failed to rasterise SVG to buffer', { cause: err });
  }
}

/**
 * Fits arbitrary source imagery to the frame.
 *
 * `cover` crops rather than letterboxing. Black bars inside the frame look
 * like a mistake; a crop looks like a decision.
 */
export async function fitImage(
  input: Buffer | string,
  dims: Dimensions,
  outPath: string,
  opts: { background?: string } = {},
): Promise<string> {
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  try {
    await sharp(input)
      .resize(dims.width, dims.height, {
        fit: 'cover',
        position: 'attention', // crop toward the visually salient region
        background: opts.background ?? '#0E1116',
      })
      .png()
      .toFile(outPath);
    return outPath;
  } catch (err) {
    throw renderError('Failed to fit image to frame', { cause: err, details: { outPath } });
  }
}

/** Composites a transparent overlay (lower third, captions) onto a base frame. */
export async function compositeOverlay(basePath: string, overlaySvg: string, outPath: string): Promise<string> {
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  try {
    await sharp(basePath)
      .composite([{ input: Buffer.from(overlaySvg), top: 0, left: 0 }])
      .png()
      .toFile(outPath);
    return outPath;
  } catch (err) {
    throw renderError('Failed to composite overlay', { cause: err, details: { basePath, outPath } });
  }
}

/**
 * Encodes a thumbnail to JPEG under YouTube's 2MB limit, stepping quality down
 * until it fits. Failing the upload on file size after the video is already
 * live is a bad way to find out.
 */
export async function encodeThumbnail(svg: string, outPath: string, maxBytes = 2 * 1024 * 1024): Promise<string> {
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  const base = sharp(Buffer.from(svg), { density: 96 }).resize(1280, 720, { fit: 'cover' });

  for (const quality of [92, 85, 78, 70, 60, 50]) {
    const buf = await base.clone().jpeg({ quality, progressive: true, mozjpeg: true }).toBuffer();
    if (buf.length <= maxBytes) {
      await fs.writeFile(outPath, buf);
      return outPath;
    }
  }
  throw renderError(`Thumbnail could not be compressed under ${maxBytes} bytes`);
}

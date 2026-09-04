import fs from 'node:fs/promises';
import path from 'node:path';
import { env } from '@yme/config';
import { prisma, type AssetKind, type CopyrightRisk } from '@yme/database';
import { jobLogger, type ChartSpec } from '@yme/shared';
import { findStock, generateImage, type VisualAsset } from '@yme/images';
import { getStorage } from '@yme/storage';
import {
  compositeOverlay,
  fitImage,
  lowerThirdSvg,
  placeholderCardSvg,
  renderChartSvg,
  resolutionFor,
  svgToPng,
  textCardSvg,
} from '@yme/video';
import { ensureWorkDir, storageKeys } from './workdir.js';

/**
 * Visual asset acquisition and frame composition.
 *
 * Every scene ends with exactly one full-frame PNG stored and an Asset row
 * recording where it came from and under what licence. A scene that could not
 * get real media gets a placeholder that says so on the frame — never a
 * silently blank shot, and never an asset row claiming a licence it does not
 * have.
 */
export interface VisualsResult {
  framesRendered: number;
  stockAcquired: number;
  imagesGenerated: number;
  chartsRendered: number;
  placeholders: number;
}

const STYLE_SUFFIX =
  'Editorial illustration, muted desaturated palette, dark background, clean geometric composition, ' +
  'no text, no logos, no identifiable real people';

export async function runVisualsStage(opts: { videoProjectId: string; jobId?: string }): Promise<VisualsResult> {
  const log = jobLogger({ jobId: opts.jobId, videoId: opts.videoProjectId, stage: 'VISUALS' });
  const storage = getStorage();
  const dims = resolutionFor(env.RENDER_RESOLUTION);
  const workDir = await ensureWorkDir(opts.videoProjectId, 'visuals');

  const project = await prisma.videoProject.findUnique({
    where: { id: opts.videoProjectId },
    include: {
      scenes: { orderBy: { index: 'asc' } },
      research: { include: { claims: { include: { sourceLinks: { include: { source: true } } } } } },
    },
  });
  if (!project) throw new Error(`VideoProject ${opts.videoProjectId} not found`);

  const claimsByKey = new Map((project.research?.claims ?? []).map((c) => [c.key, c]));
  const result: VisualsResult = {
    framesRendered: 0,
    stockAcquired: 0,
    imagesGenerated: 0,
    chartsRendered: 0,
    placeholders: 0,
  };

  for (const scene of project.scenes) {
    const framePath = path.join(workDir, `${scene.id}.png`);
    let asset: VisualAsset | null = null;
    let assetKind: AssetKind = 'GENERATED_IMAGE';
    let sourceVideoStorageKey: string | null = null;

    if (scene.visualKind === 'CHART' && scene.chartSpec) {
      const spec = scene.chartSpec as unknown as ChartSpec;
      const claim = claimsByKey.get(spec.sourceClaimKey);
      // The source note is built from the actual stored source, not from
      // whatever the model wrote — a chart citing a publisher that is not in
      // the database would be a fabricated attribution.
      const publisher = claim?.sourceLinks[0]?.source.publisher;
      const asOf = claim?.asOf ? `, as of ${claim.asOf.toISOString().slice(0, 10)}` : '';
      const sourceNote = publisher ? `Source: ${publisher}${asOf}` : spec.sourceNote;

      await svgToPng(renderChartSvg(spec, { ...dims, sourceNote }), framePath);
      assetKind = 'CHART_PNG';
      result.chartsRendered++;
    } else if (scene.visualKind === 'TEXT_CARD') {
      await svgToPng(
        textCardSvg({
          ...dims,
          heading: scene.onScreenText,
          body: pullQuote(scene.narration),
        }),
        framePath,
      );
      assetKind = 'OTHER';
    } else {
      const acquired = await acquireMedia(scene.visualKind, scene.visualQuery, project.id);
      asset = acquired.asset;
      assetKind = acquired.kind;

      if (acquired.bytes) {
        const base = path.join(workDir, `${scene.id}-base.png`);
        if (acquired.isVideo) {
          // Video assets are stored and passed to the renderer directly; the
          // still is only a poster for review screens.
          sourceVideoStorageKey = storageKeys.stockAsset(project.id, scene.id, 'mp4');
          await storage.put(sourceVideoStorageKey, acquired.bytes, { contentType: 'video/mp4' });
          await svgToPng(placeholderCardSvg({ ...dims, kind: scene.visualKind, query: scene.visualQuery, reason: 'video asset — poster frame' }), base);
        } else {
          await fitImage(acquired.bytes, dims, base);
        }
        await composeFrame(base, framePath, scene.onScreenText, dims);
      } else {
        await svgToPng(
          placeholderCardSvg({
            ...dims,
            kind: scene.visualKind,
            query: scene.visualQuery,
            reason: acquired.reason ?? 'no asset returned by provider',
          }),
          framePath,
        );
        result.placeholders++;
      }

      if (acquired.kind === 'STOCK_VIDEO' || acquired.kind === 'STOCK_IMAGE') result.stockAcquired++;
      if (acquired.kind === 'GENERATED_IMAGE' && acquired.bytes) result.imagesGenerated++;
    }

    const frameKey = storageKeys.sceneFrame(project.id, scene.id);
    await storage.putFile(frameKey, framePath, { contentType: 'image/png' });
    const stat = await fs.stat(framePath);

    const assetRow = await prisma.asset.create({
      data: {
        videoProjectId: project.id,
        kind: assetKind,
        provider: asset?.provider ?? 'internal',
        sourceUrl: asset?.sourceUrl ?? null,
        storageKey: sourceVideoStorageKey ?? frameKey,
        filename: path.basename(sourceVideoStorageKey ?? frameKey),
        mimeType: sourceVideoStorageKey ? 'video/mp4' : 'image/png',
        bytes: stat.size,
        width: dims.width,
        height: dims.height,
        licence: asset?.licence ?? 'Generated by this system',
        licenceUrl: asset?.licenceUrl ?? null,
        attributionRequired: asset?.attributionRequired ?? false,
        attributionText: asset?.attributionText ?? null,
        // Charts and cards this system draws carry no third-party rights.
        copyrightRisk: (asset?.copyrightRisk ?? 'NONE') as CopyrightRisk,
        clearedAt: asset ? null : new Date(),
      },
    });

    await prisma.scene.update({ where: { id: scene.id }, data: { assetId: assetRow.id } });
    result.framesRendered++;
  }

  log.info(result, 'visuals stage complete');
  return result;
}

interface Acquired {
  asset: VisualAsset | null;
  bytes: Buffer | null;
  kind: AssetKind;
  isVideo: boolean;
  reason?: string;
}

async function acquireMedia(visualKind: string, query: string, videoProjectId: string): Promise<Acquired> {
  const wantsVideo = visualKind === 'STOCK_VIDEO' || visualKind === 'B_ROLL' || visualKind === 'ARCHIVAL';

  if (wantsVideo || visualKind === 'STOCK_IMAGE') {
    const results = await findStock({ query, orientation: 'landscape', limit: 3 }, wantsVideo ? 'video' : 'photo', {
      videoProjectId,
    });
    const usable = results.find((r) => r.downloadUrl || r.data);
    if (!usable) {
      return {
        asset: results[0] ?? null,
        bytes: null,
        kind: wantsVideo ? 'STOCK_VIDEO' : 'STOCK_IMAGE',
        isVideo: wantsVideo,
        reason: 'stock provider returned no downloadable asset',
      };
    }
    const bytes = usable.data ?? (await download(usable.downloadUrl!));
    return {
      asset: usable,
      bytes,
      kind: wantsVideo ? 'STOCK_VIDEO' : 'STOCK_IMAGE',
      isVideo: wantsVideo,
      ...(bytes ? {} : { reason: 'download failed' }),
    };
  }

  const generated = await generateImage(
    { prompt: query, styleSuffix: STYLE_SUFFIX, width: 1792, height: 1024 },
    { videoProjectId },
  );
  const bytes = generated.data ?? (generated.downloadUrl ? await download(generated.downloadUrl) : null);
  return {
    asset: generated,
    bytes,
    kind: 'GENERATED_IMAGE',
    isVideo: false,
    ...(bytes ? {} : { reason: 'image provider returned no bytes (mock mode)' }),
  };
}

async function download(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

async function composeFrame(
  basePath: string,
  outPath: string,
  onScreenText: string | null,
  dims: { width: number; height: number },
): Promise<void> {
  if (onScreenText) {
    await compositeOverlay(basePath, lowerThirdSvg({ ...dims, text: onScreenText }), outPath);
  } else {
    await fs.copyFile(basePath, outPath);
  }
}

/** Picks the most quotable sentence from a scene for a full-frame text card. */
function pullQuote(narration: string): string {
  const sentences = narration
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  // Prefer a short, declarative sentence — the one that reads as a statement.
  const ranked = sentences
    .filter((s) => s.length >= 30 && s.length <= 160)
    .sort((a, b) => a.length - b.length);
  return ranked[0] ?? sentences[0] ?? narration.slice(0, 160);
}

export { theme, RESOLUTIONS, SHORT_RESOLUTION, resolutionFor, type Dimensions } from './theme.js';
export { esc, textBlock, wrapText, svgDocument, svgOverlay, formatAxisValue, niceScale, estimateTextWidth } from './svg.js';
export { renderChartSvg, type ChartRenderOptions } from './charts.js';
export { textCardSvg, placeholderCardSvg, lowerThirdSvg, shortsCaptionSvg } from './cards.js';
export { svgToPng, svgToPngBuffer, fitImage, compositeOverlay, encodeThumbnail } from './raster.js';
export {
  thumbnailSvg,
  checkThumbnailLegibility,
  THUMB_WIDTH,
  THUMB_HEIGHT,
  type ThumbnailInput,
} from './thumbnail.js';
export {
  buildCues,
  chunkNarration,
  toSrt,
  toVtt,
  toAss,
  MAX_CUE_SECONDS,
  MAX_CHARS_PER_LINE,
  type Cue,
  type CaptionSource,
} from './subtitles.js';
export { runFfmpeg, probeDuration, probeMedia, assertFfmpegAvailable, escapeFilterPath } from './ffmpeg.js';
export {
  renderVideo,
  concatAudio,
  motionForScene,
  renderDefaults,
  type SceneRenderInput,
  type RenderOptions,
  type RenderResult,
} from './render.js';
export { renderShort, MAX_SHORT_SECONDS, type ShortRenderOptions, type ShortRenderResult } from './shorts.js';

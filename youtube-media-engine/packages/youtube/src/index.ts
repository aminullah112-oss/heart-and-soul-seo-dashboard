import { env } from '@yme/config';
import { MockYouTubeClient } from './mock.js';
import { GoogleYouTubeClient } from './google.js';
import type { YouTubeClient } from './types.js';

let cached: YouTubeClient | null = null;

/**
 * MOCK_MODE overrides YOUTUBE_PROVIDER unconditionally. Publishing is the one
 * irreversible action in this system, so the offline switch has to win.
 */
export function getYouTubeClient(): YouTubeClient {
  if (cached) return cached;
  cached = env.MOCK_MODE || env.YOUTUBE_PROVIDER === 'mock' ? new MockYouTubeClient() : new GoogleYouTubeClient();
  return cached;
}

export function resetYouTubeClient(): void {
  cached = null;
}

export { MockYouTubeClient, GoogleYouTubeClient };
export type { YouTubeClient, UploadRequest, UploadResult, VideoMetrics, Visibility } from './types.js';

/** YouTube category id 28 = Science & Technology; 22 = People & Blogs. */
export const YOUTUBE_CATEGORY_SCIENCE_TECH = '28';
export const YOUTUBE_CATEGORY_EDUCATION = '27';

export type Visibility = 'private' | 'unlisted' | 'public';

export interface UploadRequest {
  videoFilePath: string;
  title: string;
  description: string;
  tags: string[];
  categoryId: string;
  visibility: Visibility;
  publishAt?: Date | null;
  playlistId?: string | null;
  /** YouTube requires this declaration for synthetic or altered content. */
  containsSyntheticMedia: boolean;
  madeForKids: boolean;
  defaultLanguage?: string;
}

export interface UploadResult {
  youtubeId: string;
  uploadedAt: Date;
  visibility: Visibility;
  /** True when the mock provider produced this — never a real upload. */
  mock: boolean;
}

export interface VideoMetrics {
  asOf: Date;
  impressions: number | null;
  ctr: number | null;
  views: number | null;
  averageViewDurationSeconds: number | null;
  averageViewPercentage: number | null;
  watchTimeMinutes: number | null;
  subscribersGained: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  returningViewers: number | null;
  estimatedRevenueUsd: number | null;
  rpmUsd: number | null;
  trafficSources: Record<string, number> | null;
  retentionCurve: Array<{ ratio: number; audienceWatchRatio: number }> | null;
  /** Populated when a metric family was unavailable rather than zero. */
  unavailable: string[];
}

export interface YouTubeClient {
  readonly name: string;
  upload(req: UploadRequest): Promise<UploadResult>;
  setThumbnail(youtubeId: string, imagePath: string): Promise<void>;
  updateMetadata(
    youtubeId: string,
    patch: Partial<Pick<UploadRequest, 'title' | 'description' | 'tags' | 'visibility'>>,
  ): Promise<void>;
  fetchMetrics(youtubeId: string, publishedAt: Date): Promise<VideoMetrics>;
}

import type { CopyrightRisk } from '@yme/database';

export interface VisualAsset {
  provider: string;
  /** Where it came from. Null for assets this system generated. */
  sourceUrl: string | null;
  /** Direct download URL, or null when `data` carries the bytes. */
  downloadUrl: string | null;
  data?: Buffer;
  mimeType: string;
  width: number;
  height: number;
  durationSeconds?: number;
  licence: string;
  licenceUrl: string | null;
  attributionRequired: boolean;
  attributionText: string | null;
  copyrightRisk: CopyrightRisk;
}

export interface StockQuery {
  query: string;
  orientation?: 'landscape' | 'portrait';
  minWidth?: number;
  limit?: number;
}

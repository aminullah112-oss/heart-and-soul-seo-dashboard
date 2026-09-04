import { NextResponse, type NextRequest } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { getStorage } from '@yme/storage';
import { createReadStream, statSync } from 'node:fs';
import { Readable } from 'node:stream';

/**
 * Authenticated media route for the local storage driver.
 *
 * Renders are gigabytes and must not be served from a public path — an
 * unlisted URL is not access control, and an unpublished video leaking is the
 * exact failure this system is supposed to prevent.
 *
 * Range requests are honoured so the review page's <video> element can seek
 * without downloading a 400MB master first.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ key: string[] }> }) {
  const user = await getSessionUser();
  if (!user) return new NextResponse('Unauthorized', { status: 401 });

  const { key: segments } = await ctx.params;
  // A malformed percent-encoding makes decodeURIComponent throw; that is a bad
  // request, not a 500.
  let key: string;
  try {
    key = decodeURIComponent(segments.join('/'));
  } catch {
    return new NextResponse('Invalid media key', { status: 400 });
  }

  const storage = getStorage();
  if (storage.driver !== 'local') {
    // S3 is served by signed URL; this route exists only for the local driver.
    return NextResponse.redirect(await storage.signedUrl(key, 900));
  }

  // localPath rejects keys that escape the storage root. That is a bad
  // request, not a server error, and must not surface a stack trace.
  let filePath: string | null;
  try {
    filePath = storage.localPath(key);
  } catch {
    return new NextResponse('Invalid media key', { status: 400 });
  }
  if (!filePath) return new NextResponse('Not found', { status: 404 });

  let size: number;
  try {
    size = statSync(filePath).size;
  } catch {
    return new NextResponse('Not found', { status: 404 });
  }

  const contentType = guessType(key);
  const range = req.headers.get('range');

  if (range) {
    const match = /bytes=(\d*)-(\d*)/.exec(range);
    const start = match?.[1] ? Number(match[1]) : 0;
    const end = match?.[2] ? Number(match[2]) : Math.min(start + 4 * 1024 * 1024 - 1, size - 1);

    if (Number.isNaN(start) || start >= size) {
      return new NextResponse('Range Not Satisfiable', { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
    }

    const stream = createReadStream(filePath, { start, end });
    return new NextResponse(Readable.toWeb(stream) as ReadableStream, {
      status: 206,
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(end - start + 1),
        'Content-Range': `bytes ${start}-${end}/${size}`,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'private, max-age=0, no-store',
      },
    });
  }

  const stream = createReadStream(filePath);
  return new NextResponse(Readable.toWeb(stream) as ReadableStream, {
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(size),
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, max-age=0, no-store',
    },
  });
}

function guessType(key: string): string {
  const ext = key.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'mp4': return 'video/mp4';
    case 'png': return 'image/png';
    case 'jpg': case 'jpeg': return 'image/jpeg';
    case 'wav': return 'audio/wav';
    case 'mp3': return 'audio/mpeg';
    case 'srt': return 'application/x-subrip';
    case 'vtt': return 'text/vtt';
    default: return 'application/octet-stream';
  }
}

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { env, pricing } from '@yme/config';
import { EngineError, providerError, estimateNarrationSeconds, withRetry, withTimeout, stableId } from '@yme/shared';
import { recordCost } from '@yme/database';

const exec = promisify(execFile);

export interface SynthesisRequest {
  text: string;
  voiceId?: string;
  speed?: number;
}

export interface SynthesisResult {
  audio: Buffer;
  /** Container format of `audio`, e.g. "mp3" or "wav". */
  format: string;
  durationSeconds: number;
  characters: number;
}

export interface TtsProvider {
  readonly name: string;
  synthesize(req: SynthesisRequest): Promise<SynthesisResult>;
}

/**
 * Offline TTS. Produces a REAL audio file — silence at the duration the
 * narration would actually take — so the render pipeline downstream is
 * exercised end to end with correct scene timing. Returning a zero-byte
 * placeholder would let every timing bug through.
 */
class MockTtsProvider implements TtsProvider {
  readonly name = 'mock';

  async synthesize(req: SynthesisRequest): Promise<SynthesisResult> {
    const speed = req.speed && req.speed > 0 ? req.speed : 1;
    const duration = Math.max(0.6, estimateNarrationSeconds(req.text) / speed);
    const tmp = path.join(os.tmpdir(), `yme-tts-${stableId(req.text).slice(0, 12)}.wav`);

    try {
      await exec(env.FFMPEG_PATH, [
        '-hide_banner', '-loglevel', 'error', '-y',
        '-f', 'lavfi',
        '-i', `anullsrc=r=44100:cl=mono`,
        '-t', duration.toFixed(3),
        '-c:a', 'pcm_s16le',
        tmp,
      ]);
      const audio = await fs.readFile(tmp);
      return { audio, format: 'wav', durationSeconds: duration, characters: req.text.length };
    } catch (err) {
      throw new EngineError('PROVIDER', `Mock TTS could not run ffmpeg at "${env.FFMPEG_PATH}"`, {
        retryable: false,
        cause: err,
      });
    } finally {
      await fs.rm(tmp, { force: true });
    }
  }
}

class ElevenLabsProvider implements TtsProvider {
  readonly name = 'elevenlabs';

  async synthesize(req: SynthesisRequest): Promise<SynthesisResult> {
    const voice = req.voiceId || env.TTS_VOICE_ID;
    if (!voice) throw new EngineError('CONFIG', 'TTS_VOICE_ID is required for ElevenLabs');

    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}`, {
      method: 'POST',
      headers: {
        'xi-api-key': env.TTS_API_KEY,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text: req.text,
        model_id: env.TTS_MODEL || 'eleven_multilingual_v2',
        voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.15, use_speaker_boost: true },
      }),
    });

    if (res.status === 401) throw new EngineError('CONFIG', 'ElevenLabs rejected TTS_API_KEY', { retryable: false });
    if (res.status === 429) throw new EngineError('RATE_LIMIT', 'ElevenLabs rate limit', { retryable: true });
    if (!res.ok) throw providerError(`ElevenLabs TTS failed (${res.status}): ${await safeText(res)}`);

    const audio = Buffer.from(await res.arrayBuffer());
    return {
      audio,
      format: 'mp3',
      // Estimated here; the render step re-measures with ffprobe, which is the
      // number that actually drives scene timing.
      durationSeconds: estimateNarrationSeconds(req.text) / (req.speed ?? 1),
      characters: req.text.length,
    };
  }
}

class OpenAiTtsProvider implements TtsProvider {
  readonly name = 'openai';

  async synthesize(req: SynthesisRequest): Promise<SynthesisResult> {
    const res = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.TTS_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: env.TTS_MODEL || 'tts-1-hd',
        voice: req.voiceId || env.TTS_VOICE_ID || 'onyx',
        input: req.text,
        speed: req.speed ?? 1,
        response_format: 'mp3',
      }),
    });

    if (res.status === 401) throw new EngineError('CONFIG', 'OpenAI rejected TTS_API_KEY', { retryable: false });
    if (res.status === 429) throw new EngineError('RATE_LIMIT', 'OpenAI TTS rate limit', { retryable: true });
    if (!res.ok) throw providerError(`OpenAI TTS failed (${res.status}): ${await safeText(res)}`);

    return {
      audio: Buffer.from(await res.arrayBuffer()),
      format: 'mp3',
      durationSeconds: estimateNarrationSeconds(req.text) / (req.speed ?? 1),
      characters: req.text.length,
    };
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 300);
  } catch {
    return '(no body)';
  }
}

let cached: TtsProvider | null = null;

export function getTtsProvider(): TtsProvider {
  if (cached) return cached;
  if (env.MOCK_MODE || env.TTS_PROVIDER === 'mock') cached = new MockTtsProvider();
  else if (env.TTS_PROVIDER === 'elevenlabs') cached = new ElevenLabsProvider();
  else cached = new OpenAiTtsProvider();
  return cached;
}

export function resetTtsProvider(): void {
  cached = null;
}

/** Synthesis with retry, timeout and cost accounting. */
export async function synthesize(
  req: SynthesisRequest,
  ctx: { videoProjectId?: string | null; stage?: string } = {},
): Promise<SynthesisResult & { provider: string }> {
  const provider = getTtsProvider();

  const result = await withRetry(() => withTimeout(provider.synthesize(req), 120_000, `tts:${provider.name}`), {
    attempts: 3,
    baseDelayMs: 1500,
  });

  const ratePer1k = pricing.tts[provider.name] ?? pricing.tts.default!;
  const usd = (result.characters / 1000) * ratePer1k;
  if (usd > 0) {
    await recordCost({
      videoProjectId: ctx.videoProjectId ?? null,
      category: 'TTS',
      provider: provider.name,
      stage: ctx.stage ?? 'VOICE',
      usd,
      units: result.characters,
      unitLabel: 'characters',
      detail: { durationSeconds: result.durationSeconds },
    });
  }

  return { ...result, provider: provider.name };
}

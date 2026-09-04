import { validationError } from '@yme/shared';

/**
 * Pulls a JSON document out of a model reply.
 *
 * Models wrap JSON in prose or fences even when told not to. Rather than
 * failing the whole stage on a stray "Here you go:", extract the first
 * balanced object or array. Brace counting is string-aware, because a `}`
 * inside a narration string would otherwise truncate the document.
 */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();

  const direct = tryParse(trimmed);
  if (direct.ok) return direct.value;

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced?.[1]) {
    const r = tryParse(fenced[1].trim());
    if (r.ok) return r.value;
  }

  const slice = balancedSlice(trimmed);
  if (slice) {
    const r = tryParse(slice);
    if (r.ok) return r.value;
  }

  throw validationError('Model reply contained no parseable JSON', {
    preview: trimmed.slice(0, 400),
  });
}

function tryParse(s: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(s) };
  } catch {
    return { ok: false };
  }
}

function balancedSlice(text: string): string | null {
  const start = firstIndexOfAny(text, ['{', '[']);
  if (start < 0) return null;

  const open = text[start]!;
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      if (inString) escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function firstIndexOfAny(text: string, chars: string[]): number {
  let best = -1;
  for (const c of chars) {
    const i = text.indexOf(c);
    if (i >= 0 && (best < 0 || i < best)) best = i;
  }
  return best;
}

import { randomUUID, createHash } from 'node:crypto';

export const newId = (): string => randomUUID();

/** Deterministic id, used by mock providers so fixtures stay stable. */
export function stableId(...parts: string[]): string {
  return createHash('sha256').update(parts.join('::')).digest('hex').slice(0, 24);
}

export function slugify(input: string, maxLen = 60): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLen)
    .replace(/-+$/g, '');
}

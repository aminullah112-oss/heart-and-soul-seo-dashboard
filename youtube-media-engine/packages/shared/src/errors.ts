/**
 * Error taxonomy. The distinction that matters operationally is
 * retryable vs terminal: BullMQ retries the first and gives up on the second
 * instead of burning four attempts on a 401.
 */

export type ErrorKind =
  | 'CONFIG'
  | 'PROVIDER'
  | 'RATE_LIMIT'
  | 'TIMEOUT'
  | 'VALIDATION'
  | 'POLICY'
  | 'NOT_FOUND'
  | 'BUDGET'
  | 'RENDER'
  | 'INTERNAL';

export class EngineError extends Error {
  readonly kind: ErrorKind;
  readonly retryable: boolean;
  readonly details?: Record<string, unknown>;
  override readonly cause?: unknown;

  constructor(
    kind: ErrorKind,
    message: string,
    opts: { retryable?: boolean; details?: Record<string, unknown>; cause?: unknown } = {},
  ) {
    super(message);
    this.name = 'EngineError';
    this.kind = kind;
    this.retryable = opts.retryable ?? defaultRetryable(kind);
    this.details = opts.details;
    this.cause = opts.cause;
  }

  toJSON() {
    return { name: this.name, kind: this.kind, message: this.message, retryable: this.retryable, details: this.details };
  }
}

function defaultRetryable(kind: ErrorKind): boolean {
  switch (kind) {
    case 'RATE_LIMIT':
    case 'TIMEOUT':
    case 'PROVIDER':
      return true;
    case 'CONFIG':
    case 'VALIDATION':
    case 'POLICY':
    case 'NOT_FOUND':
    case 'BUDGET':
      return false;
    case 'RENDER':
    case 'INTERNAL':
      return true;
    default:
      return false;
  }
}

export const configError = (m: string, d?: Record<string, unknown>) => new EngineError('CONFIG', m, { details: d });
export const providerError = (m: string, o?: { cause?: unknown; details?: Record<string, unknown> }) =>
  new EngineError('PROVIDER', m, o);
export const policyError = (m: string, d?: Record<string, unknown>) => new EngineError('POLICY', m, { details: d });
export const budgetError = (m: string, d?: Record<string, unknown>) => new EngineError('BUDGET', m, { details: d });
export const validationError = (m: string, d?: Record<string, unknown>) =>
  new EngineError('VALIDATION', m, { details: d });
export const renderError = (m: string, o?: { cause?: unknown; details?: Record<string, unknown> }) =>
  new EngineError('RENDER', m, o);
export const notFound = (m: string) => new EngineError('NOT_FOUND', m);

export function isRetryable(e: unknown): boolean {
  if (e instanceof EngineError) return e.retryable;
  // Unknown errors are retried once by the queue's own attempt policy; treating
  // them as retryable here would mask genuine bugs as flakes.
  return false;
}

export function describeError(e: unknown): string {
  if (e instanceof EngineError) return `[${e.kind}] ${e.message}`;
  if (e instanceof Error) return e.message;
  return String(e);
}

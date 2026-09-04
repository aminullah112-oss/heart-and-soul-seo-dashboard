import { PrismaClient, Prisma } from '@prisma/client';

/**
 * One client per process. Next.js dev-mode hot reload re-evaluates modules,
 * which without this guard opens a new connection pool on every save and
 * exhausts Postgres' max_connections within a few minutes.
 */
const globalForPrisma = globalThis as unknown as { __ymePrisma?: PrismaClient };

export const prisma: PrismaClient =
  globalForPrisma.__ymePrisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === 'development'
        ? [{ emit: 'stdout', level: 'warn' }, { emit: 'stdout', level: 'error' }]
        : [{ emit: 'stdout', level: 'error' }],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.__ymePrisma = prisma;

export async function disconnect(): Promise<void> {
  await prisma.$disconnect();
}

export function withTransaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(fn, { timeout: 30_000 });
}

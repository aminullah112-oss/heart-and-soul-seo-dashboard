import { randomBytes, createHash } from 'node:crypto';
import { prisma } from '@yme/database';
const user = await prisma.user.findFirstOrThrow({ where: { role: 'OWNER' } });
const token = randomBytes(32).toString('base64url');
await prisma.session.create({
  data: { userId: user.id, tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt: new Date(Date.now() + 3600_000) },
});
const project = await prisma.videoProject.findFirst({ select: { id: true } });
console.log(JSON.stringify({ token, projectId: project?.id }));
await prisma.$disconnect();

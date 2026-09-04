/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Workspace packages ship TypeScript source, not build output, so Next has
  // to compile them itself.
  transpilePackages: [
    '@yme/agents', '@yme/ai', '@yme/analytics', '@yme/config',
    '@yme/database', '@yme/pipeline', '@yme/shared', '@yme/storage',
    '@yme/video', '@yme/audio', '@yme/images', '@yme/research', '@yme/youtube',
  ],
  experimental: {
    // Prisma, sharp and argon2 carry native bindings that must not be bundled.
    serverComponentsExternalPackages: ['@prisma/client', 'prisma', 'sharp', 'argon2'],
  },
  eslint: { ignoreDuringBuilds: true },
};
export default nextConfig;

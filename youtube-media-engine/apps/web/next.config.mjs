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

  // Prisma, sharp and argon2 carry native bindings that must not be bundled.
  serverExternalPackages: ['@prisma/client', 'prisma', 'sharp', 'argon2'],

  eslint: { ignoreDuringBuilds: true },

  webpack: (config) => {
    // The workspace packages are ESM TypeScript and import siblings with an
    // explicit `.js` extension, which is what the TS spec requires for
    // ESM output. Webpack resolves that literally and fails to find
    // `./channel.js` next to `channel.ts`. extensionAlias teaches it the
    // mapping; tsc already understands it.
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      '.js': ['.ts', '.tsx', '.js'],
    };
    return config;
  },
};

export default nextConfig;

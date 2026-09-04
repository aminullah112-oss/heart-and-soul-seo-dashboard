import argon2 from 'argon2';
import { prisma } from './client.js';
import { loadEnv, channelConfig, DEFAULT_SCORING_WEIGHTS } from '@yme/config';

/**
 * Idempotent seed. Creates the operator account, the channel row, a starter
 * pronunciation dictionary and a small sponsor watchlist. Running it twice is
 * safe and changes nothing.
 */
async function main() {
  const env = loadEnv();

  if (!env.BOOTSTRAP_PASSWORD) {
    throw new Error(
      'BOOTSTRAP_PASSWORD is empty. Set it in .env before seeding — the dashboard has no ' +
        'default password by design.',
    );
  }
  if (env.BOOTSTRAP_PASSWORD.length < 12) {
    throw new Error('BOOTSTRAP_PASSWORD must be at least 12 characters.');
  }

  const passwordHash = await argon2.hash(env.BOOTSTRAP_PASSWORD, { type: argon2.argon2id });

  const user = await prisma.user.upsert({
    where: { email: env.BOOTSTRAP_EMAIL },
    update: { role: 'OWNER', isActive: true },
    create: { email: env.BOOTSTRAP_EMAIL, name: 'Owner', passwordHash, role: 'OWNER' },
  });
  console.log(`✓ operator account: ${user.email}`);

  const existing = await prisma.channel.findFirst();
  const channel =
    existing ??
    (await prisma.channel.create({
      data: {
        name: channelConfig.name,
        positioning: channelConfig.positioning,
        category: channelConfig.category,
        language: channelConfig.language,
        primaryAudience: channelConfig.primaryAudience,
        videoLengthMinMinutes: channelConfig.videoLengthMinMinutes,
        videoLengthMaxMinutes: channelConfig.videoLengthMaxMinutes,
        publishPerWeek: channelConfig.publishPerWeek,
        shortsPerVideo: channelConfig.shortsPerVideo,
        minimumTopicScore: env.MINIMUM_TOPIC_SCORE,
        minimumQcScore: env.MINIMUM_QC_SCORE,
        automaticPublish: env.AUTOMATIC_PUBLISH,
        humanApproval: env.HUMAN_APPROVAL,
        scoringWeights: DEFAULT_SCORING_WEIGHTS as unknown as object,
        styleGuide: {
          voice: 'Conversational, intelligent, concise. Explains to a smart non-expert.',
          bannedPhrases: [
            'in today’s world',
            'game changer',
            'revolutionize',
            'delve into',
            'buckle up',
            'let’s dive in',
            'unlock the power',
          ],
          rules: [
            'Every number is attributed on screen and in the description.',
            'No investment advice, no price targets, no "you should buy".',
            'Do not state a causal claim the sources only correlate.',
            'Open loops must be closed inside the same video.',
          ],
        },
      },
    }));
  console.log(`✓ channel: ${channel.name}`);

  // Pronunciation entries that a TTS engine reliably gets wrong.
  const pronunciations: Array<[string, string, string]> = [
    ['NVIDIA', 'en-VID-ee-uh', 'Commonly read letter-by-letter by TTS engines'],
    ['SaaS', 'sass', 'Should not be spelled out'],
    ['EBITDA', 'ee-BIT-dah', ''],
    ['CapEx', 'CAP-ex', ''],
    ['ARR', 'A-R-R', 'Spell out; do not read as a word'],
    ['GPU', 'G-P-U', ''],
    ['CUDA', 'KOO-duh', ''],
    ['ASML', 'A-S-M-L', ''],
    ['TSMC', 'T-S-M-C', ''],
    ['LLM', 'L-L-M', ''],
    ['COGS', 'kogz', ''],
    ['Q4', 'Q four', 'Avoid "Q-fourth"'],
    ['YoY', 'year over year', ''],
    ['10-K', 'ten K', ''],
  ];
  for (const [written, spoken, note] of pronunciations) {
    await prisma.pronunciationEntry.upsert({
      where: { channelId_written: { channelId: channel.id, written } },
      update: { spoken, note: note || null },
      create: { channelId: channel.id, written, spoken, note: note || null },
    });
  }
  console.log(`✓ pronunciation dictionary: ${pronunciations.length} entries`);

  // Sponsor watchlist: categories that genuinely fit an AI/business audience.
  // Seeded as IDENTIFIED only — nothing here is contacted by the system.
  const sponsors: Array<[string, string, string]> = [
    ['Notion', 'Productivity SaaS', 'https://notion.so'],
    ['Ramp', 'Fintech / spend management', 'https://ramp.com'],
    ['Brilliant', 'Education', 'https://brilliant.org'],
    ['HubSpot', 'CRM / marketing SaaS', 'https://hubspot.com'],
    ['Vanta', 'Compliance automation', 'https://vanta.com'],
  ];
  for (const [company, category, website] of sponsors) {
    await prisma.sponsor.upsert({
      where: { channelId_company: { channelId: channel.id, company } },
      update: {},
      create: { channelId: channel.id, company, category, website, status: 'IDENTIFIED' },
    });
  }
  console.log(`✓ sponsor watchlist: ${sponsors.length} entries`);
  console.log('\nSeed complete.');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

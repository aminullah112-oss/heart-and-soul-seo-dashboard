/**
 * Default channel configuration (spec §47). These are *defaults*; the
 * persisted Channel row in the database is the source of truth once the
 * first-run wizard has been completed.
 */

export const DEFAULT_SCORING_WEIGHTS = {
  viralPotential: 0.14,
  searchDemand: 0.12,
  advertiserValue: 0.11,
  evergreenValue: 0.1,
  storyPotential: 0.14,
  timeliness: 0.06,
  competition: 0.08, // inverted before weighting: low competition scores high
  researchAvailability: 0.11,
  visualPotential: 0.06,
  affiliatePotential: 0.03,
  sponsorshipPotential: 0.03,
  channelRelevance: 0.02,
} as const;

export type ScoringWeightKey = keyof typeof DEFAULT_SCORING_WEIGHTS;

export const CONTENT_PILLARS = [
  {
    key: 'BUSINESS_CASE_STUDY',
    label: 'Business case studies',
    brief: 'How a specific company actually makes money, and why that model works.',
    examples: [
      'How Costco Makes Billions From Memberships',
      "Why McDonald's Is Really a Real Estate Business",
      'How Rolex Creates Artificial Scarcity',
    ],
  },
  {
    key: 'AI_BUSINESS',
    label: 'AI business',
    brief: 'The economics and strategy of AI companies and AI infrastructure.',
    examples: [
      'How OpenAI Plans to Make Billions',
      'The Economics of AI Infrastructure',
      'Why NVIDIA Controls the AI Supply Chain',
    ],
  },
  {
    key: 'AI_AUTOMATION_SAAS',
    label: 'AI automation & SaaS',
    brief: 'What automation does to software businesses and small operators.',
    examples: [
      'How AI Agents Automate Entire Workflows',
      'Why SaaS Companies Are Afraid of AI',
    ],
  },
  {
    key: 'BUSINESS_FAILURE',
    label: 'Business failures',
    brief: 'Why a company lost, told as a decision chain rather than a list of mistakes.',
    examples: ['Why Nokia Lost', 'Why WeWork Failed', 'Why BlackBerry Disappeared'],
  },
  {
    key: 'FUTURE_OF_BUSINESS',
    label: 'Future of business',
    brief: 'Where value moves next, grounded in current spend and capability.',
    examples: ['Industries AI Could Transform', 'The Next Trillion-Dollar AI Markets'],
  },
] as const;

export type PillarKey = (typeof CONTENT_PILLARS)[number]['key'];

export interface ChannelConfig {
  name: string;
  positioning: string;
  category: string;
  language: string;
  primaryAudience: string;
  videoLengthMinMinutes: number;
  videoLengthMaxMinutes: number;
  publishPerWeek: number;
  shortsPerVideo: number;
  automaticPublish: boolean;
  humanApproval: boolean;
  minimumTopicScore: number;
  minimumQcScore: number;
  scoringWeights: Record<ScoringWeightKey, number>;
}

export const channelConfig: ChannelConfig = {
  name: 'AI × Business × Money',
  positioning:
    'We explain the companies, technologies, business models and economic forces reshaping the world.',
  category: 'Business / Technology',
  language: 'English',
  primaryAudience:
    'English-speaking adults interested in business, technology, AI and money',
  videoLengthMinMinutes: 8,
  videoLengthMaxMinutes: 15,
  publishPerWeek: 2,
  shortsPerVideo: 2,
  automaticPublish: false,
  humanApproval: true,
  minimumTopicScore: 75,
  minimumQcScore: 85,
  scoringWeights: { ...DEFAULT_SCORING_WEIGHTS },
};

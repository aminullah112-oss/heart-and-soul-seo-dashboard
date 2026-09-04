/**
 * Mock subject catalogue.
 *
 * MOCK_MODE has to produce content that is coherent enough to exercise every
 * downstream check — the fact checker needs claims with real-looking source
 * URLs, the chart engine needs numeric series, the duplicate detector needs
 * overlapping subjects. Flat lorem ipsum would let broken code pass.
 *
 * IMPORTANT: every figure below is FABRICATED for testing. The `sourceUrl`
 * values point at real domains but are not real documents. Mock output is
 * marked as such at every layer and can never reach a publish call, because
 * the YouTube mock provider refuses to talk to the network at all.
 */

export interface MockSubject {
  key: string;
  company: string;
  pillar: 'BUSINESS_CASE_STUDY' | 'AI_BUSINESS' | 'AI_AUTOMATION_SAAS' | 'BUSINESS_FAILURE' | 'FUTURE_OF_BUSINESS';
  title: string;
  angle: string;
  signal: string;
  thesis: string;
  centralQuestion: string;
  entities: Array<{ name: string; kind: 'COMPANY' | 'TECHNOLOGY' | 'INDUSTRY' | 'PRODUCT' | 'BUSINESS_MODEL' | 'MARKET' | 'PERSON' }>;
  sources: Array<{ url: string; title: string; publisher: string; tier: string }>;
  series: Array<{ label: string; value: number }>;
  seriesUnit: string;
  seriesTitle: string;
}

export const MOCK_SUBJECTS: MockSubject[] = [
  {
    key: 'nvidia-ai-supply-chain',
    company: 'NVIDIA',
    pillar: 'AI_BUSINESS',
    title: 'How NVIDIA Turned a Gaming Chip Into the AI Toll Booth',
    angle:
      'CUDA, not the silicon, is the moat — a fifteen-year software bet that made every AI lab a tenant.',
    signal:
      'Data-centre segment now dwarfs gaming in the reported segment split, inverting the revenue mix the company was built on.',
    thesis:
      'NVIDIA did not win the AI market by building the fastest chip. It won by spending fifteen years making its chips the only ones researchers knew how to program, then charging rent on that habit.',
    centralQuestion:
      'Why can competitors ship comparable silicon and still fail to take NVIDIA’s customers?',
    entities: [
      { name: 'NVIDIA', kind: 'COMPANY' },
      { name: 'CUDA', kind: 'TECHNOLOGY' },
      { name: 'AMD', kind: 'COMPANY' },
      { name: 'TSMC', kind: 'COMPANY' },
      { name: 'Semiconductors', kind: 'INDUSTRY' },
      { name: 'Hyperscale data centres', kind: 'MARKET' },
    ],
    sources: [
      { url: 'https://investor.nvidia.com/financial-info/annual-reports/', title: 'NVIDIA Annual Report', publisher: 'NVIDIA Investor Relations', tier: 'PRIMARY_COMPANY' },
      { url: 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=NVDA', title: 'NVIDIA Corporation filings', publisher: 'SEC EDGAR', tier: 'REGULATORY_FILING' },
      { url: 'https://developer.nvidia.com/cuda-toolkit', title: 'CUDA Toolkit', publisher: 'NVIDIA Developer', tier: 'PRIMARY_COMPANY' },
      { url: 'https://www.tsmc.com/english/news-events/quarterly-results', title: 'TSMC quarterly results', publisher: 'TSMC', tier: 'PRIMARY_COMPANY' },
      { url: 'https://www.bls.gov/data/', title: 'Industry employment data', publisher: 'US Bureau of Labor Statistics', tier: 'GOVERNMENT' },
    ],
    seriesTitle: 'Reported data-centre vs gaming revenue',
    seriesUnit: 'USD billions (fabricated mock data)',
    series: [
      { label: 'FY20', value: 2.98 },
      { label: 'FY21', value: 6.7 },
      { label: 'FY22', value: 10.6 },
      { label: 'FY23', value: 15.0 },
      { label: 'FY24', value: 47.5 },
    ],
  },
  {
    key: 'costco-membership',
    company: 'Costco',
    pillar: 'BUSINESS_CASE_STUDY',
    title: 'Costco Sells Groceries at Cost — The Membership Is the Business',
    angle:
      'Retail margin is near zero by design; the profit line is a subscription business wearing a warehouse costume.',
    signal:
      'Membership fee income approximates operating income in the reported segment breakdown, year after year.',
    thesis:
      'Costco runs its merchandise operation close to break-even on purpose. The recurring membership fee is what the company actually sells, and every operational decision protects renewal rate rather than gross margin.',
    centralQuestion: 'What happens to Costco’s profit if the membership fee disappears?',
    entities: [
      { name: 'Costco', kind: 'COMPANY' },
      { name: 'Membership model', kind: 'BUSINESS_MODEL' },
      { name: 'Grocery retail', kind: 'INDUSTRY' },
      { name: 'Kirkland Signature', kind: 'PRODUCT' },
    ],
    sources: [
      { url: 'https://investor.costco.com/financial-information/annual-reports', title: 'Costco Annual Report', publisher: 'Costco Investor Relations', tier: 'PRIMARY_COMPANY' },
      { url: 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=COST', title: 'Costco Wholesale filings', publisher: 'SEC EDGAR', tier: 'REGULATORY_FILING' },
      { url: 'https://www.census.gov/retail/index.html', title: 'Monthly Retail Trade Survey', publisher: 'US Census Bureau', tier: 'GOVERNMENT' },
    ],
    seriesTitle: 'Membership fee income vs operating income',
    seriesUnit: 'USD billions (fabricated mock data)',
    series: [
      { label: 'FY20', value: 3.5 },
      { label: 'FY21', value: 3.9 },
      { label: 'FY22', value: 4.2 },
      { label: 'FY23', value: 4.6 },
      { label: 'FY24', value: 4.8 },
    ],
  },
  {
    key: 'wework-failure',
    company: 'WeWork',
    pillar: 'BUSINESS_FAILURE',
    title: 'WeWork Signed 15-Year Leases and Sold 1-Month Desks',
    angle:
      'A duration mismatch, not a personality. The business model could not survive any demand shock regardless of who ran it.',
    signal:
      'Long-term lease obligations vastly exceeded contracted member revenue in the S-1 disclosure.',
    thesis:
      'WeWork’s collapse was an arithmetic problem disclosed in its own filing: it owed fixed rent for fifteen years and collected cancellable rent by the month. The valuation story distracted from a maturity mismatch that had no good outcome.',
    centralQuestion: 'Was WeWork a real estate company that mispriced duration risk, or a tech company that never existed?',
    entities: [
      { name: 'WeWork', kind: 'COMPANY' },
      { name: 'Commercial real estate', kind: 'INDUSTRY' },
      { name: 'Duration mismatch', kind: 'BUSINESS_MODEL' },
      { name: 'SoftBank', kind: 'COMPANY' },
    ],
    sources: [
      { url: 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&company=wework', title: 'WeWork filings', publisher: 'SEC EDGAR', tier: 'REGULATORY_FILING' },
      { url: 'https://www.federalreserve.gov/data.htm', title: 'Commercial real estate data', publisher: 'Federal Reserve', tier: 'GOVERNMENT' },
      { url: 'https://www.reuters.com/business/', title: 'WeWork coverage archive', publisher: 'Reuters', tier: 'REPUTABLE_JOURNALISM' },
    ],
    seriesTitle: 'Lease obligations vs annual member revenue',
    seriesUnit: 'USD billions (fabricated mock data)',
    series: [
      { label: '2016', value: 4.2 },
      { label: '2017', value: 9.1 },
      { label: '2018', value: 18.0 },
      { label: '2019', value: 47.2 },
    ],
  },
  {
    key: 'saas-seat-pricing',
    company: 'SaaS industry',
    pillar: 'AI_AUTOMATION_SAAS',
    title: 'AI Agents Break the One Thing SaaS Depends On: Seats',
    angle:
      'Per-seat pricing assumes headcount grows with usage. Agents decouple them, and the entire revenue model has to be rewritten.',
    signal:
      'Multiple large vendors have begun publishing outcome-based and consumption pricing alongside per-seat tiers.',
    thesis:
      'The seat is the unit of account for most enterprise software revenue. When an agent does the work of four analysts under one licence, the vendor’s revenue falls while its delivered value rises — and no incumbent has a clean answer.',
    centralQuestion: 'What replaces the seat when software does the work instead of the person?',
    entities: [
      { name: 'SaaS', kind: 'INDUSTRY' },
      { name: 'Per-seat pricing', kind: 'BUSINESS_MODEL' },
      { name: 'AI agents', kind: 'TECHNOLOGY' },
      { name: 'Enterprise software', kind: 'MARKET' },
    ],
    sources: [
      { url: 'https://www.sec.gov/edgar/searchedgar/companysearch', title: 'Enterprise software filings', publisher: 'SEC EDGAR', tier: 'REGULATORY_FILING' },
      { url: 'https://www.bls.gov/oes/', title: 'Occupational employment statistics', publisher: 'US Bureau of Labor Statistics', tier: 'GOVERNMENT' },
      { url: 'https://arxiv.org/list/cs.SE/recent', title: 'Software engineering research', publisher: 'arXiv', tier: 'ACADEMIC' },
    ],
    seriesTitle: 'Illustrative revenue per customer under seat vs consumption pricing',
    seriesUnit: 'USD thousands (fabricated mock data)',
    series: [
      { label: 'Yr 1', value: 120 },
      { label: 'Yr 2', value: 138 },
      { label: 'Yr 3', value: 141 },
      { label: 'Yr 4', value: 129 },
      { label: 'Yr 5', value: 118 },
    ],
  },
  {
    key: 'ai-datacentre-capex',
    company: 'Hyperscalers',
    pillar: 'FUTURE_OF_BUSINESS',
    title: 'The AI Buildout Is a Utility Business Pretending to Be Software',
    angle:
      'Capex intensity, depreciation schedules and power contracts now dominate the economics — the metrics of a utility, not a software firm.',
    signal:
      'Combined hyperscaler capex guidance has repeatedly been revised upward while depreciation lives were extended.',
    thesis:
      'Software companies earned premium multiples because they needed almost no capital. The AI buildout reverses that: the same firms are now signing multi-decade power agreements and depreciating steel. The multiple has not caught up with the balance sheet.',
    centralQuestion: 'If AI infrastructure has utility economics, why is it still priced like software?',
    entities: [
      { name: 'Hyperscale data centres', kind: 'MARKET' },
      { name: 'Capital expenditure', kind: 'BUSINESS_MODEL' },
      { name: 'Electric utilities', kind: 'INDUSTRY' },
      { name: 'GPU clusters', kind: 'TECHNOLOGY' },
    ],
    sources: [
      { url: 'https://www.eia.gov/electricity/', title: 'Electricity data', publisher: 'US Energy Information Administration', tier: 'GOVERNMENT' },
      { url: 'https://www.sec.gov/edgar/searchedgar/companysearch', title: 'Hyperscaler filings', publisher: 'SEC EDGAR', tier: 'REGULATORY_FILING' },
      { url: 'https://www.iea.org/data-and-statistics', title: 'Energy statistics', publisher: 'International Energy Agency', tier: 'INDUSTRY_RESEARCH' },
    ],
    seriesTitle: 'Combined hyperscaler capital expenditure',
    seriesUnit: 'USD billions (fabricated mock data)',
    series: [
      { label: '2021', value: 118 },
      { label: '2022', value: 142 },
      { label: '2023', value: 158 },
      { label: '2024', value: 221 },
      { label: '2025', value: 310 },
    ],
  },
  {
    key: 'rolex-scarcity',
    company: 'Rolex',
    pillar: 'BUSINESS_CASE_STUDY',
    title: 'Rolex Manufactures Scarcity More Carefully Than It Manufactures Watches',
    angle:
      'Production discipline plus distribution control creates a secondary market that markets the brand for free.',
    signal:
      'Authorised-dealer waitlists persist for specific references while production capacity is publicly known to have grown.',
    thesis:
      'Rolex could satisfy demand and chooses not to. Constrained allocation turns customers into applicants and dealers into gatekeepers, and the resulting secondary-market premium does the advertising the company never has to buy.',
    centralQuestion: 'Why does a company deliberately leave demand unmet for decades?',
    entities: [
      { name: 'Rolex', kind: 'COMPANY' },
      { name: 'Artificial scarcity', kind: 'BUSINESS_MODEL' },
      { name: 'Luxury goods', kind: 'INDUSTRY' },
    ],
    sources: [
      { url: 'https://www.rolex.com/', title: 'Rolex official site', publisher: 'Rolex', tier: 'PRIMARY_COMPANY' },
      { url: 'https://www.fhs.swiss/eng/statistics.html', title: 'Swiss watch export statistics', publisher: 'Federation of the Swiss Watch Industry', tier: 'INDUSTRY_RESEARCH' },
      { url: 'https://www.reuters.com/business/retail-consumer/', title: 'Luxury sector coverage', publisher: 'Reuters', tier: 'REPUTABLE_JOURNALISM' },
    ],
    seriesTitle: 'Swiss watch exports by value',
    seriesUnit: 'CHF billions (fabricated mock data)',
    series: [
      { label: '2020', value: 16.9 },
      { label: '2021', value: 22.3 },
      { label: '2022', value: 24.8 },
      { label: '2023', value: 26.7 },
      { label: '2024', value: 26.0 },
    ],
  },
];

export function pickSubject(seed: string): MockSubject {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return MOCK_SUBJECTS[h % MOCK_SUBJECTS.length]!;
}

export function subjectByKey(key: string): MockSubject | undefined {
  return MOCK_SUBJECTS.find((s) => s.key === key);
}

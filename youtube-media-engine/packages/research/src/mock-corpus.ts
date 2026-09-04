/**
 * Offline search corpus.
 *
 * Every entry is a REAL, stable landing page — an SEC search endpoint, a
 * company IR index, a government statistics portal. They are used so that
 * MOCK_MODE exercises real URL parsing, real domain tiering and real dedupe
 * logic. The snippets are written for testing and are NOT quotations from
 * those pages; nothing here should ever be treated as sourced fact.
 */
export interface MockDoc {
  url: string;
  title: string;
  snippet: string;
  publisher: string;
  publishedAt: string | null;
}

export const MOCK_SEARCH_CORPUS: MockDoc[] = [
  {
    url: 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=NVDA&type=10-K',
    title: 'NVIDIA Corporation — Form 10-K filings',
    publisher: 'SEC EDGAR',
    publishedAt: '2025-02-21',
    snippet:
      'Annual report filings index for NVIDIA Corporation, including segment reporting for Data Center, Gaming, Professional Visualization and Automotive. [MOCK SNIPPET — not a quotation]',
  },
  {
    url: 'https://investor.nvidia.com/financial-info/financial-reports/',
    title: 'NVIDIA financial reports and quarterly results',
    publisher: 'NVIDIA Investor Relations',
    publishedAt: '2025-02-26',
    snippet:
      'Quarterly and annual results, including revenue by reportable segment and management commentary on data centre demand. [MOCK SNIPPET — not a quotation]',
  },
  {
    url: 'https://developer.nvidia.com/cuda-toolkit',
    title: 'CUDA Toolkit — developer documentation',
    publisher: 'NVIDIA Developer',
    publishedAt: null,
    snippet:
      'Development environment for GPU-accelerated applications, including libraries, compiler and profiling tools. [MOCK SNIPPET — not a quotation]',
  },
  {
    url: 'https://investor.costco.com/financial-information/annual-reports',
    title: 'Costco Wholesale annual reports',
    publisher: 'Costco Investor Relations',
    publishedAt: '2024-10-09',
    snippet:
      'Annual report archive including membership fee income, merchandise costs and operating income by segment. [MOCK SNIPPET — not a quotation]',
  },
  {
    url: 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=COST&type=10-K',
    title: 'Costco Wholesale Corporation — Form 10-K filings',
    publisher: 'SEC EDGAR',
    publishedAt: '2024-10-09',
    snippet:
      'Filing index covering membership economics, renewal rates and merchandise gross margin disclosure. [MOCK SNIPPET — not a quotation]',
  },
  {
    url: 'https://www.census.gov/retail/index.html',
    title: 'Monthly Retail Trade Survey',
    publisher: 'US Census Bureau',
    publishedAt: '2025-01-16',
    snippet:
      'Official monthly estimates of US retail and food services sales, used as an industry baseline. [MOCK SNIPPET — not a quotation]',
  },
  {
    url: 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&company=wework',
    title: 'WeWork — filing index',
    publisher: 'SEC EDGAR',
    publishedAt: '2023-11-06',
    snippet:
      'Registration statement and subsequent filings, including lease obligations and going-concern disclosure. [MOCK SNIPPET — not a quotation]',
  },
  {
    url: 'https://www.federalreserve.gov/data.htm',
    title: 'Federal Reserve data releases',
    publisher: 'Federal Reserve',
    publishedAt: '2025-02-01',
    snippet:
      'Statistical releases covering commercial real estate lending, credit conditions and industrial production. [MOCK SNIPPET — not a quotation]',
  },
  {
    url: 'https://www.bls.gov/oes/',
    title: 'Occupational Employment and Wage Statistics',
    publisher: 'US Bureau of Labor Statistics',
    publishedAt: '2025-04-02',
    snippet:
      'Employment and wage estimates by occupation and industry, used for automation-exposure baselines. [MOCK SNIPPET — not a quotation]',
  },
  {
    url: 'https://www.eia.gov/electricity/',
    title: 'Electricity data and analysis',
    publisher: 'US Energy Information Administration',
    publishedAt: '2025-03-12',
    snippet:
      'Generation, consumption and price data, relevant to data-centre load growth. [MOCK SNIPPET — not a quotation]',
  },
  {
    url: 'https://www.iea.org/data-and-statistics',
    title: 'IEA data and statistics',
    publisher: 'International Energy Agency',
    publishedAt: '2025-01-24',
    snippet:
      'Global energy statistics including electricity demand from data centres and networks. [MOCK SNIPPET — not a quotation]',
  },
  {
    url: 'https://www.tsmc.com/english/news-events/quarterly-results',
    title: 'TSMC quarterly results',
    publisher: 'TSMC',
    publishedAt: '2025-01-16',
    snippet:
      'Quarterly revenue by technology node and platform, including high-performance computing. [MOCK SNIPPET — not a quotation]',
  },
  {
    url: 'https://www.reuters.com/business/',
    title: 'Reuters business coverage',
    publisher: 'Reuters',
    publishedAt: '2025-03-01',
    snippet:
      'Wire coverage of corporate results, deals and industry shifts. [MOCK SNIPPET — not a quotation]',
  },
  {
    url: 'https://arxiv.org/list/cs.LG/recent',
    title: 'Machine learning preprints',
    publisher: 'arXiv',
    publishedAt: '2025-04-01',
    snippet:
      'Recent submissions in machine learning, including training-efficiency and inference-cost work. [MOCK SNIPPET — not a quotation]',
  },
  {
    url: 'https://www.fhs.swiss/eng/statistics.html',
    title: 'Swiss watch industry export statistics',
    publisher: 'Federation of the Swiss Watch Industry',
    publishedAt: '2025-01-21',
    snippet:
      'Monthly and annual export statistics by market and price segment. [MOCK SNIPPET — not a quotation]',
  },
  {
    url: 'https://www.sec.gov/edgar/searchedgar/companysearch',
    title: 'EDGAR full-text company search',
    publisher: 'SEC EDGAR',
    publishedAt: null,
    snippet:
      'Search interface for company filings across all registrants. [MOCK SNIPPET — not a quotation]',
  },
];

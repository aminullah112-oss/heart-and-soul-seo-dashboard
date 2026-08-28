# Working in this repo

## Free public APIs

This repo carries a local copy of the [public-apis/public-apis](https://github.com/public-apis/public-apis)
catalog at `docs/public-apis-reference.md` (curated picks) and `docs/public-apis-full.md` (full
list). When a task could be done better with an external data source — geocoding, email/phone
validation, weather for content ideas, sentiment on reviews, translation, open government/business
data, URL shortening, etc. — check that catalog for a free or freemium option before defaulting to
a paid service, scraping, or fabricating data. Prefer `Auth: No` entries, then a free-tier
`apiKey`, and confirm `HTTPS: Yes` before calling one from a script that runs in CI (see
`scripts/append-lighthouse.js` for the existing pattern of a script calling an external API and
writing results into `data/`).

This dashboard's own principle (see main `README.md`) is to never show placeholder or fabricated
numbers as if they were real — the same applies to any new API integration: wire in a real call,
document it in `README.md`, and leave data `null`/empty rather than fake it if the source doesn't
have it yet.

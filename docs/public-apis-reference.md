# Public APIs reference

A local copy of the [public-apis/public-apis](https://github.com/public-apis/public-apis) list —
a community-curated catalog of free and freemium public APIs — kept in this repo so Claude (and
anyone else working on this dashboard) can check it for a free API before reaching for a paid
service or building something from scratch.

Synced from commit [`988c57b`](https://github.com/public-apis/public-apis/commit/988c57be4616cc9507fd3e8c34adedba5387f079)
(2026-08-27). To refresh, re-pull `README.md` from that repo and re-run the same extraction
(index + category tables, promotional banner stripped) into `public-apis-full.md`.

## How to use this

Before building a new feature that needs external data (geocoding a client address, validating a
contact-form email, pulling local weather for a social caption idea, checking a business
registry, translating a post, etc.), check the **Quick picks** table below first, then the full
catalog in [`public-apis-full.md`](./public-apis-full.md) if nothing there fits. Prefer entries
with `Auth: No` (no signup needed) or a free-tier `apiKey` over paid alternatives, and always
confirm `HTTPS: Yes` before using one from this repo's server-side scripts (see
`scripts/append-lighthouse.js` for the existing pattern of a script calling an external API and
writing the result into `data/`).

This list is informational, not a dependency — nothing here is wired into the dashboard yet.
Anything actually integrated should be documented in the main `README.md`, the same way
`data/lighthouse-history.json` and `data/business-metrics.json` are.

## Quick picks for this project

Selected for relevance to a local-business SEO dashboard, preferring no-auth or generous free-tier
options with HTTPS support.

| Need | API | Auth | Notes |
|---|---|---|---|
| Geocode the studio's address (lat/lon for maps, local schema markup) | [Nominatim](https://nominatim.org/release-docs/latest/api/Overview/) | No | OpenStreetMap-based forward/reverse geocoding |
| Local weather for content/caption ideas | [Open-Meteo](https://open-meteo.com/) | No | Free for non-commercial use, no signup |
| Validate an email before it hits a contact form or the 90-day plan's outreach steps | [EVA](https://eva.pingutil.com/) / [Disify](https://www.disify.com/) | No | Syntax + disposable-address checks |
| Validate/format a phone number (NAP consistency work) | [Phone Specification](https://github.com/azharimm/phone-specs-api) | No | Also see `Numlookup`/`Veriphone` (apiKey) for carrier lookup |
| Sentiment on a batch of reviews | [Sentiment Analysis (MeaningCloud)](https://www.meaningcloud.com/developer/sentiment-analysis) | apiKey | Free tier available |
| Translate a caption/post draft | [LibreTranslate](https://libretranslate.com/docs) | No | Self-hostable, 17 languages |
| Shorten a link for a caption or GBP post | [Shrtco.de](https://shrtco.de/docs) / [1pt](https://github.com/1pt-co/api/blob/main/README.md) | No | Multiple no-auth options in the full list |
| US business/company lookups (competitor or citation research) | [Census.gov](https://www.census.gov/data/developers/data-sets.html) / [Data USA](https://datausa.io/about/api/) | No | US-specific; see `Government`/`Open Data` sections for other countries |
| Currency conversion (if pricing content ever needs it) | [Frankfurter](https://www.frankfurter.app/docs) | No | ECB-sourced rates |

For anything else — social platforms, additional geocoding/mapping providers, more validation
services, open government data by country, URL shorteners, weather providers — see the full list.

## Full catalog

See [`public-apis-full.md`](./public-apis-full.md) for the complete, unfiltered category index
and tables (every category from Animals to Weather), copied as-is from the source repo's README
(minus its promotional header).

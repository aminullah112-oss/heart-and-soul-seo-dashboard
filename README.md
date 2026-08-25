# Heart & Soul — SEO Performance Dashboard

Live at: https://aminullah112-oss.github.io/heart-and-soul-seo-dashboard/

A separate, small system that tracks SEO performance for the
[Heart & Soul Hair Studio landing page](https://aminullah112-oss.github.io/heart-and-soul-hair-studio-landing/)
and reports on it weekly.

## What updates automatically

`.github/workflows/weekly-audit.yml` runs every Monday (and can be triggered manually from the
Actions tab). It runs a real [Lighthouse](https://developer.chrome.com/docs/lighthouse/) audit
against the live landing page, extracts the Performance / Accessibility / Best Practices / SEO
scores plus Core Web Vitals (LCP, CLS, TBT), and appends the result to
`data/lighthouse-history.json`. The dashboard reads that file directly — no manual step needed.

## What updates manually, and why

Google Business Profile, Instagram, and Google Search Console don't offer a free public API that
works without the studio's own account access (OAuth tokens, a linked Meta Business app, etc.).
Rather than fake this data or leave it silently missing, `data/business-metrics.json` is a plain
JSON file with a documented schema — add one entry per week, by hand, from each platform's own
Insights screen:

- **Google Business Profile** → Business Profile app → Performance/Insights tab
- **Instagram** → Professional dashboard → Insights
- **Google Search Console** → Performance report (once the property is verified)

The dashboard will show an empty state until the first entry is added — it will never show
placeholder numbers as if they were real.

## Repo layout

```
index.html                        the dashboard itself
data/lighthouse-history.json      auto-updated weekly by the GitHub Action
data/business-metrics.json        hand-updated weekly (see schema in the file)
scripts/append-lighthouse.js      used by the Action to append a new audit entry
.github/workflows/weekly-audit.yml
```

## Adding a week of business metrics

Open `data/business-metrics.json` and append an object to `entries`, e.g.:

```json
{
  "week": "2026-09-01",
  "gbp_views": 340,
  "gbp_calls": 12,
  "gbp_directionRequests": 8,
  "gbp_reviewCount": 14,
  "gbp_avgRating": 4.8,
  "ig_followers": 12100,
  "ig_reach": 5400,
  "ig_engagement": 610,
  "gsc_impressions": 2200,
  "gsc_clicks": 95,
  "gsc_avgPosition": 18.4
}
```

Leave any field `null` if that number isn't available yet — the dashboard renders `—` rather than
guessing. Commit and push; GitHub Pages rebuilds automatically within a minute or two.

## Manually triggering an audit

GitHub → this repo → **Actions** tab → **Weekly SEO Audit** → **Run workflow**. Useful right after
shipping a change to the landing page, instead of waiting for Monday.

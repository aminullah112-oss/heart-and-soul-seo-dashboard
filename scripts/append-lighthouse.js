const fs = require("fs");
const path = require("path");

const resultPath = path.join(__dirname, "..", "lh-result.json");
const historyPath = path.join(__dirname, "..", "data", "lighthouse-history.json");

const result = JSON.parse(fs.readFileSync(resultPath, "utf8"));
const history = JSON.parse(fs.readFileSync(historyPath, "utf8"));

const cats = result.categories;
const audits = result.audits;
const today = new Date().toISOString().slice(0, 10);

const entry = {
  date: today,
  performance: Math.round(cats.performance.score * 100),
  accessibility: Math.round(cats.accessibility.score * 100),
  bestPractices: Math.round(cats["best-practices"].score * 100),
  seo: Math.round(cats.seo.score * 100),
  lcp: audits["largest-contentful-paint"] ? Number(audits["largest-contentful-paint"].numericValue / 1000).toFixed(2) * 1 : null,
  cls: audits["cumulative-layout-shift"] ? Number(audits["cumulative-layout-shift"].numericValue).toFixed(3) * 1 : null,
  tbt: audits["total-blocking-time"] ? Math.round(audits["total-blocking-time"].numericValue) : null,
};

// replace any existing entry for today (re-runs), else append
const idx = history.entries.findIndex((e) => e.date === today);
if (idx >= 0) history.entries[idx] = entry;
else history.entries.push(entry);

fs.writeFileSync(historyPath, JSON.stringify(history, null, 2) + "\n", "utf8");
console.log("Recorded audit for", today, entry);

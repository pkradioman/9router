#!/usr/bin/env node
// Re-price historical usage rows and rebuild the daily rollup.
//
//   node --experimental-default-type=module scripts/repair-usage-costs.mjs           # dry run
//   node --experimental-default-type=module scripts/repair-usage-costs.mjs --seed    # dry run + show seeding
//   node --experimental-default-type=module scripts/repair-usage-costs.mjs --apply --seed
//
// The app must be stopped for --apply (it refuses while /api/health answers,
// unless --force). A timestamped copy of the database is written first.
//
// Rates seeded here come from the operator's own provider configuration and,
// for Mistral, models.dev (`deepseek-v4-1-flash-1017`: 0.30 / 1.20 / 0.007).
// Existing kv entries are never overwritten - this only fills gaps.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { aggregateEntryToDay, getLocalDateKey } from "../src/lib/db/repos/usageAggregate.js";

const pricing = await import(pathToFileURL(path.resolve("open-sse/providers/pricing.js")).href);

const SEED_PRICING = {
  "mistral-studio": {
    "deepseek-v4-1-flash-1017": { input: 0.3, output: 1.2, cached: 0.007, reasoning: 1.2, cache_creation: 0 },
  },
  "mistral-vibe": {
    "deepseek-v4-1-flash-1017": { input: 0.3, output: 1.2, cached: 0.007, reasoning: 1.2, cache_creation: 0 },
  },
  "river": {
    "deepseek-ai/DeepSeek-V4.1-Flash-1017": { input: 0.12, output: 0.48, cached: 0.0024, reasoning: 0.48, cache_creation: 0 },
  },
  "deploy-ai": {
    "deepseek-ai/deepseek-v4.1-flash-1017": { input: 0.1, output: 0.35, cached: 0.003, reasoning: 0.35, cache_creation: 0 },
  },
};

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const value = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : fallback;
};

const apply = flag("apply");
const seed = flag("seed");
const force = flag("force");
const defaultDir = process.platform === "win32"
  ? path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "9router")
  : path.join(os.homedir(), ".9router");
const dataDir = process.env.DATA_DIR || defaultDir;
const dbPath = path.resolve(value("db", path.join(dataDir, "db", "data.sqlite")));

if (!fs.existsSync(dbPath)) {
  console.error(`Database not found: ${dbPath}`);
  process.exit(1);
}

if (apply && !force) {
  const up = await fetch("http://127.0.0.1:20128/api/health", { signal: AbortSignal.timeout(1500) })
    .then(() => true).catch(() => false);
  if (up) {
    console.error("9Router is running. Stop it first (or pass --force if you accept the risk).");
    process.exit(1);
  }
}

function hostAlias(rawUrl) {
  if (!rawUrl) return null;
  try {
    const host = new URL(String(rawUrl)).hostname.toLowerCase();
    const label = host.replace(/^(api|www|api\d*)\./, "").split(".")[0];
    return label || null;
  } catch {
    return null;
  }
}

console.log(`database: ${dbPath}`);
console.log(`mode: ${apply ? "APPLY" : "dry-run"}${seed ? " + seed" : ""}`);

const db = new DatabaseSync(dbPath, { readOnly: !apply });
db.exec("PRAGMA busy_timeout = 3000");

const userPricing = {};
for (const row of db.prepare("SELECT key, value FROM kv WHERE scope = 'pricing'").all()) {
  try { userPricing[row.key] = JSON.parse(row.value); } catch {}
}
const nodeById = new Map(db.prepare("SELECT id, data FROM providerNodes").all().map((r) => {
  try { return [r.id, JSON.parse(r.data)]; } catch { return [r.id, {}]; }
}));

const seeds = [];
if (seed) {
  for (const [provider, models] of Object.entries(SEED_PRICING)) {
    for (const [model, rates] of Object.entries(models)) {
      if (!userPricing[provider]?.[model]) seeds.push({ provider, model, rates });
    }
  }
  // Resolve against the seeded rates too, so the dry run matches what --apply
  // would produce.
  for (const s of seeds) {
    userPricing[s.provider] ||= {};
    userPricing[s.provider][s.model] = s.rates;
  }
  console.log(`\npricing gaps to seed: ${seeds.length}`);
  for (const s of seeds) console.log(`  ${s.provider} / ${s.model} -> ${s.rates.input}/${s.rates.output}/${s.rates.cached}`);
}

function keysFor(provider) {
  const node = nodeById.get(provider);
  const keys = [provider];
  if (node?.prefix) keys.push(node.prefix);
  const host = hostAlias(node?.baseUrl);
  if (host) keys.push(host);
  return [...new Set(keys)];
}

function resolve(provider, model) {
  const keys = keysFor(provider);
  for (const key of keys) {
    const declared = userPricing[key]?.[model];
    if (declared) return { pricing: declared, via: key };
  }
  const isCustom = keys.some((k) => k.startsWith("openai-compatible-"));
  if (isCustom) {
    for (const key of keys) {
      const exact = pricing.getExactPricingForModel(key, model);
      if (exact) return { pricing: exact, via: key };
    }
    return { pricing: null, via: null };
  }
  return { pricing: pricing.getPricingForModel(provider, model), via: provider };
}

function legacySplit(tokens, total) {
  const prompt = tokens.prompt_tokens || tokens.input_tokens || 0;
  const completion = tokens.completion_tokens || tokens.output_tokens || 0;
  const cached = tokens.cached_tokens || tokens.cache_read_input_tokens || 0;
  const sum = prompt + completion;
  if (!sum || !total) return { input: 0, cached: 0, output: 0, reasoning: 0, cacheCreation: 0, total: total || 0 };
  return {
    input: Math.max(0, prompt - cached) * (total / sum),
    cached: cached * (total / sum),
    output: completion * (total / sum),
    reasoning: 0,
    cacheCreation: 0,
    total,
  };
}

const rows = db.prepare(
  "SELECT id, timestamp, provider, model, connectionId, apiKey, endpoint, cost, tokens, meta FROM usageHistory ORDER BY id ASC"
).all();

let beforeTotal = 0;
let afterTotal = 0;
let unpriced = 0;
const perProvider = new Map();
const days = new Map();
const updates = [];

for (const row of rows) {
  let tokens = {};
  let meta = {};
  try { tokens = JSON.parse(row.tokens) || {}; } catch {}
  try { meta = JSON.parse(row.meta) || {}; } catch {}

  const { pricing: rate, via } = resolve(row.provider, row.model);
  let components = rate ? pricing.calculateCostBreakdown(tokens, rate) : null;
  // No rate for this provider/model: keep the stored cost (it may come from a
  // deleted node or a legacy estimate). Writing 0 here would erase history.
  // The split is apportioned by token share so the columns still sum to the total.
  const cost = components ? components.total : (row.cost || 0);
  const priced = !!components;
  const estimated = !components && cost > 0;
  if (!components) components = legacySplit(tokens, cost);

  beforeTotal += row.cost || 0;
  afterTotal += cost;
  if (!priced) unpriced++;

  if (!perProvider.has(row.provider)) perProvider.set(row.provider, { before: 0, after: 0, n: 0, unpriced: 0 });
  const p = perProvider.get(row.provider);
  p.before += row.cost || 0;
  p.after += cost;
  p.n++;
  if (!priced) p.unpriced++;

  const entry = {
    timestamp: row.timestamp,
    provider: row.provider,
    model: row.model,
    connectionId: row.connectionId,
    apiKey: row.apiKey,
    endpoint: row.endpoint,
    tokens,
    cost,
    priced,
    costComponents: components,
  };

  const dateKey = getLocalDateKey(row.timestamp);
  if (!days.has(dateKey)) {
    days.set(dateKey, { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0, byProvider: {}, byModel: {}, byAccount: {}, byApiKey: {}, byEndpoint: {} });
  }
  aggregateEntryToDay(days.get(dateKey), entry);

  if (apply) {
    const nextMeta = { ...meta, priced, ...(estimated ? { costEstimated: true } : {}), costComponents: components };
    updates.push({ id: row.id, cost, meta: nextMeta });
  }
}

console.log(`\nrows: ${rows.length}`);
for (const [provider, p] of [...perProvider].sort((a, b) => b[1].after - a[1].after)) {
  const node = nodeById.get(provider);
  const label = node?.prefix ? `${provider} (${node.prefix})` : provider;
  console.log(`  ${label}\n    n=${p.n} no-rate=${p.unpriced} before=$${p.before.toFixed(4)} after=$${p.after.toFixed(4)}`);
}
console.log(`total: $${beforeTotal.toFixed(4)} -> $${afterTotal.toFixed(4)}`);
if (unpriced) console.log(`no rate for ${unpriced} request(s): stored cost kept, marked unpriced`);

if (apply) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backup = `${dbPath}.bak-${stamp}`;
  fs.copyFileSync(dbPath, backup);
  for (const suffix of ["-wal", "-shm"]) {
    if (fs.existsSync(dbPath + suffix)) fs.copyFileSync(dbPath + suffix, backup + suffix);
  }
  console.log(`backup: ${backup}`);

  db.exec("BEGIN");
  try {
    for (const u of updates) {
      db.prepare("UPDATE usageHistory SET cost = ?, meta = ? WHERE id = ?").run(u.cost, JSON.stringify(u.meta), u.id);
    }
    for (const s of seeds) {
      const current = userPricing[s.provider] || {};
      current[s.model] = s.rates;
      userPricing[s.provider] = current;
      db.prepare(
        "INSERT INTO kv(scope, key, value) VALUES('pricing', ?, ?) ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value"
      ).run(s.provider, JSON.stringify(current));
    }
    db.prepare("DELETE FROM usageDaily").run();
    for (const [dateKey, day] of days) {
      db.prepare("INSERT INTO usageDaily(dateKey, data) VALUES(?, ?)").run(dateKey, JSON.stringify(day));
    }
    db.exec("COMMIT");
    console.log(`rebuilt usageDaily for ${days.size} day(s)${seeds.length ? ` and seeded ${seeds.length} rate(s)` : ""}`);
  } catch (err) {
    db.exec("ROLLBACK");
    console.error("apply failed, rolled back:", err.message);
    process.exitCode = 1;
  }
} else {
  console.log("\ndry run: nothing written. Re-run with --apply (app stopped).");
}

db.close();

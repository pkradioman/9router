import { getAdapter } from "../driver.js";
import { parseJson } from "../helpers/jsonCol.js";
import { getProviderPricingKeys } from "./usageRepo.js";
import { getPricingForModel } from "./pricingRepo.js";
import { SAVER_PERIODS, summarizeSaverRows } from "../../tokenSaver/stats.js";

// Reads usageHistory directly instead of usageDaily: the cohort analysis needs
// per-request flags, and keeping it out of the daily rollup means no migration,
// no backfill script change, and no drift with the cost aggregates.
export async function getTokenSaverStats(period = "7d") {
  const db = await getAdapter();
  const windowMs = SAVER_PERIODS[period] ?? SAVER_PERIODS["7d"];
  const cutoff = windowMs ? new Date(Date.now() - windowMs).toISOString() : null;

  const rows = cutoff
    ? db.all(
        `SELECT timestamp, provider, model, tokens, meta FROM usageHistory WHERE timestamp >= ? ORDER BY timestamp ASC`,
        [cutoff]
      )
    : db.all(`SELECT timestamp, provider, model, tokens, meta FROM usageHistory ORDER BY timestamp ASC`);

  const summary = summarizeSaverRows(
    rows.map((r) => ({
      timestamp: r.timestamp,
      provider: r.provider,
      model: r.model,
      tokens: parseJson(r.tokens, {}) || {},
      meta: parseJson(r.meta, {}) || {},
    }))
  );

  // Gross money range for the bytes RTK removed: input rate is the realistic
  // case (fresh tool output is usually not cached yet), cached rate is the floor
  // if that content would have been served from cache anyway.
  let inputCostEst = 0;
  let cachedCostEst = 0;
  let unpricedBytes = 0;
  for (const m of summary.rtk.byModel) {
    const keys = await getProviderPricingKeys(m.provider);
    const pricing = await getPricingForModel(m.provider, m.model, keys);
    if (!pricing) {
      m.priced = false;
      unpricedBytes += m.bytesSaved;
      continue;
    }
    m.priced = true;
    m.inputCostEst = (m.tokensSavedEst * (pricing.input || 0)) / 1e6;
    m.cachedCostEst = (m.tokensSavedEst * (pricing.cached ?? pricing.input ?? 0)) / 1e6;
    inputCostEst += m.inputCostEst;
    cachedCostEst += m.cachedCostEst;
  }

  return {
    period,
    requestsTotal: rows.length,
    ...summary,
    rtk: {
      ...summary.rtk,
      inputCostEst: +inputCostEst.toFixed(6),
      cachedCostEst: +cachedCostEst.toFixed(6),
      unpricedBytes,
    },
  };
}

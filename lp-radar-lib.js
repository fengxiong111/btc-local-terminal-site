// Pure public-data research screening. A research lead is NOT an investable/net-return winner.
const num = v => typeof v === "number" && Number.isFinite(v) ? v : null;
const number = (v, d = null) => num(v) ?? d;
const stable = new Set(["USDC", "USDT", "USDG", "DAI", "USDS", "PYUSD"]);
const major = new Set(["SOL", "BTC", "WBTC", "ETH", "WETH", "JITOSOL", "MSOL", "JUPSOL"]);
const round = (v, n=2) => Math.round(v * 10**n) / 10**n;

export function chooseMerkl(opps, nowMs = Date.now(), feeEvidenceByPool = {}) {
  if (!Array.isArray(opps)) return null;
  const nowSec = nowMs / 1000;
  const entries = opps.flatMap(o => {
    if (o?.status !== "LIVE" || !/^UNISWAP_V[34]$/.test(o.type) ||
      o.action !== "POOL" || !/^Provide liquidity/i.test(String(o.name)) ||
      !o.identifier || !Number.isInteger(o.chainId) || number(o.tvl, 0) < 30000) return [];
    const campaigns = (Array.isArray(o.campaigns) ? o.campaigns : []).filter(c =>
      number(c.startTimestamp, Infinity) <= nowSec &&
      number(c.endTimestamp, 0) > nowSec + 48*3600 &&
      !c.isPrivate && !c.hidden && c.rewardToken?.verified === true &&
      number(c.rewardToken?.price, 0) > 0 &&
      !(Array.isArray(c.params?.whitelist) && c.params.whitelist.length > 0) &&
      !(Array.isArray(c.params?.blacklist) && c.params.blacklist.length > 0) &&
      (!c.campaignStatus?.status || c.campaignStatus.status === "SUCCESS"));
    if (!campaigns.length || number(o.apr, 0) <= 0) return [];
    const poolKey = `${o.chainId}:${o.identifier}`;
    const ev = feeEvidenceByPool[poolKey];
    // Merkl APR is an incentive estimate, not actual underlying swap fees.
    // Without INDEPENDENT recent pool-fee evidence, do not even rank this as a revenue lead.
    if (!ev || !Number.isFinite(ev.observed_at_ms) || nowMs - ev.observed_at_ms > 90*60000 ||
      ev.observed_at_ms > nowMs + 120000 ||
      number(ev.pool_fee_usd_24h, 0) <= 0 || number(ev.active_liquidity_usd, 0) <= 0 ||
      number(ev.natural_volume_usd_4h, 0) <= 0) return [];
    const nearestEnd = Math.min(...campaigns.map(c => c.endTimestamp));
    const flags = campaigns.flatMap(c => [
      c.params?.hooks && c.params.hooks !== "0x0000000000000000000000000000000000000000" ? "hook_rules" : null,
      c.params?.weightFees !== undefined ? "fee_weight_rules" : null,
      c.params?.isOutOfRangeIncentivized !== undefined ? "out_of_range_rules" : null,
      c.params?.computeScoreParameters !== undefined ? "score_formula" : null
    ].filter(Boolean));
    const score = ev.pool_fee_usd_24h / ev.active_liquidity_usd *
      Math.min(1, Math.sqrt(ev.active_liquidity_usd / 300000)) *
      Math.min(1, Math.sqrt((nearestEnd-nowSec) / (7*86400)));
    return [{
      platform: "Merkl", name: o.name, opportunity_id: String(o.id), type: o.type,
      chain_id: o.chainId, pool_identifier: o.identifier, tvl_usd: o.tvl,
      incentive_apr_pct: o.apr, reward_tokens: [...new Set(campaigns.map(c => c.rewardToken.symbol))],
      nearest_end_unix_sec: nearestEnd, valid_campaign_count: campaigns.length,
      estimated_pool_fee_24h_usd: ev.pool_fee_usd_24h, active_liquidity_usd: ev.active_liquidity_usd,
      campaign_mechanism_flags: [...new Set(flags)],
      score: round(score, 9), status: "RESEARCH_ONLY_NET_EDGE_UNKNOWN",
      missing: ["position_specific_reward_eligibility", "campaign_dilution",
        "position_realized_fee_velocity", "entry_and_exit_quotes", "inventory_IL",
        "net_yield_after_all_costs"]
    }];
  });
  return entries.sort((a,b) => b.score-a.score || a.opportunity_id.localeCompare(b.opportunity_id))[0] || null;
}

export function chooseMeteora(pools, nowMs = Date.now()) {
  if (!Array.isArray(pools)) return null;
  const entries = pools.flatMap(p => {
    const tvl = number(p?.tvl, 0), ageMs = nowMs - number(p?.created_at, nowMs);
    const ageDays = ageMs / 86400000, fees = p?.fees || {}, volume = p?.volume || {};
    if (p?.is_blacklisted || !p?.address || !p.token_x?.address || !p.token_y?.address ||
      p.token_x?.is_verified !== true || p.token_y?.is_verified !== true ||
      !p.token_x?.symbol || !p.token_y?.symbol || ageDays < 7 || ageDays > 3650 ||
      tvl < 150000 || number(volume["24h"], 0) < 50000 ||
      number(volume["30m"], 0) < 1000 || number(fees["24h"], 0) < 100) return [];
    const tokens = [p.token_x.symbol.toUpperCase(), p.token_y.symbol.toUpperCase()];
    // Meme/Bid-Ask strategies need active-bin liquidity and independently verified
    // token exit/price data. The pool-list endpoint alone cannot supply those proofs.
    const isConventionalSpot = tokens.some(s => stable.has(s)) && tokens.some(s => major.has(s));
    if (!isConventionalSpot) return [];
    // Pool fee tier > 1.5% has material adverse-selection/inventory risk.
    // This is an evidence gate, not a ban: such pools need an explicit second-stage review.
    if (number(p.pool_config?.base_fee_pct, Infinity) > 1.5) return [];
    const hourly = [number(fees["30m"], 0)*2, number(fees["1h"], 0),
      number(fees["4h"], 0)/4, number(fees["24h"], 0)/24];
    if (Math.min(...hourly) <= 0 || Math.min(...hourly)/Math.max(...hourly) < 0.10) return [];
    const conservativePoolFeeHourly = Math.min(...hourly);
    const feeToTvlDay = 100*number(fees["24h"], 0)/tvl;
    if (feeToTvlDay > 1.25) return []; // unusual pool-level fee ratio requires investigation
    const score = conservativePoolFeeHourly/tvl *
      Math.min(1, Math.sqrt(tvl/500000)) *
      Math.min(1, Math.sqrt(ageDays/30));
    return [{
      platform:"Meteora", name:p.name, address:p.address,
      token_symbols: [p.token_x.symbol, p.token_y.symbol],
      token_mints:[p.token_x.address,p.token_y.address],
      tvl_usd:tvl, base_fee_pct:p.pool_config?.base_fee_pct,
      fee_30m_usd:fees["30m"], fee_1h_usd:fees["1h"], fee_4h_usd:fees["4h"],
      fee_24h_usd:fees["24h"], volume_30m_usd:volume["30m"],
      volume_24h_usd:volume["24h"], pool_age_days:round(ageDays,1),
      conservative_pool_fee_per_hour_usd:round(conservativePoolFeeHourly),
      gross_fee_to_tvl_24h_pct:round(feeToTvlDay),
      score:round(score,10), status:"RESEARCH_ONLY_NET_EDGE_UNKNOWN",
      missing:["independent_5m_trades","unique_trader_count","active_bin_liquidity",
        "position_specific_swap_and_flash_fees", "real_entry_and_exit_quote",
        "inventory_IL", "net_yield_after_all_costs"]
    }];
  });
  return entries.sort((a,b) => b.score-a.score || a.address.localeCompare(b.address))[0] || null;
}

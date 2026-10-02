// Pure screening rules for TAIL_CONVEXITY_V1. No network, no orders.

export const WATCHED_SYMBOL = "BTC-261127-60000-P";
export const DTE_MIN = 21;
export const DTE_MAX = 120;
export const DELTA_MIN = 0.01;
export const DELTA_MAX = 0.08;
export const SPREAD_MAX = 0.1;
export const ALL_IN_CAP = 5;
export const ANNUAL_BUDGET_CAP = 300;
export const REAUTH_BUDGET_CAP = 500;
export const MISPRICING_EDGE = 0.01;
export const DISPLAY_LIMIT = 5;
export const CLUSTER_CAP = 2;
export const THESIS_LADDER = [5, 10, 25, 50];
export const MAX_AUTO_LEVERAGE = 2;
export const PUT_REPRICED_IV = 1.5;

export const TAKER_FEE_RATE = 0.00024;
export const FEE_CAP_RATIO = 0.1;
export const FEE_SOURCE = "https://www.binance.info/en/support/announcement/detail/8f1cae716974444da593806e7425e4ff";

export const RANK_WEIGHTS = [
  ["mispricing_vol_points", 6, "desc"],
  ["payoff_blend", 5, "desc"],
  ["dte", 4, "desc"],
  ["liquidity", 3, "desc"],
  ["fragility_objective", 2, "desc"],
  ["persistence", 1, "desc"]
];

export const PARETO_KEYS = RANK_WEIGHTS.map(([key]) => key);

export const PAYOFF_WEIGHTS = { m30: 0.2, m50: 0.4, m70: 0.3, m90: 0.1 };

export function num(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function resolveTakerRate(symbolRate) {
  const explicit = num(symbolRate);
  if (explicit === null) return { rate: TAKER_FEE_RATE, source: "published_regular_schedule" };
  if (explicit < 0 || explicit > 0.05) return { rate: null, source: "unknown" };
  return { rate: explicit, source: "exchange_symbol" };
}

export function entryFee({ index, unit = 1, ask, qty, rate }) {
  if (!(index > 0) || !(unit > 0) || !(ask > 0) || !(qty > 0) || !(rate >= 0)) return null;
  const premium = ask * qty;
  const underlying = index * unit * qty;
  return Math.min(underlying * rate, premium * FEE_CAP_RATIO);
}

export function crashMultiple({ strike, spot, unit = 1, qty, allIn, drop }) {
  if (!(strike > 0) || !(spot > 0) || !(unit > 0) || !(qty > 0) || !(allIn > 0) || !(drop >= 0) || drop >= 1) return null;
  const intrinsic = Math.max(strike - spot * (1 - drop), 0) * unit * qty;
  return { usdt: intrinsic, multiple: intrinsic / allIn };
}

export function payoffBlend(payoff) {
  if (!payoff) return null;
  return payoff.m30.multiple * PAYOFF_WEIGHTS.m30
    + payoff.m50.multiple * PAYOFF_WEIGHTS.m50
    + payoff.m70.multiple * PAYOFF_WEIGHTS.m70
    + payoff.m90.multiple * PAYOFF_WEIGHTS.m90;
}

export function liquidityScore({ spread, volume, bidSize, askSize }) {
  if (!(spread >= 0) || !(bidSize > 0) || !(askSize > 0) || !(volume >= 0)) return null;
  const spreadScore = Math.max(0, 1 - spread / SPREAD_MAX);
  const depthScore = Math.min(1, Math.log10(1 + bidSize + askSize) / 2);
  const volumeScore = Math.min(1, Math.log10(1 + volume) / 3);
  return spreadScore * 0.5 + depthScore * 0.25 + volumeScore * 0.25;
}

export function classifyMispricing(referenceIv, askIv) {
  if (!(referenceIv > 0) || !(askIv > 0)) return { status: "UNKNOWN", gap: null };
  const gap = referenceIv - askIv;
  if (gap >= MISPRICING_EDGE) return { status: "PASS", gap };
  if (gap <= -MISPRICING_EDGE) return { status: "FAIL", gap };
  return { status: "FLAT", gap };
}

export function parseLevel(level) {
  if (!level) return null;
  const price = num(Array.isArray(level) ? level[0] : level.price);
  const size = num(Array.isArray(level) ? level[1] : (level.quote ?? level.qty ?? level.size));
  if (!(price > 0) || !(size > 0)) return null;
  return { price, size };
}

export function bestLevel(levels, side) {
  const parsed = (Array.isArray(levels) ? levels : []).map(parseLevel).filter(Boolean);
  if (!parsed.length) return null;
  parsed.sort((a, b) => side === "bid" ? b.price - a.price : a.price - b.price);
  return parsed[0];
}

function usableSmilePoint(point, symbol) {
  const moneyness = point?.spot > 0 && point?.strike > 0 ? point.strike / point.spot : null;
  return Boolean(point
    && point.symbol !== symbol
    && point.askIv >= 0.05
    && point.askIv <= 2.5
    && point.bid > 0
    && point.ask >= point.bid
    && point.spread <= SPREAD_MAX
    && moneyness !== null
    && moneyness >= 0.35
    && moneyness <= 1.08);
}

function smileFromSegment(near, far, strike, spot, count, extrapolated) {
  const left = Math.log(near.strike / spot);
  const right = Math.log(far.strike / spot);
  const mid = Math.log(strike / spot);
  if (!(right !== left)) return null;
  const weight = (mid - left) / (right - left);
  const fittedIvValue = near.askIv + weight * (far.askIv - near.askIv);
  if (!Number.isFinite(fittedIvValue)) return null;
  return {
    fittedIv: fittedIvValue,
    count,
    lower: near.symbol,
    upper: far.symbol,
    extrapolated
  };
}

export function localSmile(points, symbol, strike, spot) {
  if (!(strike > 0) || !(spot > 0)) return null;
  const usable = (points || []).filter((point) => usableSmilePoint(point, symbol));
  if (usable.length < 4) return null;
  const below = usable.filter((point) => point.strike < strike).sort((a, b) => b.strike - a.strike)[0];
  const above = usable.filter((point) => point.strike > strike).sort((a, b) => a.strike - b.strike)[0];
  if (below && above && (above.strike - below.strike) / spot <= 0.12) {
    return smileFromSegment(below, above, strike, spot, usable.length, false);
  }
  const side = below ? -1 : above ? 1 : 0;
  if (!side) return null;
  const sameSide = usable
    .filter((point) => Math.sign(point.strike - strike) === side)
    .sort((a, b) => Math.abs(a.strike - strike) - Math.abs(b.strike - strike));
  if (sameSide.length < 2) return null;
  const near = sameSide[0];
  const far = sameSide[1];
  const gap = Math.abs(near.strike - strike);
  const step = Math.abs(far.strike - near.strike);
  if (!(step > 0) || gap > step * 1.25 || gap / spot > 0.08 || step / spot > 0.08) return null;
  return smileFromSegment(near, far, strike, spot, usable.length, true);
}

export function mispricingEvidence({ askIv, fittedIv: smileIv, lowerSymbol, upperSymbol, extrapolated, status }) {
  if (!(askIv > 0) || !(smileIv > 0) || !lowerSymbol || !upperSymbol) return "没有左右两边的同期限 Put，错价未知。";
  const askPct = (askIv * 100).toFixed(1);
  const fitPct = (smileIv * 100).toFixed(1);
  const gap = Math.abs((smileIv - askIv) * 100).toFixed(1);
  const where = extrapolated
    ? `同期限更近的 ${lowerSymbol} 和 ${upperSymbol} 向外推一档，IV 是 ${fitPct}%。卖价是 ${askPct}%`
    : `左右参照 ${lowerSymbol} 和 ${upperSymbol}，插值 IV 是 ${fitPct}%。卖价是 ${askPct}%`;
  if (status === "PASS") return `${where}，低了 ${gap} 个点。这条尾部相对自己的期限偏便宜。`;
  if (status === "FAIL") return `${where}，高了 ${gap} 个点。尾部没有显得便宜。`;
  return `${where}，差距不到 1 个点。`;
}

function pushReason(reasons, code) {
  if (!reasons.includes(code)) reasons.push(code);
}

export function evaluateCandidate(input, context = {}) {
  const reasons = [];
  const side = input?.side;
  const underlyingType = input?.underlyingType;
  const status = input?.status;
  const spot = num(input?.spot);
  const strike = num(input?.strike);
  const bid = num(input?.bid);
  const ask = num(input?.ask);
  const bidSize = num(input?.bidSize);
  const askSize = num(input?.askSize);
  const minQty = num(input?.minQty);
  const unit = num(input?.unit);
  const askIv = num(input?.askIv);
  const delta = num(input?.delta);
  const theta = num(input?.theta);
  const volume = num(input?.volume);
  const expiryMs = num(input?.expiryMs);
  const serverTimeMs = num(input?.serverTimeMs);
  const dte = expiryMs !== null && serverTimeMs !== null ? (expiryMs - serverTimeMs) / 86400000 : null;
  const feeQuote = resolveTakerRate(input?.takerFeeRate);
  const smileIv = num(context.smile?.fittedIv);
  const smileCount = num(context.smile?.count);
  const lowerSymbol = context.smile?.lower || null;
  const upperSymbol = context.smile?.upper || null;
  const smileGap = smileIv !== null && askIv !== null ? smileIv - askIv : null;
  const smileUsable = Boolean(lowerSymbol && upperSymbol)
    && smileIv !== null
    && smileCount >= 4
    && smileIv >= 0.05
    && smileIv <= 2.5
    && smileGap !== null
    && Math.abs(smileGap) <= 0.25;
  const mispricing = smileUsable ? classifyMispricing(smileIv, askIv) : { status: "UNKNOWN", gap: null };

  if (side !== "PUT") pushReason(reasons, "不是 Put");
  if (underlyingType !== "CRYPTO") pushReason(reasons, "不是币安 USDT 加密期权");
  if (status !== "TRADING") pushReason(reasons, "合约未在交易");
  if (dte === null || dte < DTE_MIN || dte > DTE_MAX) pushReason(reasons, "剩余天数不在 21–120");
  if (spot === null) pushReason(reasons, "现价未知");
  if (!(strike > 0)) pushReason(reasons, "行权价未知");
  if (!(bid > 0) || !(ask > 0) || ask < bid || !(bidSize > 0) || !(askSize > 0)) pushReason(reasons, "没有真实双边盘口");
  const spread = bid > 0 && ask >= bid ? (ask - bid) / ((ask + bid) / 2) : null;
  if (spread === null || spread > SPREAD_MAX) pushReason(reasons, "价差超过 10%");
  if (delta === null) pushReason(reasons, "Delta 未知");
  else if (Math.abs(delta) < DELTA_MIN - 1e-8 || Math.abs(delta) > DELTA_MAX + 1e-8) pushReason(reasons, "Delta 不在 0.01–0.08");
  if (!(askIv > 0) || askIv > 3) pushReason(reasons, "卖价 IV 未知");
  if (!(minQty > 0)) pushReason(reasons, "最小数量未知");
  if (!(unit > 0)) pushReason(reasons, "合约乘数未知");
  if (feeQuote.rate === null || spot === null || !(unit > 0)) pushReason(reasons, "费用未知");
  if (theta === null) pushReason(reasons, "权利金消耗未知");
  if (volume === null || volume < 0) pushReason(reasons, "成交量未知");
  if (mispricing.status === "UNKNOWN") pushReason(reasons, "无法对照同期限参照，错价未知");
  if (bidSize !== null && askSize !== null && minQty !== null && (bidSize < minQty || askSize < minQty)) {
    pushReason(reasons, "盘口挂单量小于最小下单数量");
  }

  const fees = feeQuote.rate !== null && ask !== null && minQty !== null && spot !== null && unit > 0
    ? entryFee({ index: spot, unit, ask, qty: minQty, rate: feeQuote.rate })
    : null;
  const premium = ask !== null && minQty !== null ? ask * minQty : null;
  const allIn = premium !== null && fees !== null ? premium + fees : null;
  if (allIn === null) pushReason(reasons, "最大损失未知");
  else if (allIn > ALL_IN_CAP + 1e-6) pushReason(reasons, "最小数量的最大损失超过 5 USDT");

  const payoff = allIn !== null && strike !== null && spot !== null && minQty !== null && unit > 0
    ? {
      m30: crashMultiple({ strike, spot, unit, qty: minQty, allIn, drop: 0.3 }),
      m50: crashMultiple({ strike, spot, unit, qty: minQty, allIn, drop: 0.5 }),
      m70: crashMultiple({ strike, spot, unit, qty: minQty, allIn, drop: 0.7 }),
      m90: crashMultiple({ strike, spot, unit, qty: minQty, allIn, drop: 0.9 })
    }
    : null;
  const blend = payoff && payoff.m30 && payoff.m50 && payoff.m70 && payoff.m90 ? payoffBlend(payoff) : null;
  const burnRatio = theta !== null && minQty !== null && allIn > 0 ? Math.abs(theta) * minQty / allIn : null;
  const persistence = burnRatio !== null ? 1 / (1 + burnRatio) : null;
  const liquidity = liquidityScore({
    spread: spread ?? -1,
    volume: volume ?? -1,
    bidSize: bidSize ?? -1,
    askSize: askSize ?? -1
  });
  const fragilityScore = context.fragilityScore === null || context.fragilityScore === undefined
    ? null
    : num(context.fragilityScore);
  const fragilityObjective = fragilityScore === null ? 0 : fragilityScore;

  if (blend === null || persistence === null || liquidity === null) {
    if (blend === null) pushReason(reasons, "兑现倍数未知");
    if (persistence === null) pushReason(reasons, "权利金消耗未知");
    if (liquidity === null) pushReason(reasons, "流动性未知");
  }

  const pass = reasons.length === 0;
  return {
    symbol: input?.symbol ?? "",
    underlying: input?.underlying ?? "",
    side: side ?? "",
    dte,
    strike,
    spot,
    strike_spot: strike > 0 && spot > 0 ? strike / spot : null,
    delta,
    ask_iv: askIv,
    mark_iv: num(input?.markIv),
    bid,
    ask,
    spread,
    min_qty: minQty,
    unit,
    premium,
    fees,
    all_in_max_loss: allIn,
    fee_rate: feeQuote.rate,
    fee_source: feeQuote.source,
    payoff_30: payoff?.m30?.multiple ?? null,
    payoff_50: payoff?.m50?.multiple ?? null,
    payoff_70: payoff?.m70?.multiple ?? null,
    payoff_90: payoff?.m90?.multiple ?? null,
    payoff_30_usdt: payoff?.m30?.usdt ?? null,
    payoff_50_usdt: payoff?.m50?.usdt ?? null,
    payoff_70_usdt: payoff?.m70?.usdt ?? null,
    payoff_90_usdt: payoff?.m90?.usdt ?? null,
    payoff_blend: blend,
    bid_size: bidSize,
    ask_size: askSize,
    volume,
    liquidity,
    fragility_score: fragilityScore,
    fragility_objective: fragilityObjective,
    mispricing: mispricing.status,
    mispricing_vol_points: mispricing.gap,
    smile_iv: smileUsable ? smileIv : null,
    smile_count: smileCount,
    mispricing_evidence: mispricingEvidence({
      askIv,
      fittedIv: smileUsable ? smileIv : null,
      lowerSymbol: smileUsable ? lowerSymbol : null,
      upperSymbol: smileUsable ? upperSymbol : null,
      extrapolated: Boolean(context.smile?.extrapolated),
      status: mispricing.status
    }),
    theta,
    burn_ratio: burnRatio,
    persistence,
    expiry_ms: expiryMs,
    price_scale: num(input?.priceScale),
    pass,
    state: pass ? "PASS" : "FAIL",
    fail_reasons: reasons
  };
}

function dominates(better, worse) {
  let strictly = false;
  for (const key of PARETO_KEYS) {
    const left = better[key];
    const right = worse[key];
    if (!(left >= right - 1e-12)) return false;
    if (left > right + 1e-12) strictly = true;
  }
  return strictly;
}

export function paretoFront(items) {
  return items.filter((item) => !items.some((other) => other !== item && dominates(other, item)));
}

const MISPRICING_ORDER = { PASS: 0, FLAT: 1, FAIL: 2, UNKNOWN: 3 };

export function rankFront(items) {
  return items.slice().sort((left, right) => {
    const status = (MISPRICING_ORDER[left.mispricing] ?? 9) - (MISPRICING_ORDER[right.mispricing] ?? 9);
    if (status) return status;
    for (const [key, , direction] of RANK_WEIGHTS) {
      const diff = direction === "asc" ? left[key] - right[key] : right[key] - left[key];
      if (Math.abs(diff) > 1e-12) return diff;
    }
    return left.all_in_max_loss - right.all_in_max_loss || left.symbol.localeCompare(right.symbol);
  });
}

export function buildBoard(evaluated) {
  const qualified = evaluated.filter((item) => item.pass);
  const front = paretoFront(qualified);
  const ranked = rankFront(front).map((item, index) => ({ ...item, rank: index + 1 }));
  const edge = ranked.filter((item) => item.mispricing === "PASS");
  return {
    qualified_count: qualified.length,
    pareto_count: front.length,
    edge_count: edge.length,
    ranked
  };
}

export function budgetView(ledger) {
  const reauthorized = ledger?.reauthorized === true;
  const requested = num(ledger?.annual_budget_usdt);
  const annual = reauthorized && requested === REAUTH_BUDGET_CAP ? REAUTH_BUDGET_CAP : ANNUAL_BUDGET_CAP;
  const spent = Math.max(0, num(ledger?.spent_usdt) ?? 0);
  return {
    annual_budget_usdt: annual,
    spent_usdt: Math.min(spent, annual),
    remaining_usdt: Math.max(0, annual - spent),
    per_order_cap_usdt: ALL_IN_CAP,
    reauth_ceiling_usdt: REAUTH_BUDGET_CAP,
    reauthorized
  };
}

export function absoluteGate(checks) {
  const unknown = Object.entries(checks || {})
    .filter(([, value]) => value === "UNKNOWN" || value === null || value === undefined)
    .map(([key]) => key);
  return { pass: unknown.length === 0, unknown };
}

export function premiumBurnGate(burnRatio) {
  if (!Number.isFinite(burnRatio) || burnRatio < 0) return { pass: false, status: "UNKNOWN" };
  return { pass: true, status: "KNOWN", burn: burnRatio };
}

export function nextProbeNotional(ctx) {
  if (!ctx?.newInformation || ctx.unknown) return null;
  if (!ctx.eventStillValid || !ctx.spreadOk || !ctx.depthOk || !ctx.budgetOk) return null;
  if (ctx.tailState !== "NORMAL" && ctx.tailState !== "CRITICAL") return null;
  const last = num(ctx.lastNotional) ?? 0;
  const next = THESIS_LADDER.find((step) => step > last + 1e-9);
  if (!next || next > (num(ctx.remainingBudget) ?? 0) || next > 50) return null;
  if (ctx.tailState === "NORMAL") return next === 5 ? 5 : null;
  if (next > 5 && ctx.mispricing !== "PASS") return null;
  return next;
}

export function finalState(ctx) {
  if (!ctx?.dataOk) return "BLOCKED_DATA";
  if (ctx.riskUnknown) return "BLOCKED_RISK";
  if (ctx.orderSent) return "BLOCKED_EXECUTION";
  if (ctx.tailState === "CRITICAL") {
    if (ctx.bestInstrument === "PERP_SHORT" && ctx.alsoPut) return "CRITICAL_COMBO";
    if (ctx.bestInstrument === "PERP_SHORT") return "CRITICAL_SHORT";
    return "CRITICAL_PUT";
  }
  if (ctx.tailState === "WATCH") return "WATCH";
  if ((ctx.edgeCount ?? 0) > 0) return "PUT_PROBE";
  return "NO_EDGE";
}

function instrumentScore(row) {
  const loss = row.maxLoss > 0 ? 1 / row.maxLoss : 0;
  return row.convexity * 3 + loss + (1 - row.path) * 2 + row.liquidity + row.repricing;
}

export function simulatePerpShort(quote) {
  const input = quote || {};
  const unknown = [];
  if (!(input.mark > 0)) unknown.push("PRICE");
  if (!(input.depth > 0)) unknown.push("DEPTH");
  if (!(input.spread >= 0)) unknown.push("SPREAD");
  else if (input.spread > 0.0015) unknown.push("SPREAD");
  if (!Number.isFinite(input.funding)) unknown.push("FUNDING");
  if (!(input.liquidationDistance > 0)) unknown.push("LIQUIDATION_DISTANCE");
  if (!(input.maxLoss > 0)) unknown.push("MAX_LOSS");
  if (input.isolated !== true) unknown.push("ISOLATED_MARGIN");
  if (input.cross !== false) unknown.push("CROSS_MARGIN");
  const leverage = num(input.leverage);
  if (leverage === null || leverage < 1 || leverage > MAX_AUTO_LEVERAGE) unknown.push("LEVERAGE");
  return {
    eligible: unknown.length === 0,
    unknown,
    maxLoss: num(input.maxLoss),
    funding: num(input.funding),
    depthScore: input.depth > 0 ? Math.min(1, Math.log10(1 + input.depth) / 6) : 0
  };
}

export function routeThesis({
  tailState = "NORMAL",
  put = null,
  perp = null,
  spotHeld = false,
  rwa = null
} = {}) {
  const putRepriced = Boolean(put && (put.mispricing === "FAIL" || (put.ask_iv >= PUT_REPRICED_IV)));
  const burn = premiumBurnGate(put?.burn_ratio);
  const putOk = Boolean(put && put.pass !== false && put.all_in_max_loss > 0 && put.all_in_max_loss <= ALL_IN_CAP && burn.pass);
  const perpSim = simulatePerpShort(perp || {});
  let perpState = "OFF";
  if (tailState === "WATCH") perpState = "SIMULATION";
  if (tailState === "CRITICAL") perpState = perpSim.eligible && putRepriced ? "ELIGIBLE" : "FAIL_CLOSED";

  const rwaKnown = Boolean(rwa?.navKnown && rwa?.custodyKnown && rwa?.liquidityKnown && rwa?.decayKnown && rwa?.trackingKnown && rwa?.contractKnown && rwa?.maxLoss > 0);
  const candidates = [];
  if (putOk) {
    candidates.push({
      id: "LONG_PUT",
      convexity: Number.isFinite(put.payoff_blend) ? put.payoff_blend : 0,
      maxLoss: put.all_in_max_loss,
      path: 0.15,
      liquidity: Number.isFinite(put.liquidity) ? put.liquidity : 0,
      repricing: put.mispricing === "PASS" ? 1 : put.mispricing === "FLAT" ? 0.45 : 0
    });
  }
  if (perpState === "ELIGIBLE") {
    candidates.push({
      id: "PERP_SHORT",
      convexity: 0.2,
      maxLoss: perpSim.maxLoss,
      path: 0.85,
      liquidity: perpSim.depthScore,
      repricing: 0.7
    });
  }
  if (rwaKnown && !putOk) {
    candidates.push({
      id: "INVERSE_RWA",
      convexity: 0.1,
      maxLoss: rwa.maxLoss,
      path: 0.7,
      liquidity: Number.isFinite(rwa.liquidity) ? rwa.liquidity : 0,
      repricing: 0.2
    });
  }
  candidates.sort((left, right) => instrumentScore(right) - instrumentScore(left) || left.id.localeCompare(right.id));
  return {
    best_instrument: candidates[0]?.id || "NONE",
    second_instrument: candidates[1]?.id || null,
    perp_state: perpState,
    put_repriced: putRepriced,
    spot_proposal: spotHeld ? "HEDGE_OR_EXIT_PROPOSAL" : null,
    rwa_state: rwaKnown ? "VERIFIED" : "FAIL_CLOSED",
    max_loss: putOk ? put.all_in_max_loss : null,
    crash_payoff: put?.payoff_50 ?? null,
    path_dependency: candidates[0]?.id === "PERP_SHORT" ? "高" : "低",
    liquidation_risk: candidates[0]?.id === "PERP_SHORT" ? "有" : "无",
    funding: Number.isFinite(perp?.funding) ? perp.funding : null,
    execution_state: "DISPLAY_ONLY"
  };
}

export function annotateBoard(ranked, context = {}) {
  const counts = {};
  return (ranked || []).slice(0, DISPLAY_LIMIT).map((item) => {
    const underlying = item.underlying || String(item.symbol || "").split("-")[0];
    counts[underlying] = (counts[underlying] || 0) + 1;
    const route = routeThesis({
      tailState: context.tailState,
      put: item,
      perp: context.perp,
      spotHeld: context.spotHeld === true,
      rwa: context.rwa
    });
    return {
      ...item,
      route,
      cluster_full: counts[underlying] > CLUSTER_CAP
    };
  });
}

export function replacementReport(previous, next) {
  const prior = Array.isArray(previous) ? previous : [];
  const current = Array.isArray(next) ? next : [];
  if (!prior.length) return [];
  const kept = new Set(current);
  const removed = prior.filter((symbol) => !kept.has(symbol));
  const added = current.filter((symbol) => !prior.includes(symbol));
  if (!removed.length && !added.length) return [];
  const width = Math.max(added.length, removed.length, 1);
  const rows = [];
  for (let index = 0; index < width; index += 1) {
    rows.push({
      added: added[index] || null,
      removed: removed[index] || null,
      reason: "排序变化"
    });
  }
  return rows;
}

export function informationFingerprint({ tailState, board, evidenceIds }) {
  const names = (board || []).map((item) => `${item.symbol}:${item.mispricing}`).join("|");
  const evidence = (evidenceIds || []).join("|");
  return `${tailState || "NORMAL"}|${names}|${evidence}`;
}

export function replayRoute(steps) {
  const reasons = [];
  let last = 0;
  for (const step of steps || []) {
    if (step.marginMode === "CROSS" || step.cross === true) reasons.push("全仓");
    if (step.instrument === "SHORT_OPTION") reasons.push("裸卖");
    if (step.tailState === "NORMAL" && step.instrument === "PERP_SHORT") reasons.push("普通状态做空");
    if (step.tailState === "WATCH" && step.instrument === "PERP_SHORT" && step.execute) reasons.push("观察状态执行永续");
    if ((step.leverage ?? 1) > MAX_AUTO_LEVERAGE) reasons.push("杠杆超过 2");
    if ((step.total ?? 0) > 50) reasons.push("超过 50");
    if (!step.newInformation && (step.total ?? 0) > last + 1e-9) reasons.push("没有新信息却加仓");
    if (step.unknown && (step.total ?? 0) > last + 1e-9) reasons.push("未知却升级");
    if ((step.total ?? 0) > last + 1e-9) {
      const allowed = THESIS_LADDER.find((rung) => rung > last + 1e-9);
      if (step.total !== allowed) reasons.push("跳级");
    }
    last = step.total ?? last;
  }
  return { pass: reasons.length === 0, reasons };
}

export function assessFragility({ pegs, pendle, aave, morpho } = {}) {
  const items = [];
  const push = (item) => items.push(item);
  for (const row of pegs || []) {
    if (!(row.price > 0)) continue;
    const gap = Math.abs(row.price - 1);
    if (gap < 0.005) continue;
    push({
      id: `llama:${row.symbol}`,
      group: `llama_peg:${row.symbol}`,
      authoritative: false,
      mechanism: false,
      stress: true
    });
  }
  const pendleRows = pendle?.rows || [];
  for (const row of pendleRows) {
    if (!(row.liquidityUsd >= 1_000_000) || row.active === false) continue;
    if (!(row.ptDiscount >= 0.15)) continue;
    push({
      id: `pendle:${row.address || row.symbol}`,
      group: `pendle_pt:${row.address || row.symbol}`,
      authoritative: true,
      mechanism: row.ptDiscount >= 0.3,
      stress: true
    });
  }
  for (const row of aave?.rows || []) {
    if (row.paused || row.frozen) {
      push({
        id: `aave:halt:${row.symbol}`,
        group: `aave_halt:${row.symbol}`,
        authoritative: true,
        mechanism: true,
        stress: true
      });
    }
    if (row.price > 0 && ["USDT", "USDC", "DAI", "USDE", "FDUSD", "GHO"].includes(row.symbol)) {
      const gap = Math.abs(row.price - 1);
      if (gap >= 0.005) {
        push({
          id: `aave:peg:${row.symbol}`,
          group: `aave_peg:${row.symbol}`,
          authoritative: true,
          mechanism: gap >= 0.01,
          stress: true
        });
      }
    }
    if (row.utilization >= 0.97 && row.availableUsd !== null && row.availableUsd < 10_000_000) {
      push({
        id: `aave:util:${row.symbol}`,
        group: `aave_util:${row.symbol}`,
        authoritative: true,
        mechanism: false,
        stress: true
      });
    }
  }
  for (const row of morpho?.rows || []) {
    const sane = row.supplyUsd >= 5_000_000 && row.supplyUsd <= 500_000_000;
    if (!sane || !["USDC", "USDT", "DAI", "WETH"].includes(row.loan)) continue;
    if (row.badDebtUsd >= 100_000 && row.badDebtUsd / row.supplyUsd <= 1) {
      push({
        id: `morpho:debt:${row.id}`,
        group: `morpho_debt:${row.id}`,
        authoritative: true,
        mechanism: true,
        stress: true
      });
    } else if (row.utilization >= 0.995 && row.liquidityUsd !== null && row.liquidityUsd < 100_000) {
      push({
        id: `morpho:util:${row.id}`,
        group: `morpho_util:${row.id}`,
        authoritative: true,
        mechanism: false,
        stress: true
      });
    }
  }
  const stressGroups = new Set(items.filter((item) => item.stress).map((item) => item.group));
  const mechanismGroups = new Set(items.filter((item) => item.authoritative && item.mechanism).map((item) => item.group));
  const tailState = mechanismGroups.size >= 2 ? "CRITICAL" : stressGroups.size >= 2 ? "WATCH" : "NORMAL";
  const sources = {
    peg: pegs ? "connected" : "missing",
    pendle: pendle?.connected ? "connected" : "missing",
    aave: aave?.connected ? "connected" : "missing",
    morpho: morpho?.connected ? "connected" : "missing"
  };
  return {
    score: stressGroups.size * 10 + mechanismGroups.size * 25,
    tail_state: tailState,
    known: true,
    evidence_ids: items.map((item) => item.id),
    authoritative_mechanisms: mechanismGroups.size,
    independent_stress: stressGroups.size,
    sources,
    categories: [...stressGroups],
    evidence: `权威机制 ${mechanismGroups.size} 组，独立压力 ${stressGroups.size} 组。`
  };
}

export function countReasons(evaluated) {
  const counts = {};
  for (const row of evaluated) {
    if (row.pass) continue;
    for (const reason of row.fail_reasons) counts[reason] = (counts[reason] || 0) + 1;
  }
  return counts;
}

export function summarizeProbe({ watchedSymbol, watched, ranked, executionReasons }) {
  const top = ranked[0] ?? null;
  const watchedRank = ranked.find((item) => item.symbol === watchedSymbol)?.rank ?? null;
  const sentences = [];
  if (!watched) {
    sentences.push(`${watchedSymbol} 不在这轮合约表里。`);
  } else if (!watched.pass) {
    sentences.push(`${watchedSymbol} 没有过硬门：${watched.fail_reasons.join("、")}。不强买。`);
  } else if (watchedRank === 1 && watched.mispricing === "PASS") {
    sentences.push(`${watchedSymbol} 刷新后仍是第一名，而且错价通过。按规则只买最小数量，限价，不追价。`);
  } else if (watchedRank === 1) {
    sentences.push(`${watchedSymbol} 刷新后仍是结构第一，但错价没有通过。不买。`);
  } else if (watchedRank) {
    sentences.push(`${watchedSymbol} 刷新后排第 ${watchedRank}，不是第一名。不强买。`);
  } else {
    sentences.push(`${watchedSymbol} 过了硬门，但没有留在帕累托前沿。不强买。`);
  }
  if (!top) sentences.push("这轮没有同时过硬门的候选，不交易。");
  else if (top.mispricing === "PASS" && watchedRank !== 1) sentences.push(`若只做一笔探针，对象会是 ${top.symbol} 的最小数量。`);
  else if (top.mispricing !== "PASS" && watchedRank !== 1) sentences.push(`综合第一是 ${top.symbol}，但它的错价没有通过，所以不拿它做探针。`);
  sentences.push(`委托没有发出。${(executionReasons || []).join("；")}。`);
  return sentences.join("");
}

export function composeSnapshot(scan, extras = {}) {
  const budget = budgetView(extras.ledger);
  const ranked = scan.board?.ranked ?? [];
  const tailState = scan.fragility?.tail_state ?? "NORMAL";
  const board = annotateBoard(ranked, {
    tailState,
    perp: scan.perp ?? null,
    rwa: null,
    spotHeld: false
  });
  const fingerprint = informationFingerprint({
    tailState,
    board,
    evidenceIds: scan.fragility?.evidence_ids
  });
  const best = board[0]?.route?.best_instrument || "NONE";
  return {
    schema: "tail-convexity-v1",
    router: "INSTRUMENT_ROUTER_V1",
    generated_at_ms: scan.generated_at_ms ?? Date.now(),
    server_time_ms: scan.server_time_ms ?? null,
    state: finalState({
      dataOk: true,
      orderSent: false,
      tailState,
      edgeCount: scan.board?.edge_count ?? 0,
      bestInstrument: best,
      alsoPut: board.some((item) => item.route?.best_instrument === "LONG_PUT")
    }),
    tail_state: tailState,
    display_only: true,
    order_sent: false,
    add_allowed: false,
    new_information: extras.previousFingerprint ? extras.previousFingerprint !== fingerprint : false,
    fingerprint,
    budget,
    spots: scan.spots ?? {},
    funnel: scan.funnel ?? {},
    radar: {
      fragility_score: scan.fragility?.score ?? null,
      evidence: scan.fragility?.evidence ?? "",
      categories: scan.fragility?.categories ?? [],
      sources: scan.fragility?.sources ?? {},
      note: ""
    },
    replacement_report: replacementReport(extras.previousSymbols, board.map((item) => item.symbol)),
    equity_proxy: { state: "FAIL_CLOSED" },
    inverse_rwa: { state: "FAIL_CLOSED" },
    probe: {
      watched_symbol: WATCHED_SYMBOL,
      order_sent: false,
      intent: null,
      reasons: [],
      summary: ""
    },
    watched: scan.watched ?? null,
    board,
    reject_counts: scan.reject_counts ?? {},
    method: "",
    fee_policy: {
      taker_rate: TAKER_FEE_RATE,
      cap_ratio: FEE_CAP_RATIO,
      source: FEE_SOURCE
    }
  };
}

export function blockedSnapshot(message, ledger) {
  return {
    schema: "tail-convexity-v1",
    generated_at_ms: Date.now(),
    server_time_ms: null,
    state: "BLOCKED_DATA",
    tail_state: "NORMAL",
    budget: budgetView(ledger),
    spots: {},
    funnel: {},
    display_only: true,
    order_sent: false,
    add_allowed: false,
    radar: { fragility_score: null, evidence: "", categories: [], sources: {}, note: "" },
    replacement_report: [],
    equity_proxy: { state: "FAIL_CLOSED" },
    inverse_rwa: { state: "FAIL_CLOSED" },
    probe: {
      watched_symbol: WATCHED_SYMBOL,
      order_sent: false,
      intent: null,
      reasons: [],
      summary: ""
    },
    watched: null,
    board: [],
    reject_counts: {},
    method: "",
    fee_policy: {
      taker_rate: TAKER_FEE_RATE,
      cap_ratio: FEE_CAP_RATIO,
      source: FEE_SOURCE
    },
    error: message
  };
}

export function methodNote() {
  return "先做帕累托淘汰，再按错价、灾难兑现比上全部成本、剩余期限、价差和深度、脆弱性、权利金消耗来排。不按单一暴跌倍数取第一。错价通过是指卖价隐含波动率比左右相邻的同到期 Put 插值至少低 1 个点。普通状态单笔最大损失不超过 5 USDT。临界档的 10、25、50 不自动加仓。";
}

export function stateCopy(state) {
  const table = {
    NO_EDGE: ["没有边", "quiet"],
    PROBE_OPEN: ["探针持仓", "live"],
    WATCH: ["观察", "pending"],
    CRITICAL: ["临界", "risk"],
    BLOCKED_DATA: ["数据停着", "pending"],
    BLOCKED_EXECUTION: ["执行停着", "pending"]
  };
  return table[state] ?? ["未知", "pending"];
}

function trimFixed(value, digits) {
  return value.toFixed(digits).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
}

export function formatUsdt(value) {
  if (!Number.isFinite(value)) return "—";
  return trimFixed(value, Math.abs(value) >= 1 ? 2 : 3);
}

export function formatPremium(value) {
  if (!Number.isFinite(value)) return "—";
  if (value >= 100) return trimFixed(value, Number.isInteger(value) ? 0 : 1);
  if (value >= 1) return trimFixed(value, 2);
  return trimFixed(value, 4);
}

export function formatMultiple(value) {
  if (!Number.isFinite(value)) return "—";
  if (value >= 100) return `${Math.round(value)}×`;
  if (value >= 10) return `${trimFixed(value, 1)}×`;
  return `${trimFixed(value, 2)}×`;
}

export function formatSpot(value) {
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("zh-CN", {
    minimumFractionDigits: value >= 1000 ? 0 : value >= 1 ? 2 : 4,
    maximumFractionDigits: value >= 1000 ? 0 : value >= 1 ? 2 : 4
  }).format(value);
}

export function formatPercent(value) {
  if (!Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(1)}%`;
}

export function formatDelta(value) {
  if (!Number.isFinite(value)) return "—";
  const digits = Math.abs(value) >= 0.01 ? 3 : 4;
  return value.toFixed(digits);
}

export function formatDte(value) {
  if (!Number.isFinite(value)) return "—";
  return `${trimFixed(value, 1)} 天`;
}

export function formatQty(value) {
  if (!Number.isFinite(value)) return "—";
  return trimFixed(value, 4);
}

export function formatStrikeSpot(strike, spot) {
  if (!Number.isFinite(strike) || !Number.isFinite(spot)) return "—";
  return `${formatSpot(strike)} / ${formatSpot(spot)}`;
}

export function mispricingLabel(status, gap) {
  if (status === "PASS" && Number.isFinite(gap)) return `低 ${(gap * 100).toFixed(1)} 点`;
  if (status === "FAIL" && Number.isFinite(gap)) return `高 ${(Math.abs(gap) * 100).toFixed(1)} 点`;
  if (status === "FLAT") return "持平";
  return "未知";
}

export function cardStatus(item) {
  if (!item?.pass) return item?.fail_reasons?.[0] ?? "未过硬门";
  if (item.mispricing === "PASS") return "错价通过";
  if (item.mispricing === "FLAT") return "参照持平";
  return "尾部偏贵";
}

export function fragilityFromPegs(pegs) {
  const rows = Array.isArray(pegs) ? pegs : [];
  if (!rows.length || rows.some((row) => !(row.price > 0))) {
    return {
      score: null,
      tail_state: "NORMAL",
      known: false,
      evidence: "稳定币价格这轮没有核成。脆弱性不加分，也不升级。",
      categories: []
    };
  }
  const stressed = rows.filter((row) => Math.abs(row.price - 1) >= 0.005);
  const categories = stressed.map((row) => `${row.symbol} 偏离 ${(Math.abs(row.price - 1) * 100).toFixed(2)}%`);
  const score = stressed.reduce((sum, row) => sum + (Math.abs(row.price - 1) >= 0.01 ? 40 : 15), 0);
  return {
    score,
    tail_state: "NORMAL",
    known: true,
    evidence: stressed.length
      ? `稳定币价格出现偏离：${categories.join("、")}。这只是一类证据，不够升到观察或临界。`
      : "USDT、USDC、DAI、USDE、FDUSD 的公开价格都在 1 美元附近 0.5% 以内。Pendle、Aave、Morpho、赎回和清算链这轮没有接上，脆弱性不加分，也不升级。",
    categories
  };
}

export function radarNote(fragility) {
  const base = fragility?.evidence || "脆弱性未知。";
  return `${base} 脆弱性本身不是交易。要升级，还得有可买的 Put，而且这张 Put 还没有被重新定价。`;
}

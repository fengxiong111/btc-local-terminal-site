import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  ALL_IN_CAP,
  WATCHED_SYMBOL,
  bestLevel,
  budgetView,
  buildBoard,
  composeSnapshot,
  crashMultiple,
  entryFee,
  evaluateCandidate,
  finalState,
  formatMultiple,
  localSmile,
  formatUsdt,
  annotateBoard,
  assessFragility,
  nextProbeNotional,
  replayRoute,
  routeThesis,
  simulatePerpShort,
  summarizeProbe
} from "../tail-convexity-lib.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(join(root, "index.html"), "utf8");
const serverTimeMs = Date.parse("2026-10-01T20:00:00Z");
const expiryMs = Date.parse("2026-11-27T08:00:00Z");

function validInput(overrides = {}) {
  return {
    symbol: "BTC-261127-60000-P",
    side: "PUT",
    underlying: "BTCUSDT",
    underlyingType: "CRYPTO",
    status: "TRADING",
    expiryMs,
    serverTimeMs,
    strike: 60000,
    spot: 84756,
    bid: 270,
    ask: 275,
    bidSize: 10,
    askSize: 12,
    minQty: 0.01,
    unit: 1,
    askIv: 0.5,
    delta: -0.036,
    theta: -12.2,
    volume: 1.2,
    takerFeeRate: null,
    ...overrides
  };
}

const smile = { fittedIv: 0.56, count: 8, lower: "BTC-261127-58000-P", upper: "BTC-261127-82000-P" };

function scored(partial) {
  return {
    pass: true,
    mispricing: "PASS",
    fragility_objective: 0,
    min_qty: 0.01,
    ask: 100,
    all_in_max_loss: 2,
    ...partial
  };
}

test("long put economics use contract unit and cap the fee", () => {
  assert.equal(entryFee({ index: 100000, unit: 1, ask: 1, qty: 1, rate: 0.00024 }), 0.1);
  const row = evaluateCandidate(validInput(), { smile, fragilityScore: 0 });
  assert.equal(row.pass, true, row.fail_reasons.join(","));
  assert.ok(Math.abs(row.premium - 2.75) < 1e-9);
  assert.ok(Math.abs(row.fees - Math.min(84756 * 0.00024 * 0.01, 2.75 * 0.1)) < 1e-9);
  assert.ok(row.all_in_max_loss <= ALL_IN_CAP);
  assert.equal(row.mispricing, "PASS");
  assert.equal(row.side, "PUT");

  const xrp = evaluateCandidate(validInput({
    symbol: "XRP-261127-1.2-P",
    underlying: "XRPUSDT",
    strike: 1.2,
    spot: 1.5,
    bid: 0.49,
    ask: 0.5,
    unit: 100,
    minQty: 0.01,
    askIv: 0.4,
    delta: -0.04,
    theta: -0.01
  }), {
    smile: { fittedIv: 0.5, count: 6, lower: "XRP-261127-1.1-P", upper: "XRP-261127-1.3-P" },
    fragilityScore: 0
  });
  assert.equal(xrp.pass, true, xrp.fail_reasons.join(","));
  assert.ok(Math.abs(xrp.premium - 0.005) < 1e-12);
  assert.ok(Math.abs(xrp.fees - 1.5 * 100 * 0.01 * 0.00024) < 1e-12);
  const crashed = crashMultiple({ strike: 1.2, spot: 1.5, unit: 100, qty: 0.01, allIn: xrp.all_in_max_loss, drop: 0.5 });
  assert.ok(Math.abs(crashed.usdt - 0.45) < 1e-12);
  assert.ok(Math.abs(xrp.payoff_50 - crashed.multiple) < 1e-12);
});

test("hard gates fail closed", () => {
  const cases = [
    [validInput({ side: "CALL" }), "不是 Put"],
    [validInput({ underlyingType: "COMMODITY" }), "不是币安 USDT 加密期权"],
    [validInput({ expiryMs: serverTimeMs + 20 * 86400000 }), "剩余天数不在 21–120"],
    [validInput({ expiryMs: serverTimeMs + 121 * 86400000 }), "剩余天数不在 21–120"],
    [validInput({ bid: 0, ask: 0, bidSize: 0, askSize: 0 }), "没有真实双边盘口"],
    [validInput({ bid: 90, ask: 110 }), "价差超过 10%"],
    [validInput({ delta: -0.09 }), "Delta 不在 0.01–0.08"],
    [validInput({ delta: -0.009 }), "Delta 不在 0.01–0.08"],
    [validInput({ delta: null }), "Delta 未知"],
    [validInput({ askIv: 0 }), "卖价 IV 未知"],
    [validInput({ unit: null }), "合约乘数未知"],
    [validInput({ askSize: 0.001 }), "盘口挂单量小于最小下单数量"],
    [validInput({ ask: 600, bid: 590 }), "最小数量的最大损失超过 5 USDT"]
  ];
  for (const [input, reason] of cases) {
    const row = evaluateCandidate(input, { smile, fragilityScore: 0 });
    assert.equal(row.pass, false, input.symbol + " " + reason);
    assert.ok(row.fail_reasons.includes(reason), row.fail_reasons.join(","));
  }
  assert.equal(evaluateCandidate(validInput({ bid: 95, ask: 105, delta: -0.01 }), { smile, fragilityScore: 0 }).pass, true);
  assert.equal(evaluateCandidate(validInput({ delta: -0.08 }), { smile, fragilityScore: 0 }).pass, true);
  assert.equal(evaluateCandidate(validInput(), { fragilityScore: 0 }).pass, false);
  assert.ok(evaluateCandidate(validInput(), { fragilityScore: 0 }).fail_reasons.includes("无法对照同期限参照，错价未知"));
});

test("pareto removes dominated names and mispricing outranks raw crash odds", () => {
  const cheap = scored({
    symbol: "CHEAP",
    mispricing_vol_points: 0.08,
    payoff_blend: 3,
    dte: 100,
    liquidity: 0.2,
    persistence: 0.4,
    all_in_max_loss: 4
  });
  const rich = scored({
    symbol: "RICH",
    mispricing: "FAIL",
    mispricing_vol_points: -0.08,
    payoff_blend: 80,
    dte: 40,
    liquidity: 0.9,
    persistence: 0.9,
    all_in_max_loss: 1
  });
  const worse = scored({
    symbol: "WORSE",
    mispricing_vol_points: 0.01,
    payoff_blend: 1,
    dte: 30,
    liquidity: 0.1,
    persistence: 0.2
  });
  const flat = scored({
    symbol: "FLAT",
    mispricing: "FLAT",
    mispricing_vol_points: 0,
    payoff_blend: 100,
    dte: 90,
    liquidity: 0.95,
    persistence: 0.95,
    all_in_max_loss: 1
  });
  const mild = scored({
    symbol: "MILD",
    mispricing: "FLAT",
    mispricing_vol_points: 0.002,
    payoff_blend: 50,
    dte: 40,
    liquidity: 0.9,
    persistence: 0.9
  });
  const closer = scored({
    symbol: "CLOSER",
    mispricing: "FLAT",
    mispricing_vol_points: 0.008,
    payoff_blend: 5,
    dte: 40,
    liquidity: 0.4,
    persistence: 0.4
  });
  const board = buildBoard([cheap, rich, worse, flat, mild, closer]);
  assert.equal(board.ranked[0].symbol, "CHEAP");
  assert.ok(board.ranked.findIndex((item) => item.symbol === "CLOSER") < board.ranked.findIndex((item) => item.symbol === "MILD"));
  assert.ok(board.ranked.findIndex((item) => item.symbol === "FLAT") > 0);
  assert.equal(board.ranked[0].rank, 1);
  assert.equal(board.edge_count, 1);
  assert.equal(board.ranked.some((item) => item.symbol === "WORSE"), false);
});

test("budget cannot be raised from the ledger and the scale ladder stays manual", () => {
  assert.equal(budgetView({ annual_budget_usdt: 5000, spent_usdt: 12 }).annual_budget_usdt, 300);
  assert.equal(budgetView({ annual_budget_usdt: 5000, spent_usdt: 12 }).remaining_usdt, 288);
  assert.equal(budgetView({ annual_budget_usdt: 500, reauthorized: true }).annual_budget_usdt, 500);
  assert.equal(budgetView({ annual_budget_usdt: 800, reauthorized: true }).annual_budget_usdt, 300);
  const ready = {
    mispricing: "PASS",
    eventStillValid: true,
    spreadOk: true,
    depthOk: true,
    budgetOk: true,
    remainingBudget: 300,
    newInformation: true
  };
  assert.equal(nextProbeNotional({ ...ready, tailState: "NORMAL", lastNotional: 0 }), 5);
  assert.equal(nextProbeNotional({ ...ready, tailState: "NORMAL", lastNotional: 5 }), null);
  assert.equal(nextProbeNotional({ ...ready, tailState: "NORMAL", lastNotional: 0, newInformation: false }), null);
  assert.equal(nextProbeNotional({ ...ready, tailState: "CRITICAL", lastNotional: 0 }), 5);
  assert.equal(nextProbeNotional({ ...ready, tailState: "CRITICAL", lastNotional: 5 }), 10);
  assert.equal(nextProbeNotional({ ...ready, tailState: "CRITICAL", lastNotional: 5, mispricing: "FAIL" }), null);
  assert.equal(nextProbeNotional({ ...ready, tailState: "CRITICAL", lastNotional: 0, unknown: true }), null);
  assert.equal(nextProbeNotional({ ...ready, tailState: "WATCH", lastNotional: 0 }), null);
});

test("final state and the watched put are explicit", () => {
  assert.equal(finalState({ dataOk: false, edgeCount: 3 }), "BLOCKED_DATA");
  assert.equal(finalState({ dataOk: true, orderSent: true, edgeCount: 1 }), "BLOCKED_EXECUTION");
  assert.equal(finalState({ dataOk: true, tailState: "WATCH", edgeCount: 2 }), "WATCH");
  assert.equal(finalState({ dataOk: true, tailState: "CRITICAL", bestInstrument: "LONG_PUT" }), "CRITICAL_PUT");
  assert.equal(finalState({ dataOk: true, tailState: "CRITICAL", bestInstrument: "PERP_SHORT" }), "CRITICAL_SHORT");
  assert.equal(finalState({ dataOk: true, tailState: "CRITICAL", bestInstrument: "PERP_SHORT", alsoPut: true }), "CRITICAL_COMBO");
  assert.equal(finalState({ dataOk: true, riskUnknown: true }), "BLOCKED_RISK");
  assert.equal(finalState({ dataOk: true, tailState: "NORMAL", edgeCount: 2 }), "PUT_PROBE");
  assert.equal(finalState({ dataOk: true, tailState: "NORMAL", edgeCount: 0 }), "NO_EDGE");

  const ranked = [{ symbol: "ETH-1-P", rank: 1, mispricing: "PASS" }, { symbol: WATCHED_SYMBOL, rank: 4, mispricing: "FLAT" }];
  const summary = summarizeProbe({
    watchedSymbol: WATCHED_SYMBOL,
    watched: { symbol: WATCHED_SYMBOL, pass: true, mispricing: "FLAT", fail_reasons: [] },
    ranked,
    executionReasons: ["没有币安交易密钥"]
  });
  assert.match(summary, /不是第一名/);
  assert.match(summary, /不强买/);
  assert.match(summary, /ETH-1-P/);
  assert.match(summary, /委托没有发出/);
  assert.match(summary, /没有币安交易密钥/);

  const snapshot = composeSnapshot({
    generated_at_ms: serverTimeMs,
    fragility: { tail_state: "NORMAL", score: 0, evidence: "平静", categories: [] },
    board: { ranked, edge_count: 1, qualified_count: 2, pareto_count: 2 },
    watched: { symbol: WATCHED_SYMBOL, pass: true, mispricing: "FLAT", fail_reasons: [] },
    funnel: { qualified: 2, pareto: 2, edge: 1 },
    spots: {}
  }, { credentialsPresent: false, venueReachable: false });
  assert.equal(snapshot.state, "PUT_PROBE");
  assert.equal(snapshot.probe.order_sent, false);
  assert.equal(snapshot.probe.intent, null);
  assert.equal(snapshot.display_only, true);
  assert.equal(snapshot.add_allowed, false);
  assert.equal(snapshot.board.length, 2);
});

test("local smile interpolates between neighboring strikes and ignores a wide gap", () => {
  const point = (symbol, strike, askIv) => ({ symbol, strike, spot: 100, askIv, bid: 1, ask: 1.01, spread: 0.01 });
  const points = [point("A", 70, 0.7), point("L", 78, 0.55), point("R", 84, 0.48), point("B", 92, 0.4)];
  const smile = localSmile(points, "SELF", 81, 100);
  const left = Math.log(0.78);
  const right = Math.log(0.84);
  const weight = (Math.log(0.81) - left) / (right - left);
  assert.ok(Math.abs(smile.fittedIv - (0.55 + weight * (0.48 - 0.55))) < 1e-9);
  assert.equal(smile.lower, "L");
  assert.equal(smile.upper, "R");
  assert.equal(smile.extrapolated, false);
  assert.equal(localSmile(points, "SELF", 60, 100), null);
  const wing = localSmile([point("N", 74, 0.6), point("F", 78, 0.55), point("C", 82, 0.5), point("D", 86, 0.46)], "SELF", 70, 100);
  assert.equal(wing.extrapolated, true);
  assert.equal(wing.lower, "N");
  assert.equal(wing.upper, "F");
  assert.deepEqual(bestLevel([{ price: "1", quote: "2" }, { price: "3", quote: "1" }], "bid"), { price: 3, size: 1 });
  assert.equal(bestLevel([{ price: "1", quote: "0" }], "ask"), null);
});

test("display formatters stay compact", () => {
  assert.equal(formatUsdt(2.75), "2.75");
  assert.equal(formatUsdt(0.2034), "0.203");
  assert.equal(formatMultiple(0), "0×");
  assert.equal(formatMultiple(62.44), "62.4×");
});

test("tail board is part of the static page and does not pretend an order filled", () => {
  const board = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "tail-board.js"), "utf8");
  assert.match(html, /id="tail"/);
  assert.match(html, /src="tail-board\.js"/);
  assert.equal(html.includes("前五名按错价"), false);
  assert.equal(html.includes("这一页只展示这些比较结果"), false);
  assert.equal(html.includes("tail-rules"), false);
  assert.equal(html.includes("TAIL_CONVEXITY_V1"), false);
  assert.equal(html.includes("尾部凸性"), false);
  assert.equal(html.includes("刷新全池"), false);
  assert.equal(html.includes("没有边"), false);
  assert.equal(board.includes("eapi.binance.com"), false);
  assert.equal(board.includes("scanTailConvexity"), false);
  assert.equal(html.includes("order_sent: true"), false);
  assert.equal(html.includes("PROBE_OPEN"), false);
  assert.equal(board.includes('["SOLUSDT", "SOL"]'), false);
});

test("router keeps puts first and fails closed without a verified short", () => {
  const put = {
    pass: true,
    mispricing: "FLAT",
    ask_iv: 0.66,
    all_in_max_loss: 1.65,
    burn_ratio: 0.03,
    payoff_blend: 12,
    payoff_50: 15,
    liquidity: 0.6
  };
  const normal = routeThesis({ tailState: "NORMAL", put });
  assert.equal(normal.best_instrument, "LONG_PUT");
  assert.equal(normal.perp_state, "OFF");
  assert.equal(normal.execution_state, "DISPLAY_ONLY");

  const critical = routeThesis({
    tailState: "CRITICAL",
    put: { ...put, mispricing: "FAIL", ask_iv: 1.8 },
    perp: { mark: 100, depth: 10, spread: 0.0002, funding: 0.0001, leverage: 1 }
  });
  assert.equal(critical.best_instrument, "LONG_PUT");
  assert.equal(critical.perp_state, "FAIL_CLOSED");
  assert.equal(simulatePerpShort({}).eligible, false);

  const board = annotateBoard([
    { ...put, symbol: "BTC-1-P", underlying: "BTCUSDT", rank: 1 },
    { ...put, symbol: "BTC-2-P", underlying: "BTCUSDT", rank: 2 },
    { ...put, symbol: "BTC-3-P", underlying: "BTCUSDT", rank: 3 },
    { ...put, symbol: "ETH-1-P", underlying: "ETHUSDT", rank: 4 }
  ], { tailState: "NORMAL" });
  assert.equal(board.length, 3);
  assert.equal(board[2].cluster_full, true);
  assert.equal(board.some((item) => item.symbol === "ETH-1-P"), false);
});

test("fragility needs two authoritative mechanisms and replay blocks illegal adds", () => {
  const calm = assessFragility({
    pegs: [{ symbol: "USDT", price: 1 }, { symbol: "USDC", price: 0.999 }],
    pendle: { connected: true, rows: [{ address: "a", ptDiscount: 0.02, liquidityUsd: 2_000_000, active: true }] },
    aave: { connected: true, rows: [{ symbol: "USDT", price: 1, utilization: 0.9, availableUsd: 50_000_000, frozen: false, paused: false }] },
    morpho: { connected: true, rows: [] }
  });
  assert.equal(calm.tail_state, "NORMAL");

  const thirdParty = assessFragility({
    pegs: [{ symbol: "USDT", price: 0.9 }, { symbol: "USDC", price: 0.9 }]
  });
  assert.equal(thirdParty.tail_state, "WATCH");

  const critical = assessFragility({
    aave: { connected: true, rows: [{ symbol: "USDT", price: 0.98, frozen: true, paused: false, utilization: 0.5, availableUsd: 1 }] },
    morpho: { connected: true, rows: [{ id: "m1", loan: "USDC", supplyUsd: 20_000_000, liquidityUsd: 1000, utilization: 0.99, badDebtUsd: 500_000 }] }
  });
  assert.equal(critical.tail_state, "CRITICAL");

  const absurd = assessFragility({
    morpho: { connected: true, rows: [{ id: "dust", loan: "USDC", supplyUsd: 12_000_000_000, liquidityUsd: 0, utilization: 1, badDebtUsd: 11_000_000_000 }] }
  });
  assert.equal(absurd.tail_state, "NORMAL");

  assert.equal(replayRoute([
    { tailState: "NORMAL", instrument: "LONG_PUT", total: 5, newInformation: true, leverage: 1 }
  ]).pass, true);
  assert.equal(replayRoute([
    { tailState: "NORMAL", instrument: "PERP_SHORT", total: 5, newInformation: true }
  ]).pass, false);
  assert.equal(replayRoute([
    { tailState: "CRITICAL", instrument: "PERP_SHORT", total: 5, newInformation: true, leverage: 1 },
    { tailState: "CRITICAL", instrument: "PERP_SHORT", total: 25, newInformation: true, leverage: 1 }
  ]).pass, false);
  assert.equal(replayRoute([
    { tailState: "CRITICAL", instrument: "LONG_PUT", total: 5, newInformation: true, leverage: 1 },
    { tailState: "CRITICAL", instrument: "PERP_SHORT", total: 5, newInformation: false, leverage: 1, marginMode: "CROSS" }
  ]).pass, false);
  const climbed = replayRoute([
    { tailState: "CRITICAL", instrument: "LONG_PUT", total: 5, newInformation: true, leverage: 1 },
    { tailState: "CRITICAL", instrument: "PERP_SHORT", total: 10, newInformation: true, leverage: 1, marginMode: "ISOLATED" }
  ]);
  assert.equal(climbed.pass, true);
});

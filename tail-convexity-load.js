import {
  WATCHED_SYMBOL,
  ALL_IN_CAP,
  DTE_MIN,
  DTE_MAX,
  SPREAD_MAX,
  bestLevel,
  buildBoard,
  countReasons,
  evaluateCandidate,
  fragilityFromPegs,
  localSmile,
  num
} from "./tail-convexity-lib.js";

const BASE = "https://www.binance.com/bapi/eoptions/v1/public/eoptions";
const PEG_URL = "https://coins.llama.fi/prices/current/coingecko:tether,coingecko:usd-coin,coingecko:dai,coingecko:ethena-usde,coingecko:first-digital-usd";
const HEADERS = { accept: "application/json", "user-agent": "Mozilla/5.0" };
const PEGS = [
  ["coingecko:tether", "USDT"],
  ["coingecko:usd-coin", "USDC"],
  ["coingecko:dai", "DAI"],
  ["coingecko:ethena-usde", "USDE"],
  ["coingecko:first-digital-usd", "FDUSD"]
];

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getJson(fetchImpl, url) {
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetchImpl(url, { headers: HEADERS });
    if (response.status === 429 || response.status >= 500) {
      lastError = new Error(`HTTP ${response.status} ${url}`);
      await delay(400 * (attempt + 1));
      continue;
    }
    if (!response.ok) throw new Error(`HTTP ${response.status} ${url}`);
    const body = await response.json();
    if (body.code && body.code !== "000000" && body.code !== 0) {
      throw new Error(body.message || body.msg || `code ${body.code}`);
    }
    return body.data;
  }
  throw lastError ?? new Error(`failed ${url}`);
}

async function mapPool(items, limit, worker) {
  const output = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await worker(items[index], index);
    }
  }
  const width = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: width }, run));
  return output;
}

function tickerSpread(bid, ask) {
  if (!(bid > 0) || !(ask > 0) || ask < bid) return null;
  return (ask - bid) / ((ask + bid) / 2);
}

async function loadPegs(fetchImpl) {
  try {
    const response = await fetchImpl(PEG_URL, { headers: HEADERS });
    if (!response.ok) return fragilityFromPegs([]);
    const body = await response.json();
    const coins = body.coins || {};
    return fragilityFromPegs(PEGS.map(([key, symbol]) => ({ symbol, price: num(coins[key]?.price) })));
  } catch {
    return fragilityFromPegs([]);
  }
}

async function loadBook(fetchImpl, symbol) {
  let last = { bid: null, ask: null };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const data = await getJson(fetchImpl, `${BASE}/market/depth?symbol=${encodeURIComponent(symbol)}&limit=20`);
    const bid = bestLevel(data?.bids, "bid");
    const ask = bestLevel(data?.asks, "ask");
    last = { bid, ask, lastUpdateId: data?.lastUpdateId ?? null };
    if (bid && ask) return last;
    await delay(250);
  }
  return last;
}

export async function scanTailConvexity({ fetchImpl = fetch, concurrency = 5, now = () => Date.now() } = {}) {
  const [info, tickerRows, indexRows, fragility] = await Promise.all([
    getJson(fetchImpl, `${BASE}/exchange/symbols`),
    getJson(fetchImpl, `${BASE}/market/ticker`),
    getJson(fetchImpl, `${BASE}/market/index`),
    loadPegs(fetchImpl)
  ]);
  const serverTimeMs = num(info?.serverTime);
  if (serverTimeMs === null) throw new Error("期权服务器时间未知");
  if (Math.abs(now() - serverTimeMs) > 120000) throw new Error("本地时间和期权服务器时间差得太远");

  const spots = {};
  for (const row of indexRows || []) {
    const price = num(row.indexPrice);
    if (row.underlying && price > 0) spots[row.underlying] = price;
  }
  const crypto = new Set((info.optionContracts || [])
    .filter((contract) => contract.underlyingType === "CRYPTO")
    .map((contract) => contract.underlying));
  const symbols = new Map((info.optionSymbols || []).map((symbol) => [symbol.symbol, symbol]));
  const tickers = new Map((tickerRows || []).map((row) => [row.symbol, row]));

  const funnel = {
    listed: symbols.size,
    crypto_puts: 0,
    dte_in_range: 0,
    ticker_book: 0,
    ticker_spread: 0,
    premium_under_cap: 0,
    depth_fetched: 0,
    qualified: 0,
    pareto: 0,
    edge: 0
  };
  const chain = new Map();
  const queue = [];

  for (const spec of symbols.values()) {
    if (spec.side !== "PUT" || !crypto.has(spec.underlying) || spec.underlyingType !== "CRYPTO") continue;
    funnel.crypto_puts += 1;
    const ticker = tickers.get(spec.symbol) || {};
    const spot = spots[spec.underlying] ?? null;
    const expiryMs = num(spec.expiryDate);
    const dte = expiryMs !== null ? (expiryMs - serverTimeMs) / 86400000 : null;
    const bid = num(ticker.bidPrice);
    const ask = num(ticker.askPrice);
    const spread = tickerSpread(bid, ask);
    const minQty = num(spec.minQty);
    const askIv = num(ticker.askIV);
    const inDte = dte !== null && dte >= DTE_MIN && dte <= DTE_MAX;
    if (inDte) funnel.dte_in_range += 1;
    if (spread !== null) funnel.ticker_book += 1;
    if (spread !== null && spread <= SPREAD_MAX) funnel.ticker_spread += 1;
    if (spread !== null && ask !== null && minQty > 0 && ask * minQty <= ALL_IN_CAP) funnel.premium_under_cap += 1;

    const point = {
      symbol: spec.symbol,
      underlying: spec.underlying,
      expiryMs,
      strike: num(spec.strikePrice),
      spot,
      bid,
      ask,
      spread: spread ?? 99,
      askIv
    };
    const chainKey = `${spec.underlying}|${expiryMs}`;
    if (!chain.has(chainKey)) chain.set(chainKey, []);
    chain.get(chainKey).push(point);

    const structural = inDte && spread !== null && spread <= SPREAD_MAX && ask > 0 && minQty > 0 && ask * minQty <= ALL_IN_CAP;
    if (structural || spec.symbol === WATCHED_SYMBOL) queue.push({ spec, ticker, spot });
  }

  if (typeof process !== "undefined" && process.stderr) console.error(`tail queue ${queue.length}`);
  let finished = 0;
  const books = await mapPool(queue, concurrency, async (entry) => {
    const [mark, book] = await Promise.all([
      getJson(fetchImpl, `${BASE}/market/markPrice?symbol=${encodeURIComponent(entry.spec.symbol)}`).catch(() => null),
      loadBook(fetchImpl, entry.spec.symbol).catch(() => ({ bid: null, ask: null }))
    ]);
    finished += 1;
    if ((finished % 25 === 0 || finished === queue.length) && typeof process !== "undefined" && process.stderr) {
      console.error(`tail book ${finished}/${queue.length}`);
    }
    return { entry, mark, book };
  });
  funnel.depth_fetched = books.length;

  const evaluated = books.map(({ entry, mark, book }) => {
    const chainKey = `${entry.spec.underlying}|${entry.spec.expiryDate}`;
    const strike = num(entry.spec.strikePrice);
    const smile = localSmile(chain.get(chainKey) || [], entry.spec.symbol, strike, entry.spot);
    return evaluateCandidate({
      symbol: entry.spec.symbol,
      side: entry.spec.side,
      underlying: entry.spec.underlying,
      underlyingType: entry.spec.underlyingType,
      status: entry.spec.status,
      expiryMs: entry.spec.expiryDate,
      serverTimeMs,
      strike: entry.spec.strikePrice,
      spot: entry.spot,
      bid: book?.bid?.price ?? null,
      ask: book?.ask?.price ?? null,
      bidSize: book?.bid?.size ?? null,
      askSize: book?.ask?.size ?? null,
      minQty: entry.spec.minQty,
      unit: entry.spec.unit,
      askIv: entry.ticker.askIV,
      markIv: mark?.volatility,
      delta: mark?.delta,
      theta: mark?.theta,
      volume: entry.ticker.volume,
      takerFeeRate: entry.spec.takerFeeRate,
      priceScale: entry.spec.priceScale
    }, {
      smile,
      fragilityScore: fragility.score
    });
  });

  const board = buildBoard(evaluated);
  funnel.qualified = board.qualified_count;
  funnel.pareto = board.pareto_count;
  funnel.edge = board.edge_count;
  const watched = evaluated.find((item) => item.symbol === WATCHED_SYMBOL) ?? {
    symbol: WATCHED_SYMBOL,
    pass: false,
    state: "FAIL",
    fail_reasons: ["合约表里没有这张 Put"],
    mispricing: "UNKNOWN",
    mispricing_evidence: "合约表里没有这张 Put。"
  };

  return {
    generated_at_ms: now(),
    server_time_ms: serverTimeMs,
    spots,
    funnel,
    evaluated,
    watched,
    board,
    fragility,
    reject_counts: countReasons(evaluated)
  };
}

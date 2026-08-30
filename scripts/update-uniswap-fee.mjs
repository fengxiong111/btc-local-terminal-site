import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const endpoint = process.env.UNISWAP_STATS_URL ?? "https://interface.gateway.uniswap.org/v2/uniswap.explore.v1.ExploreStatsService/ExploreStats";
const output = join(process.cwd(), "uniswap-fee.json");
const v2TotalFeeRate = 0.003;
const rwaSymbols = new Set(["RWA", "PAXG", "XAUT", "OUSG", "USDY", "BUIDL", "USTB", "TBILL"]);
const rwaMetadataPattern = /real[ -]?world|tokeni[sz]ed|synthetic stock|synthetic equity|treasury|t-bill|gold|silver|equity|stock|rwa/i;

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function stringValue(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value) {
  const source = record(value);
  const number = Number(source && "value" in source ? source.value : value);
  return Number.isFinite(number) ? number : null;
}

function tokenInfo(value) {
  const token = record(value);
  if (!token) return null;
  const project = record(token.project);
  const address = stringValue(token.address) ?? "";
  const symbol = stringValue(token.symbol) ?? "";
  const name = stringValue(token.name) ?? symbol;
  const projectName = stringValue(project?.name) ?? "";
  if (!symbol && !address) return null;
  return {
    address,
    symbol: symbol || address,
    name,
    projectName,
    isSpam: project?.isSpam === true
  };
}

function isUsdc(symbol) {
  return /^(USDC|USDC[._-]E)$/i.test(symbol);
}

function isRwaToken(token) {
  return rwaSymbols.has(token.symbol.toUpperCase()) || rwaMetadataPattern.test(`${token.name} ${token.projectName}`);
}

function feeRate(protocol, pool) {
  if (protocol === "V2") return v2TotalFeeRate;
  const tier = numberValue(pool.feeTier);
  return tier === null || tier < 0 ? null : tier / 1_000_000;
}

function readPool(value, protocol) {
  const pool = record(value);
  const token0 = tokenInfo(pool?.token0);
  const token1 = tokenInfo(pool?.token1);
  const poolAddress = stringValue(pool?.id);
  const chain = stringValue(pool?.chain);
  const volume24h = numberValue(pool?.volume1Day);
  const tvl = numberValue(pool?.totalLiquidity);
  const rate = pool ? feeRate(protocol, pool) : null;
  if (!poolAddress || !chain || !token0 || !token1 || token0.isSpam || token1.isSpam || volume24h === null || volume24h <= 0 || rate === null || rate <= 0) return null;
  const fee24h = volume24h * rate;
  if (!Number.isFinite(fee24h) || fee24h <= 0) return null;
  const isRwa = isRwaToken(token0) || isRwaToken(token1);
  const isRwaUsdc = (isUsdc(token0.symbol) && isRwaToken(token1)) || (isUsdc(token1.symbol) && isRwaToken(token0));
  return {
    rank: 0,
    protocol,
    chain,
    poolAddress,
    pair: `${token0.symbol}/${token1.symbol}`,
    volume24h,
    feeRate: rate,
    fee24h,
    tvl,
    isRwa,
    isRwaUsdc
  };
}

function rankRows(rows, limit) {
  return rows.slice().sort((left, right) => right.fee24h - left.fee24h || right.volume24h - left.volume24h || left.pair.localeCompare(right.pair)).slice(0, limit).map((row, index) => ({ ...row, rank: index + 1 }));
}

const message = encodeURIComponent(JSON.stringify({ chainId: "ALL_NETWORKS" }));
const response = await fetch(`${endpoint}?connect=v1&encoding=json&message=${message}`, {
  headers: {
    Accept: "application/json",
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
    Origin: "https://app.uniswap.org",
    Referer: "https://app.uniswap.org/"
  }
});
if (!response.ok) throw new Error(`Uniswap ExploreStats HTTP ${response.status}`);
const payload = await response.json();
const stats = record(record(payload)?.stats);
if (!stats) throw new Error("Uniswap ExploreStats response has no stats");

const rows = ["V2", "V3", "V4"].flatMap((protocol) => {
  const source = stats[`poolStats${protocol}`];
  return Array.isArray(source) ? source.map((row) => readPool(row, protocol)).filter(Boolean) : [];
});
if (rows.length === 0) throw new Error("Uniswap ExploreStats returned no usable pool rows");

const snapshot = {
  schemaVersion: 1,
  source: "uniswap-explore-stats",
  sourceUrl: endpoint,
  generatedAt: new Date().toISOString(),
  scope: "Uniswap v2 / v3 / v4 · ALL_NETWORKS · public top-pool snapshot",
  feeBasis: "24h volume × pool fee tier; v2 uses the documented 0.30% total swap fee",
  rows,
  leaders: rankRows(rows, 5),
  rwaUsdcRows: rankRows(rows.filter((row) => row.isRwaUsdc), 3),
  coinRows: rankRows(rows.filter((row) => !row.isRwa), 3)
};

await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
console.log(`wrote ${snapshot.rwaUsdcRows.length} RWA/USDC rows and ${snapshot.coinRows.length} coin rows to ${output}`);

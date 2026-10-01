import { scanTailConvexity } from "./tail-convexity-load.js";
import {
  cardStatus,
  composeSnapshot,
  formatDelta,
  formatDte,
  formatMultiple,
  formatPercent,
  formatPremium,
  formatQty,
  formatSpot,
  formatStrikeSpot,
  formatUsdt,
  mispricingLabel,
  stateCopy
} from "./tail-convexity-lib.js";

const STALE_MS = 45 * 60 * 1000;
const SPOTS = [
  ["BTCUSDT", "BTC"],
  ["ETHUSDT", "ETH"],
  ["SOLUSDT", "SOL"],
  ["BNBUSDT", "BNB"],
  ["XRPUSDT", "XRP"],
  ["DOGEUSDT", "DOGE"]
];

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

function metric(label, value, className) {
  const wrap = el("div");
  wrap.append(el("dt", null, label), el("dd", className, value));
  return wrap;
}

function renderBoard(snapshot) {
  const stateNode = document.querySelector("#tail-state");
  const summaryNode = document.querySelector("#tail-summary");
  const metaNode = document.querySelector("#tail-meta");
  const budgetNode = document.querySelector("#tail-budget");
  const radarNode = document.querySelector("#tail-radar");
  const listNode = document.querySelector("#tail-list");
  const footNode = document.querySelector("#tail-foot");
  const sectionNode = document.querySelector("#tail");
  if (!stateNode || !listNode) return;

  const [label, tone] = stateCopy(snapshot.state);
  stateNode.textContent = label;
  stateNode.dataset.tone = tone;
  summaryNode.textContent = snapshot.probe?.summary || "";
  const age = Date.now() - (snapshot.generated_at_ms || 0);
  const stale = !snapshot.generated_at_ms || age > STALE_MS;
  sectionNode.dataset.marketState = stale ? "stale" : "live";

  const spotText = SPOTS
    .filter(([key]) => Number.isFinite(snapshot.spots?.[key]))
    .map(([key, name]) => `${name} ${formatSpot(snapshot.spots[key])}`)
    .join(" · ");
  const when = snapshot.generated_at_ms
    ? new Date(snapshot.generated_at_ms).toLocaleString("zh-CN", { hour12: false, month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : "没有时间";
  const funnel = snapshot.funnel || {};
  metaNode.textContent = [
    spotText,
    `快照 ${when}${stale ? " · 已旧" : ""}`,
    `硬门 ${funnel.qualified ?? 0}`,
    `帕累托 ${funnel.pareto ?? 0}`,
    `错价 ${funnel.edge ?? 0}`
  ].filter(Boolean).join(" · ");

  const budget = snapshot.budget || {};
  budgetNode.textContent = `年度上限 ${formatUsdt(budget.annual_budget_usdt)} USDT · 已计入 ${formatUsdt(budget.spent_usdt)} · 单笔 ${formatUsdt(budget.per_order_cap_usdt)} · 风险状态 ${snapshot.tail_state || "NORMAL"}`;
  radarNode.textContent = snapshot.radar?.note || "";

  listNode.replaceChildren();
  const rows = Array.isArray(snapshot.board) ? snapshot.board : [];
  if (!rows.length) {
    listNode.append(el("li", "empty", snapshot.state === "BLOCKED_DATA" ? "这轮没有读到期权链。" : "这轮没有可展示的候选。"));
  }
  for (const item of rows) {
    const card = el("li", "tail-card");
    card.dataset.symbol = item.symbol;
    card.dataset.mispricing = item.mispricing || "UNKNOWN";
    if (stale) card.dataset.marketState = "stale";
    const top = el("div", "tail-card-top");
    top.append(el("span", "market-stale-dot"));
    top.append(el("span", "tail-rank", String(item.rank).padStart(2, "0")));
    top.append(el("h3", "tail-symbol", item.symbol));
    const loss = el("p", "tail-loss");
    loss.append(document.createTextNode(formatUsdt(item.all_in_max_loss)));
    loss.append(el("small", null, "USDT 最大损失"));
    top.append(loss);

    const metrics = el("dl", "tail-metrics");
    const statusClass = item.mispricing === "FAIL" ? "is-rich" : item.mispricing === "PASS" ? "is-edge" : "";
    metrics.append(
      metric("剩余", formatDte(item.dte)),
      metric("行权 / 现价", formatStrikeSpot(item.strike, item.spot)),
      metric("Delta", formatDelta(item.delta)),
      metric("卖价 IV", formatPercent(item.ask_iv)),
      metric("买 / 卖", `${formatPremium(item.bid)} / ${formatPremium(item.ask)}`),
      metric("价差", formatPercent(item.spread), item.spread > 0.05 ? "is-wide" : ""),
      metric("最小数量", formatQty(item.min_qty)),
      metric("权利金", formatUsdt(item.premium)),
      metric("费用", formatUsdt(item.fees)),
      metric("最大损失", formatUsdt(item.all_in_max_loss)),
      metric("错价", mispricingLabel(item.mispricing, item.mispricing_vol_points), statusClass),
      metric("状态", cardStatus(item), statusClass),
      metric("跌 30%", formatMultiple(item.payoff_30)),
      metric("跌 50%", formatMultiple(item.payoff_50)),
      metric("跌 70%", formatMultiple(item.payoff_70)),
      metric("跌 90%", formatMultiple(item.payoff_90)),
      metric("盘口", `${formatQty(item.bid_size)} / ${formatQty(item.ask_size)} · 24h ${formatQty(item.volume)}`),
      metric("脆弱性", Number.isFinite(item.fragility_score) ? formatUsdt(item.fragility_score) : "未知")
    );
    card.append(top, metrics, el("p", "tail-evidence", item.mispricing_evidence || ""));
    listNode.append(card);
  }

  footNode.replaceChildren(
    el("span", null, snapshot.method || ""),
    el("span", null, snapshot.equity_proxy?.reason || ""),
    el("span", null, snapshot.inverse_rwa?.reason || "")
  );
  window.__TAIL_BOARD__ = snapshot;
}

async function loadSnapshot() {
  const response = await fetch("tail-convexity.json", { cache: "no-cache" });
  if (!response.ok) throw new Error("snapshot missing");
  return response.json();
}

async function refreshLive(button, current) {
  button.disabled = true;
  const previous = button.textContent;
  button.textContent = "正在刷新全池…";
  try {
    const scan = await scanTailConvexity();
    let venueReachable = false;
    try {
      const ping = await fetch("https://eapi.binance.com/eapi/v1/ping", { signal: AbortSignal.timeout(8000) });
      venueReachable = ping.ok;
    } catch {
      venueReachable = false;
    }
    const ledger = {
      annual_budget_usdt: current?.budget?.annual_budget_usdt,
      spent_usdt: current?.budget?.spent_usdt,
      reauthorized: current?.budget?.reauthorized === true
    };
    renderBoard(composeSnapshot(scan, { ledger, credentialsPresent: false, venueReachable }));
  } catch {
    const summaryNode = document.querySelector("#tail-summary");
    if (summaryNode) summaryNode.textContent = "这次全池刷新没有读成。页面留着上一份结果，没有下单。";
  } finally {
    button.disabled = false;
    button.textContent = previous;
  }
}

async function start() {
  const button = document.querySelector("#tail-refresh");
  let current = null;
  try {
    current = await loadSnapshot();
    renderBoard(current);
  } catch {
    renderBoard({
      state: "BLOCKED_DATA",
      tail_state: "NORMAL",
      generated_at_ms: 0,
      probe: { summary: "筛选结果还没有读到。没有下单。" },
      budget: { annual_budget_usdt: 300, spent_usdt: 0, per_order_cap_usdt: 5 },
      spots: {},
      funnel: {},
      radar: { note: "期权链没有读成。" },
      board: [],
      method: "",
      equity_proxy: { reason: "" },
      inverse_rwa: { reason: "" }
    });
  }
  if (button) {
    button.addEventListener("click", () => {
      current = window.__TAIL_BOARD__ || current;
      refreshLive(button, current);
    });
  }
}

start();

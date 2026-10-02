import {
  DISPLAY_LIMIT,
  annotateBoard,
  formatDelta,
  formatDte,
  formatMultiple,
  formatPercent,
  formatPremium,
  formatQty,
  formatStrikeSpot,
  formatUsdt,
  mispricingLabel,
  cardStatus
} from "./tail-convexity-lib.js";

const STALE_MS = 45 * 60 * 1000;
const INSTRUMENT = {
  LONG_PUT: "买 Put",
  PERP_SHORT: "逐仓永续空",
  INVERSE_RWA: "反向 RWA",
  NONE: "没有"
};
const PERP = {
  OFF: "永续关闭",
  SIMULATION: "永续仅模拟",
  FAIL_CLOSED: "永续未通过",
  ELIGIBLE: "逐仓永续空"
};

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

function instrumentLabel(code) {
  return INSTRUMENT[code] || "没有";
}

function secondLabel(route) {
  if (!route) return "—";
  if (route.second_instrument) return instrumentLabel(route.second_instrument);
  return PERP[route.perp_state] || "—";
}

function executionLabel(item) {
  if (item.cluster_full) return "同一标的已满";
  return "只展示";
}

function fundingText(value) {
  if (!Number.isFinite(value)) return "—";
  return formatPercent(value);
}

function carryText(value) {
  if (!Number.isFinite(value)) return "—";
  return formatPercent(value);
}

function renderBoard(snapshot) {
  const listNode = document.querySelector("#tail-list");
  const replacementNode = document.querySelector("#tail-replacement");
  const sectionNode = document.querySelector("#tail");
  if (!listNode) return;

  const age = Date.now() - (snapshot.generated_at_ms || 0);
  const stale = !snapshot.generated_at_ms || age > STALE_MS;
  if (sectionNode) sectionNode.dataset.marketState = stale ? "stale" : "live";

  const ranked = Array.isArray(snapshot.board) ? snapshot.board : [];
  const rows = ranked[0]?.route
    ? ranked.slice(0, DISPLAY_LIMIT)
    : annotateBoard(ranked, { tailState: snapshot.tail_state || "NORMAL" });

  listNode.replaceChildren();
  if (!rows.length) {
    listNode.append(el("li", "empty", "这轮没有可展示的期权。"));
  }
  for (const item of rows) {
    const route = item.route || {};
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
      metric("工具", instrumentLabel(route.best_instrument)),
      metric("次选", secondLabel(route)),
      metric("执行", executionLabel(item)),
      metric("剩余", formatDte(item.dte)),
      metric("行权 / 现价", formatStrikeSpot(item.strike, item.spot)),
      metric("Delta", formatDelta(item.delta)),
      metric("卖价 IV", formatPercent(item.ask_iv)),
      metric("买 / 卖", `${formatPremium(item.bid)} / ${formatPremium(item.ask)}`),
      metric("价差", formatPercent(item.spread), item.spread > 0.05 ? "is-wide" : ""),
      metric("权利金", formatUsdt(item.premium)),
      metric("费用", formatUsdt(item.fees)),
      metric("最大损失", formatUsdt(route.max_loss ?? item.all_in_max_loss)),
      metric("错价", mispricingLabel(item.mispricing, item.mispricing_vol_points), statusClass),
      metric("状态", cardStatus(item), statusClass),
      metric("跌 50%", formatMultiple(route.crash_payoff ?? item.payoff_50)),
      metric("路径依赖", route.path_dependency || "低"),
      metric("清算", route.liquidation_risk || "无"),
      metric("资金费", fundingText(route.funding)),
      metric("盘口", `${formatQty(item.bid_size)} / ${formatQty(item.ask_size)}`),
      metric("持有成本", carryText(item.burn_ratio))
    );
    card.append(top, metrics, el("p", "tail-evidence", item.mispricing_evidence || ""));
    listNode.append(card);
  }

  if (replacementNode) {
    const report = Array.isArray(snapshot.replacement_report) ? snapshot.replacement_report : [];
    replacementNode.textContent = report
      .map((row) => {
        const parts = [];
        if (row.added) parts.push(`换入 ${row.added}`);
        if (row.removed) parts.push(`换出 ${row.removed}`);
        return parts.join("，");
      })
      .filter(Boolean)
      .join(" · ");
  }
  window.__TAIL_BOARD__ = snapshot;
}

async function loadSnapshot() {
  const response = await fetch("tail-convexity.json", { cache: "no-cache" });
  if (!response.ok) throw new Error("snapshot missing");
  return response.json();
}

async function start() {
  try {
    renderBoard(await loadSnapshot());
  } catch {
    renderBoard({
      state: "BLOCKED_DATA",
      tail_state: "NORMAL",
      generated_at_ms: 0,
      board: [],
      replacement_report: []
    });
  }
}

start();

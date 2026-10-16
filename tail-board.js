import {
  DISPLAY_LIMIT,
  annotateBoard,
  formatDte,
  formatMultiple,
  formatPremium,
  formatUsdt
} from "./tail-convexity-lib.js";

const STALE_MS = 45 * 60 * 1000;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

function cell(className, label, value) {
  const node = el("span", `tail-cell ${className}`, value);
  node.setAttribute("role", "cell");
  node.dataset.label = label;
  return node;
}

function renderBoard(snapshot) {
  const listNode = document.querySelector("#tail-list");
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
    listNode.append(el("li", "tail-empty", "这轮没有可展示的期权。"));
  }

  for (const item of rows) {
    const route = item.route || {};
    const row = el("li", "tail-card");
    row.setAttribute("role", "row");
    row.dataset.symbol = item.symbol;
    if (stale) row.dataset.marketState = "stale";
    row.append(
      cell("tail-symbol", "标的名", item.symbol),
      cell("tail-days", "剩余天数", formatDte(item.dte)),
      cell("tail-cost", "最小成本", `${formatUsdt(item.all_in_max_loss)} USDT`),
      cell("tail-price", "卖一价格", formatPremium(item.ask)),
      cell("tail-multiple", "50% 跌幅倍数", formatMultiple(route.crash_payoff ?? item.payoff_50))
    );
    listNode.append(row);
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
      board: []
    });
  }
}

start();

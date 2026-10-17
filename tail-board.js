import {
  DISPLAY_LIMIT,
  annotateBoard,
  formatDte,
  formatMultiple,
  formatUsdt
} from "./tail-convexity-lib.js";

const STALE_MS = 45 * 60 * 1000;
const REFRESH_MS = 60 * 1000;
let inFlight = null;

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
  const stale = !snapshot.generated_at_ms || age < -120000 || age > STALE_MS || snapshot.state === "BLOCKED_DATA" || snapshot.state === "BLOCKED_EVIDENCE";
  if (sectionNode) {
    sectionNode.dataset.marketState = stale ? "stale" : "live";
    sectionNode.dataset.snapshotState = snapshot.state || "UNKNOWN";
    sectionNode.dataset.opportunityState = snapshot.opportunity_state || "UNKNOWN";
  }

  const ranked = Array.isArray(snapshot.board) ? snapshot.board : [];
  const rows = ranked[0]?.route
    ? ranked.slice(0, DISPLAY_LIMIT)
    : annotateBoard(ranked, { tailState: snapshot.tail_state || "NORMAL" });

  listNode.replaceChildren();
  if (!rows.length) {
    listNode.append(el("li", "tail-empty", snapshot.state === "BLOCKED_DATA" ? "期权数据暂不可用。" : "这轮没有可展示的期权。"));
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
      cell("tail-cost", "最小下单成本", `${formatUsdt(item.all_in_max_loss)} USDT`),
      cell("tail-multiple", "50% 跌幅倍数", formatMultiple(route.crash_payoff ?? item.payoff_50))
    );
    listNode.append(row);
  }

  window.__TAIL_BOARD__ = snapshot;
}

async function loadSnapshot() {
  const response = await fetch("tail-convexity.json", { cache: "no-store" });
  if (!response.ok) throw new Error("snapshot missing");
  const snapshot = await response.json();
  if (snapshot?.schema !== "tail-convexity-v1" || !Array.isArray(snapshot.board)) throw new Error("invalid snapshot schema");
  return snapshot;
}

function refresh() {
  if (inFlight) return inFlight;
  inFlight = loadSnapshot().then(renderBoard).catch(() => renderBoard({
    state: "BLOCKED_DATA",
    tail_state: "UNKNOWN",
    generated_at_ms: 0,
    board: []
  })).finally(() => { inFlight = null; });
  return inFlight;
}

refresh();
window.setInterval(refresh, REFRESH_MS);
window.addEventListener("focus", refresh, { passive: true });
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") refresh();
});

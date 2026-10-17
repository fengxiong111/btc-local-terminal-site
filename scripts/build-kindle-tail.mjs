import { readFile, writeFile } from "node:fs/promises";

const esc = (text) => String(text ?? "").replace(/[&<>"']/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export function makeKindlePage(snapshot, metrics = null) {
  const metricsAge = Date.now() - (metrics?.observed_at_ms || 0);
  const metricsGood = metrics?.schema === "btc-metrics-v1"
    && metrics.status === "LIVE" && metricsAge >= -120000 && metricsAge < 90 * 60000;
  const price = (v, digits = 0) => metricsGood && typeof v === "number" && Number.isFinite(v)
    ? v.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits }) : "未知";
  const change = metricsGood && Number.isFinite(metrics?.btc_change_24h_pct)
    ? `${metrics.btc_change_24h_pct >= 0 ? "+" : ""}${metrics.btc_change_24h_pct.toFixed(2)}%` : "未知";
  const stamp = Number.isFinite(snapshot?.generated_at_ms)
    ? new Date(snapshot.generated_at_ms + 8 * 3600_000).toISOString().slice(5, 16)
      .replace("-", "月").replace("T", "日 ")
    : "时间未知";
  const healthy = snapshot?.schema === "tail-convexity-v1" && Array.isArray(snapshot.board)
    && !["BLOCKED_DATA", "BLOCKED_EVIDENCE"].includes(snapshot.state)
    && snapshot?.radar?.evidence_state !== "BLOCKED_EVIDENCE";
  const rows = healthy ? snapshot.board.slice(0, 3) : [];
  const status = !healthy ? "数据不可用" : snapshot.tail_state === "CRITICAL" ? "CRITICAL"
    : snapshot.tail_state === "WATCH" ? "WATCH" : snapshot.tail_state || "UNKNOWN";
  const edge = healthy && snapshot.opportunity_state === "RELATIVE_DISCOUNT_REVIEW_ONLY"
    ? "有待复核机会" : "无新错价";
  const list = rows.map((row) => `<li>
<strong>${esc(row.symbol)}</strong>
<span>${esc(Number.isFinite(row.dte) ? Math.ceil(row.dte) : "?")}天
 · ${esc(Number.isFinite(row.all_in_max_loss) ? row.all_in_max_loss.toFixed(2) : "?")} U
 · 跌50% ${esc(Number.isFinite(row.payoff_50) ? row.payoff_50.toFixed(1) : "?")}×</span>
</li>`).join("\n");
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>市场速览 · ${esc(stamp)}</title>
<style>
html{background:#fff;color:#000}
body{font:20px/1.5 serif;max-width:640px;margin:0 auto;padding:12px}
h1{font-size:25px;line-height:1.25;margin:0 0 2px}
h2{font-size:21px;margin:16px 0 7px}
p{margin:5px 0}
time{display:block;font-size:15px;margin:0 0 12px}
.btc{font-size:24px;line-height:1.35;margin:3px 0}
.metric{font-size:18px}
.state{font-size:16px}
ol{padding:0;margin:0;list-style:none}
li{padding:11px 0;border-top:1px solid #888;page-break-inside:avoid}
li strong,li span{display:block}
li strong{font-size:19px}
li span{font-size:17px;margin-top:3px}
</style></head><body>
<h1>市场速览</h1>
<time>${esc(stamp)} · 台北</time>
<p class="btc">BTC <strong>${price(metrics?.btc_price_usdt)}</strong> <span>${esc(change)}</span></p>
<p class="metric">EMA200 ${price(metrics?.ema200)}　MA120 ${price(metrics?.ma120)}</p>
<h2>尾部 Put</h2>
<p class="state">${esc(status)} · ${esc(edge)}</p>
${healthy ? (list ? `<ol>${list}</ol>` : "<p>暂无候选</p>") : "<p>行情或证据暂不可用</p>"}
</body></html>\n`;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const data = JSON.parse(await readFile("tail-convexity.json", "utf8"));
  const metrics = await readFile("btc-metrics.json", "utf8").then(JSON.parse).catch(() => null);
  await writeFile("kindle.html", makeKindlePage(data, metrics), "utf8");
  console.log("Kindle compact page refreshed");
}

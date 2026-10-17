import { readFile, writeFile } from "node:fs/promises";

const esc = (text) => String(text ?? "").replace(/[&<>"']/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export function makeKindlePage(snapshot) {
  const stamp = Number.isFinite(snapshot?.generated_at_ms)
    ? new Date(snapshot.generated_at_ms + 8 * 3600_000).toISOString().replace("T", " ").slice(0, 16)
    : "未知";
  const healthy = snapshot?.schema === "tail-convexity-v1" && Array.isArray(snapshot.board)
    && !["BLOCKED_DATA", "BLOCKED_EVIDENCE"].includes(snapshot.state)
    && snapshot?.radar?.evidence_state !== "BLOCKED_EVIDENCE";
  const rows = healthy ? snapshot.board.slice(0, 3) : [];
  const main = rows.map((row, i) => `<section>
<h2>${i + 1}. ${esc(row.symbol)}</h2>
<p>剩余 ${esc(Number.isFinite(row.dte) ? Math.ceil(row.dte) : "?")} 天；
最小成本 ${esc(Number.isFinite(row.all_in_max_loss) ? row.all_in_max_loss.toFixed(2) : "?")} U</p>
<p>跌 50% 到期兑现估值：
<strong>${esc(Number.isFinite(row.payoff_50) ? row.payoff_50.toFixed(1) : "?")}x</strong></p>
<p>状态：${row.opportunity_tier === "RELATIVE_DISCOUNT_REVIEW" ? "相对折价待核验" : "研究观察"}</p>
</section>`).join("\n");
  const status = healthy ? (snapshot.tail_state || "UNKNOWN") : "BLOCKED_DATA";
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>期权日报 · Kindle</title>
<style>
html{background:#fff;color:#000}
body{font:18px/1.5 serif;max-width:640px;margin:0 auto;padding:15px}
h1{font-size:25px;margin:0 0 10px}
h2{font-size:21px;margin:0 0 5px}
p{margin:6px 0}
section{border-top:1px solid #555;margin:15px 0;padding-top:10px}
small{display:block;font-size:15px;margin:10px 0}
a{color:#000;text-decoration:underline}
</style></head><body>
<h1>尾部 Put 研究简报</h1>
<p>最新云端扫描：${esc(stamp)}（台北时间）</p>
<p>系统状态：<strong>${esc(status)}</strong></p>
${healthy ? (main || "<p>本轮没有合格期权。</p>") : "<p>数据异常或风险证据缺失，禁止依赖旧排名。</p>"}
<small>只读研究，无交易信号。内在价值倍数假设到期时暴跌 50%，不代表实际卖价。</small>
<small>这是静态页面。Kindle 睡眠时不会自动通知；重新打开或刷新才能看到更新。</small>
<p><a href="https://fengxiong111.github.io/btc-local-terminal-site/">桌面/手机版行情</a></p>
</body></html>\n`;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const data = JSON.parse(await readFile("tail-convexity.json", "utf8"));
  await writeFile("kindle.html", makeKindlePage(data), "utf8");
  console.log("Kindle static page refreshed");
}

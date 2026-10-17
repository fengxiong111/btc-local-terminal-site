import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { assessNotifications, acknowledgeNotification, initialNotificationState } from "../tail-alert-lib.js";
import { makeKindlePage } from "./build-kindle-tail.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const t0 = Date.parse("2026-10-17T10:00:00Z");
const mk = (time, opts = {}) => ({
  schema: "tail-convexity-v1",
  strategy_version: "TAIL_CONVEXITY_V2_RESEARCH",
  generated_at_ms: time,
  state: opts.state ?? "NO_EDGE",
  tail_state: opts.risk ?? "NORMAL",
  opportunity_state: "NO_RELATIVE_DISCOUNT",
  radar: { evidence_state: opts.evidence_state ?? "VERIFIED_COVERAGE",
    independent_protocol_coverage: 3, mechanism_families: opts.mechanism_families || [], stress_families: opts.stress_families || [] },
  board: opts.board ?? []
});
const qualified = (symbol = "BTC-261225-60000-P", gap = 0.03) => ({
  symbol, opportunity_tier: "RELATIVE_DISCOUNT_REVIEW",
  quality: { state: "DEPTH_CHECKED" },
  mispricing_vol_points: gap,
  dte: 60, all_in_max_loss: 3, payoff_50: 40
});

test("first scan baselines risk and needs a second distinct qualified scan", () => {
  const first = assessNotifications(mk(t0, { board: [qualified()], risk: "WATCH",
    mechanism_families: ["morpho"], stress_families: ["morpho"] }), initialNotificationState(), { now: t0 + 1000 });
  assert.equal(first.outbox.length, 0);
  assert.equal(first.state.seen["BTC-261225-60000-P"].scans, 1);
  const second = assessNotifications(mk(t0 + 30 * 60000, { board: [qualified()], risk: "WATCH",
    mechanism_families: ["morpho"], stress_families: ["morpho"] }),
  first.state, { now: t0 + 30 * 60000 + 1000 });
  assert.deepEqual(second.outbox.map(x => x.kind), ["opportunity"]);
  const ack = acknowledgeNotification(second.state, second.outbox[0], t0 + 30 * 60000 + 1000);
  const third = assessNotifications(mk(t0 + 60 * 60000, { board: [qualified()], risk: "WATCH",
    mechanism_families: ["morpho"], stress_families: ["morpho"] }), ack, { now: t0 + 60 * 60000 + 1000 });
  assert.equal(third.outbox.length, 0);
  const improved = assessNotifications(mk(t0 + 90 * 60000, { board: [qualified(undefined, 0.06)] }),
  third.state, { now: t0 + 90 * 60000 + 1000 });
  assert.equal(improved.outbox[0]?.kind, "improved");
});

test("missing, stale or research-only scan must never advertise fresh opportunities", () => {
  const initial = initialNotificationState();
  const bad = [
    mk(t0 - 120 * 60000, { board: [qualified()] }),
    mk(t0, { board: [qualified()], state: "BLOCKED_DATA" }),
    mk(t0, { board: [qualified()], evidence_state: "BLOCKED_EVIDENCE" }),
    mk(t0, { board: [{ ...qualified(), opportunity_tier: "RESEARCH_ONLY" }] }),
    mk(t0, { board: [{ ...qualified(), quality: { state: "RESEARCH_ONLY" } }] })
  ];
  for (const snap of bad) {
    const r = assessNotifications(snap, initial, { now: t0 });
    assert.equal(r.outbox.length, 0);
  }
});

test("new independent crisis evidence alerts only on source changes", () => {
  const watch = mk(t0, { risk: "WATCH", mechanism_families: ["morpho"], stress_families: ["morpho"] });
  const base = assessNotifications(watch, initialNotificationState(), { now: t0 + 1000 });
  const moreMorpho = assessNotifications(mk(t0 + 30 * 60000, { risk: "WATCH", mechanism_families: ["morpho"],
    stress_families: ["morpho"] }), base.state, { now: t0 + 30 * 60000 + 1000 });
  assert.equal(moreMorpho.outbox.length, 0);
  const critical = assessNotifications(mk(t0 + 60 * 60000, { risk: "CRITICAL",
    mechanism_families: ["morpho", "aave"], stress_families: ["morpho", "aave"] }),
  moreMorpho.state, { now: t0 + 60 * 60000 + 1000 });
  assert.equal(critical.outbox[0]?.kind, "critical");
  const ack = acknowledgeNotification(critical.state, critical.outbox[0], t0 + 60 * 60000 + 1000);
  const stable = assessNotifications(mk(t0 + 90 * 60000, { risk: "CRITICAL",
    mechanism_families: ["morpho", "aave"], stress_families: ["morpho", "aave"] }),
  ack, { now: t0 + 90 * 60000 + 1000 });
  assert.equal(stable.outbox.length, 0);
});

test("ongoing WATCH only alerts when a new independent family appears", () => {
  const base = assessNotifications(mk(t0, { risk: "WATCH", mechanism_families: ["morpho"],
    stress_families: ["morpho"] }), initialNotificationState(), { now: t0 + 1000 });
  const next = assessNotifications(mk(t0 + 30 * 60000, { risk: "WATCH",
    mechanism_families: ["morpho"], stress_families: ["morpho", "pendle"] }),
  base.state, { now: t0 + 30 * 60000 + 1000 });
  assert.equal(next.outbox[0]?.kind, "watch");
});

test("health alert only after two hours without a fresh successful scan", () => {
  const initial = assessNotifications(mk(t0), initialNotificationState(), { now: t0 + 1000 });
  const fail = assessNotifications(mk(t0 + 30 * 60000, { state: "BLOCKED_DATA" }),
    initial.state, { now: t0 + 30 * 60000 + 1000 });
  assert.equal(fail.outbox.length, 0);
  const old = assessNotifications(mk(t0 + 60 * 60000, { state: "BLOCKED_DATA" }),
    fail.state, { now: t0 + 121 * 60000 });
  assert.equal(old.outbox[0]?.kind, "health");
  const ack = acknowledgeNotification(old.state, old.outbox[0], t0 + 121 * 60000);
  const repeat = assessNotifications(mk(t0 + 90 * 60000, { state: "BLOCKED_DATA" }),
    ack, { now: t0 + 150 * 60000 });
  assert.equal(repeat.outbox.length, 0);
});

test("daily report sends once at exactly the Taipei evening hour", () => {
  const at20 = Date.parse("2026-10-17T12:00:00Z");
  const snap = mk(at20, { board: [qualified()] });
  const before = assessNotifications(snap, initialNotificationState(), { mode: "digest", now: at20 - 60 * 60000 });
  assert.equal(before.outbox.length, 0);
  const result = assessNotifications(snap, initialNotificationState(), { mode: "digest", now: at20 + 30000 });
  assert.equal(result.outbox[0]?.kind, "digest");
  const acknowledged = acknowledgeNotification(result.state, result.outbox[0], at20 + 30000);
  assert.equal(assessNotifications(snap, acknowledged, { mode: "digest", now: at20 + 60000 }).outbox.length, 0);
});

test("Kindle output is no-JavaScript grayscale HTML with escaped public data", () => {
  const html = makeKindlePage(mk(t0, { board: [
    { ...qualified("BTC-261225-60000-P"), opportunity_tier: "RESEARCH_ONLY" },
    { ...qualified("ETH-261225-1700-P") },
    { ...qualified("<script>alert(1)</script>") }
  ] }));
  assert.match(html, /charset="utf-8"/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /border-top:1px solid #888/);
  assert.match(html, /<time>10月17日 18:00<\/time>/);
  assert.doesNotMatch(html, /市场速览|尾部 Put|WATCH|无新错价|跌50%/);\n  assert.match(html, / · 40\\.0×<\\/span>/);
  assert.ok(!html.includes("<a "), "no footer hyperlinks");
  assert.ok(!html.includes("https://"), "no external URLs");
  assert.doesNotMatch(html, /只读研究|交易信号|实际卖价|睡眠|自动通知|数据源说明/);
  assert.doesNotMatch(html, /风险提示|免责声明/);
  const unavailable = makeKindlePage(mk(t0, { state: "BLOCKED_EVIDENCE" }));
  assert.match(unavailable, /行情或证据暂不可用/);
});

test("Kindle view contains the three requested BTC indicators with explicit freshness guard", () => {
  const market = {
    schema: "btc-metrics-v1", status: "LIVE", observed_at_ms: Date.now(),
    btc_price_usdt: 81602, btc_change_24h_pct: -1.22, ema200: 75849, ma120: 77500
  };
  const html = makeKindlePage(mk(t0, { board: [qualified()] }), market);
  assert.match(html, /BTC <strong>81,602<\/strong>/);
  assert.match(html, /-1\.22%/);
  assert.match(html, /EMA200 75,849/);
  assert.match(html, /MA120 77,500/);
  const stale = makeKindlePage(mk(t0), { ...market, observed_at_ms: Date.now()-100*60000 });
  assert.match(stale, /EMA200 未知/);
  assert.match(stale, /MA120 未知/);
});

test("iPhone notification workflow is disabled and no timetable remains", () => {
  const wf=readFileSync(join(root,".github/workflows/tail-notify.yml"),"utf8");
  assert.ok(wf.includes("iPhone notifications disabled"));
  assert.ok(!wf.includes("schedule:"));
  assert.ok(!wf.includes("workflow_dispatch:"));
  assert.ok(wf.includes('if: ${{ false }}'));
});


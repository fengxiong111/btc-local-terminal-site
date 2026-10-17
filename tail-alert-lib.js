// Pure notification policy: never places orders, never reads account credentials.
export const NOTIFY_POLICY = Object.freeze({
  freshness_ms: 90 * 60_000,
  health_timeout_ms: 120 * 60_000,
  normal_repeat_suppression_ms: 6 * 60 * 60_000,
  relative_improvement_iv: 0.02
});

function number(x) { return typeof x === "number" && Number.isFinite(x) ? x : null; }
function todayTaipei(now) { return new Date(now + 8 * 3600_000).toISOString().slice(0, 10); }
function taipeiHour(now) { return new Date(now + 8 * 3600_000).getUTCHours(); }
const publicPage = "https://fengxiong111.github.io/btc-local-terminal-site/";

export function initialNotificationState() {
  return { schema: "tail-notify-state-v1", initialized: false,
    observed_snapshot_ms: 0, seen: {}, sent: {}, risk_signature: "",
    last_success_ms: null, failure_since_ms: null, health_incident: null, last_digest_date: null };
}

export function assessNotifications(snapshot, existing = {}, opts = {}) {
  const now = opts.now ?? Date.now();
  const mode = opts.mode ?? "watch";
  const state = { ...initialNotificationState(), ...existing,
    seen: { ...(existing.seen || {}) }, sent: { ...(existing.sent || {}) } };
  if (state.schema !== "tail-notify-state-v1") throw new Error("Unknown notification state schema");
  const age = now - (number(snapshot?.generated_at_ms) ?? 0);
  const valid = snapshot?.schema === "tail-convexity-v1"
    && Array.isArray(snapshot?.board)
    && snapshot?.strategy_version === "TAIL_CONVEXITY_V2_RESEARCH"
    && Number.isFinite(age) && age >= -120_000 && age <= NOTIFY_POLICY.freshness_ms;
  const blocked = !valid || ["BLOCKED_DATA", "BLOCKED_EVIDENCE"].includes(snapshot?.state)
    || snapshot?.radar?.evidence_state === "BLOCKED_EVIDENCE";
  const outbox = [];
  let status = "OBSERVED";

  if (!blocked) {
    state.last_success_ms = snapshot.generated_at_ms;
    state.failure_since_ms = null;
    state.health_incident = null;
  } else if (state.failure_since_ms === null) {
    state.failure_since_ms = now;
  }

  if (mode === "digest") {
    const date = todayTaipei(now);
    if (taipeiHour(now) !== 20) return { state, outbox, status: "OUTSIDE_DIGEST_WINDOW" };
    if (state.last_digest_date === date) return { state, outbox, status: "DUPLICATE_DIGEST" };
    const top = !blocked ? snapshot.board.slice(0, 3).map((row, i) =>
      `${i + 1}. ${row.symbol}: ${row.opportunity_tier === "RELATIVE_DISCOUNT_REVIEW" ? "相对折价待复核" : "研究观察"}`).join("\n") : "最近快照无效，请检查云端扫描。";
    outbox.push({
      kind: "digest", key: `digest:${date}`, priority: 3,
      title: "Tail options daily",
      message: `20:00 期权日报（只读）\n风险：${blocked ? "数据不可用" : snapshot.tail_state}\n${top}\n${publicPage}`
    });
    return { state, outbox, status: "DIGEST_READY" };
  }

  if (mode !== "watch") throw new Error("Unknown notification mode");
  // No signals from a stale or blocked snapshot, regardless of the old ranking.
  if (!blocked && snapshot.generated_at_ms !== state.observed_snapshot_ms) {
    const nextSeen = {};
    for (const row of snapshot.board) {
      if (row.opportunity_tier !== "RELATIVE_DISCOUNT_REVIEW"
        || row.quality?.state !== "DEPTH_CHECKED"
        || !(number(row.mispricing_vol_points) >= 0.01)) continue;
      const prev = state.seen[row.symbol];
      nextSeen[row.symbol] = {
        scans: prev && prev.last_snapshot_ms !== snapshot.generated_at_ms ? Math.min(prev.scans + 1, 100) : 1,
        last_snapshot_ms: snapshot.generated_at_ms,
        first_seen_ms: prev?.first_seen_ms ?? snapshot.generated_at_ms,
        last_announced_iv: prev?.last_announced_iv ?? null
      };
      const observation = nextSeen[row.symbol];
      if (observation.scans >= 2 && state.initialized) {
        const key = `opportunity:${row.symbol}`;
        if (!state.sent[key]) outbox.push({
          kind: "opportunity", key, symbol: row.symbol,
          iv_gap: row.mispricing_vol_points, priority: 4,
          title: "Tail put relative discount",
          message: `${row.symbol}：连续两轮出现相对 IV 折价与盘口条件，请人工核查。不是下单信号。\n${publicPage}`
        });
        else if (number(observation.last_announced_iv) !== null
          && row.mispricing_vol_points >= observation.last_announced_iv + NOTIFY_POLICY.relative_improvement_iv) {
          const bucket = Math.floor(row.mispricing_vol_points / NOTIFY_POLICY.relative_improvement_iv);
          const improvedKey = `improved:${row.symbol}:${bucket}`;
          if (!state.sent[improvedKey]) outbox.push({
            kind: "improved", key: improvedKey, symbol: row.symbol,
            iv_gap: row.mispricing_vol_points, priority: 4,
            title: "Tail put discount improved",
            message: `${row.symbol}：相对 IV 折价进一步改善，请复核盘口与持仓。不是下单信号。\n${publicPage}`
          });
        }
      }
    }
    state.seen = nextSeen;
    const family = Array.isArray(snapshot?.radar?.mechanism_families) ? snapshot.radar.mechanism_families : [];
    const stress = Array.isArray(snapshot?.radar?.stress_families) ? snapshot.radar.stress_families : [];
    const signature = [snapshot.tail_state, ...[...family].sort(), "|", ...[...stress].sort()].join("/");
    const changed = signature !== state.risk_signature;
    const coverage = number(snapshot?.radar?.independent_protocol_coverage) ?? 0;
    const risk = snapshot.tail_state;
    if (changed && coverage >= 2 && risk === "CRITICAL" && family.length >= 2) {
      const key = `critical:${signature}`;
      if (!state.sent[key]) outbox.push({
        kind: "critical", key, priority: 5, title: "Tail risk CRITICAL",
        message: `系统性风险：至少两类独立协议机制出现异常。只读警报，请立即核验。\n${publicPage}`
      });
    } else if (changed && state.initialized && coverage >= 2 && risk === "WATCH"
      && (family.length > 0 || stress.length > 1)
      && state.risk_signature !== "" && !state.risk_signature.startsWith("WATCH/")) {
      const key = `watch:${signature}`;
      if (!state.sent[key]) outbox.push({
        kind: "watch", key, priority: 4, title: "Tail risk WATCH",
        message: `链上风险由非 WATCH 升为 WATCH，出现新证据。仅供研究，需核验来源。\n${publicPage}`
      });
    }
    state.risk_signature = signature;
    state.observed_snapshot_ms = snapshot.generated_at_ms;
    state.initialized = true;
  }

  const lastSuccessful = number(state.last_success_ms);
  const unhealthyFor = lastSuccessful === null
    ? now - (state.failure_since_ms ?? now)
    : now - lastSuccessful;
  if ((blocked || unhealthyFor > NOTIFY_POLICY.health_timeout_ms)
    && unhealthyFor >= NOTIFY_POLICY.health_timeout_ms) {
    const key = `health:${state.last_success_ms ?? "never"}`;
    if (state.health_incident !== key && !state.sent[key]) outbox.push({
      kind: "health", key, priority: 4, title: "Tail scan unavailable",
      message: `期权数据超过 2 小时未成功更新或持续阻断。暂停使用旧排名。\n${publicPage}`
    });
  }

  // At most one push per run; strongest evidence wins. No noisy ranking-only pushes.
  outbox.sort((a, b) => b.priority - a.priority
    || ({ critical: 0, opportunity: 1, improved: 2, watch: 3, health: 4 }[a.kind] ?? 9)
       - ({ critical: 0, opportunity: 1, improved: 2, watch: 3, health: 4 }[b.kind] ?? 9));
  return { state, outbox: outbox.slice(0, 1), status };
}

// Called only after the HTTP provider confirms delivery; no false "sent" receipts.
export function acknowledgeNotification(state, notification, now = Date.now()) {
  const next = { ...state, sent: { ...state.sent } };
  next.sent[notification.key] = now;
  if (notification.kind === "digest") next.last_digest_date = todayTaipei(now);
  if (notification.kind === "health") next.health_incident = notification.key;
  if (notification.symbol && next.seen[notification.symbol]) {
    next.seen = { ...next.seen,
      [notification.symbol]: { ...next.seen[notification.symbol], last_announced_iv: notification.iv_gap }
    };
  }
  return next;
}

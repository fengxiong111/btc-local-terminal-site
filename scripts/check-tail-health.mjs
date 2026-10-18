import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function assessHealth(tail, metrics, now = Date.now()) {
  const tailAt = tail?.generated_at_ms;
  const btcAt = metrics?.observed_at_ms;
  const ta = typeof tailAt === 'number' && Number.isFinite(tailAt) ? now-tailAt : NaN;
  const ba = typeof btcAt === 'number' && Number.isFinite(btcAt) ? now-btcAt : NaN;
  const maxAge = 120*60_000;
  const skew = 5*60_000;
  const reason = !Number.isFinite(ta) || !tailAt ? 'INVALID_TAIL_TIMESTAMP'
    : ta < -120_000 ? 'CLOCK_INCONSISTENCY'
    : ta > maxAge ? 'STALE_TAIL_SNAPSHOT'
    : !Array.isArray(tail?.board) || tail?.schema !== 'tail-convexity-v1' ? 'INVALID_TAIL_SCHEMA'
    : ['BLOCKED_DATA','BLOCKED_EVIDENCE'].includes(tail?.state) ? tail.state
    : !Number.isFinite(ba) || !btcAt ? 'INVALID_BTC_TIMESTAMP'
    : ba < -120_000 ? 'CLOCK_INCONSISTENCY'
    : ba > maxAge ? 'STALE_BTC_METRICS'
    : metrics?.schema !== 'btc-metrics-v1' || metrics?.status !== 'LIVE' ? 'BLOCKED_BTC_METRICS'
    : Math.abs(tailAt-btcAt) > skew ? 'MISMATCHED_SCAN_EPOCH' : null;
  return {
    schema:'tail-health-v2',
    timestamp: new Date(now).toISOString(),
    snapshot_state: tail?.state || 'UNKNOWN',
    snapshot_age_minutes: Number.isFinite(ta) ? Number((ta/60000).toFixed(1)) : null,
    metrics_age_minutes: Number.isFinite(ba) ? Number((ba/60000).toFixed(1)) : null,
    result: reason ? 'BLOCKED' : 'PASS',
    failure_state: reason,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const load = path => { try {return JSON.parse(readFileSync(path, 'utf8'));} catch {return null;} };
  const tail = load(process.argv[2] || 'tail-convexity.json');
  const btc = load(process.argv[3] || 'btc-metrics.json');
  const result = assessHealth(tail, btc);
  console.log(JSON.stringify(result));
  if (result.result !== 'PASS') process.exitCode = 1;
}

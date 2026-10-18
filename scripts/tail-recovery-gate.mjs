// Read-only decision gate. Authentication and dispatch are owned by the workflow.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const STALE_MS = 70 * 60_000;
const RUN_COOLDOWN_MS = 45 * 60_000;

function timestamp(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

export function decideRecovery(tail, metrics, recentRuns, now = Date.now()) {
  const tailAt = timestamp(tail?.generated_at_ms);
  const metricsAt = timestamp(metrics?.observed_at_ms);
  const ageTail = tailAt === null ? null : now - tailAt;
  const ageMetrics = metricsAt === null ? null : now - metricsAt;
  if (tailAt !== null && ageTail < -120_000 || metricsAt !== null && ageMetrics < -120_000) {
    return { status: 'BLOCKED_CLOCK', recover: false, age_tail_minutes: null, age_metrics_minutes: null };
  }
  const stale = tail?.schema !== 'tail-convexity-v1' || !Array.isArray(tail.board)
    || ['BLOCKED_DATA', 'BLOCKED_EVIDENCE'].includes(tail?.state)
    || metrics?.schema !== 'btc-metrics-v1' || metrics?.status !== 'LIVE'
    || !tailAt || !metricsAt || ageTail >= STALE_MS || ageMetrics >= STALE_MS;
  const ages = {
    age_tail_minutes: ageTail === null ? null : Math.round(ageTail / 60000),
    age_metrics_minutes: ageMetrics === null ? null : Math.round(ageMetrics / 60000),
  };
  if (!stale) return { status: 'HEALTHY', recover: false, ...ages };
  if (!Array.isArray(recentRuns)) return { status: 'BLOCKED_RUN_HISTORY', recover: false, ...ages };
  const validRuns = recentRuns.map(x => ({
    at: Date.parse(x?.createdAt ?? ''), status: x?.status,
  })).filter(x => Number.isFinite(x.at));
  if (recentRuns.length > 0 && validRuns.length === 0) {
    return { status: 'BLOCKED_RUN_HISTORY', recover: false, ...ages };
  }
  const activeOrRecent = validRuns.some(x =>
    ['queued','in_progress','waiting','pending','requested'].includes(x.status)
    || (now - x.at >= -120_000 && now - x.at < RUN_COOLDOWN_MS));
  return { status: activeOrRecent ? 'WAIT_RECENT_SCAN' : 'DISPATCH_REQUIRED',
    recover: !activeOrRecent, ...ages };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [, , tailPath, metricsPath, runsPath] = process.argv;
    if (!tailPath || !metricsPath || !runsPath) throw new Error('THREE_INPUTS_REQUIRED');
    const tail = JSON.parse(readFileSync(tailPath, 'utf8'));
    const metrics = JSON.parse(readFileSync(metricsPath, 'utf8'));
    const runs = JSON.parse(readFileSync(runsPath, 'utf8'));
    const result = decideRecovery(tail, metrics, runs);
    console.error(JSON.stringify({ schema: 'tail-recovery-v1', ...result }));
    if (result.status.startsWith('BLOCKED_')) process.exitCode = 1;
    console.log('recover=' + (result.recover ? 'true' : 'false'));
  } catch (error) {
    console.error(JSON.stringify({ schema:'tail-recovery-v1', status:'BLOCKED_INPUT', reason: error.message }));
    process.exitCode = 1;
    console.log('recover=false');
  }
}

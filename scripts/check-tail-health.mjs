import { readFileSync } from "node:fs";

const path = process.argv[2] || "tail-convexity.json";
const snapshot = JSON.parse(readFileSync(path, "utf8"));
const now = Date.now();
const timestamp = Number(snapshot.generated_at_ms);
const ageMs = now - timestamp;
const maxAgeMs = 120 * 60 * 1000;
const reason = !Number.isFinite(timestamp) || timestamp <= 0
  ? "NO_VALID_TIMESTAMP"
  : ageMs < -120000
    ? "CLOCK_INCONSISTENCY"
    : ageMs > maxAgeMs
      ? "STALE_SNAPSHOT"
      : !Array.isArray(snapshot.board) || snapshot.schema !== "tail-convexity-v1"
        ? "INVALID_SCHEMA"
        : ["BLOCKED_DATA", "BLOCKED_EVIDENCE"].includes(snapshot.state)
          ? snapshot.state
          : null;
const receipt = {
  schema: "tail-health-v1",
  source: path,
  timestamp: new Date(now).toISOString(),
  snapshot_state: snapshot.state || "UNKNOWN",
  snapshot_age_minutes: Number.isFinite(ageMs) ? Number((ageMs / 60000).toFixed(1)) : null,
  result: reason ? "BLOCKED" : "PASS",
  failure_state: reason
};
console.log(JSON.stringify(receipt));
if (reason) process.exitCode = 1;

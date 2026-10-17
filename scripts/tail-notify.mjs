import { readFile, writeFile } from "node:fs/promises";
import { assessNotifications, acknowledgeNotification, initialNotificationState } from "../tail-alert-lib.js";

const mode = process.argv[2] || "watch";
const snapshot = JSON.parse(await readFile("tail-convexity.json", "utf8"));
let state;
try {
  state = JSON.parse(await readFile("tail-notify-state.json", "utf8"));
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
  state = initialNotificationState();
}
const now = Date.now();
const planned = assessNotifications(snapshot, state, { mode, now });
const topic = process.env.NTFY_TOPIC || "";
const configured = /^[a-zA-Z0-9_-]{24,120}$/.test(topic);
let nextState = planned.state;
const receipt = { mode, timestamp: new Date(now).toISOString(), status: planned.status,
  push_state: configured ? "READY" : "NOT_CONFIGURED", event: planned.outbox[0]?.kind || "NONE" };

if (planned.outbox.length && configured) {
  const entry = planned.outbox[0];
  if (process.env.NOTIFY_DRY_RUN === "true") {
    receipt.push_state = "DRY_RUN";
  } else {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      // ntfy.sh topics are NOT access-controlled by default. Only public market research
      // is sent; never balances, keys, private holdings or recipient identifiers.
      const response = await fetch(`https://ntfy.sh/${encodeURIComponent(topic)}`, {
        method: "POST",
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Title": entry.title,
          "Priority": String(entry.priority),
          "Click": "https://fengxiong111.github.io/btc-local-terminal-site/",
          "Cache": "no"
        },
        body: entry.message,
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`NTFY_HTTP_${response.status}`);
      nextState = acknowledgeNotification(nextState, entry, now);
      receipt.push_state = "ACCEPTED_BY_PROVIDER"; // Not proof of iOS delivery.
      receipt.event = entry.kind;
    } finally {
      clearTimeout(timer);
    }
  }
} else if (!configured) {
  receipt.note = "Set GitHub Actions secret NTFY_TOPIC and subscribe using the iPhone ntfy app.";
}
await writeFile("tail-notify-state.json", JSON.stringify(nextState, null, 2) + "\n", "utf8");
console.log(JSON.stringify(receipt));

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { blockedSnapshot, composeSnapshot } from "../tail-convexity-lib.js";
import { scanTailConvexity } from "../tail-convexity-load.js";

const root = process.cwd();
const outputPath = join(root, "tail-convexity.json");
const ledgerPath = join(root, "tail-ledger.json");

async function readLedger() {
  try {
    return JSON.parse(await readFile(ledgerPath, "utf8"));
  } catch {
    return { annual_budget_usdt: 300, spent_usdt: 0, reauthorized: false, positions: [] };
  }
}

async function venueReachable() {
  try {
    const response = await fetch("https://eapi.binance.com/eapi/v1/ping", { signal: AbortSignal.timeout(8000) });
    return response.ok;
  } catch {
    return false;
  }
}

async function main() {
  const ledger = await readLedger();
  try {
    const scan = await scanTailConvexity();
    const snapshot = composeSnapshot(scan, {
      ledger,
      credentialsPresent: Boolean(process.env.BINANCE_API_KEY && process.env.BINANCE_API_SECRET),
      venueReachable: await venueReachable()
    });
    await writeFile(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`);
    console.log(`${snapshot.state} qualified=${snapshot.funnel.qualified} edge=${snapshot.funnel.edge} top=${snapshot.board[0]?.symbol ?? "none"}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "期权链读取失败";
    await writeFile(outputPath, `${JSON.stringify(blockedSnapshot(message, ledger), null, 2)}\n`);
    console.error(message);
    process.exitCode = 1;
  }
}

await main();

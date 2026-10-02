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

async function readPrevious() {
  try {
    const previous = JSON.parse(await readFile(outputPath, "utf8"));
    return {
      symbols: Array.isArray(previous.board) ? previous.board.map((item) => item.symbol) : [],
      fingerprint: previous.fingerprint || ""
    };
  } catch {
    return { symbols: [], fingerprint: "" };
  }
}

async function main() {
  const ledger = await readLedger();
  const previous = await readPrevious();
  try {
    const scan = await scanTailConvexity();
    const snapshot = composeSnapshot(scan, {
      ledger,
      previousSymbols: previous.symbols,
      previousFingerprint: previous.fingerprint
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

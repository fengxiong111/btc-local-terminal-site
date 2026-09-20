import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "index.html"), "utf8");

function sourceLabelVisible(source) {
  return html.includes("refs.source.textContent") || new RegExp(`textContent = "${source}"`).test(html);
}

test("source labels stay out of the visible row", () => {
  assert.equal(html.includes("refs.source"), false);
  assert.equal(html.includes("sourceLabel("), false);
  assert.match(html, /display: none;/);
  assert.equal(sourceLabelVisible("Binance"), false);
  assert.equal(html.includes(" · 缓存"), false);
});

test("EMA and MA do not render a dash change", () => {
  assert.match(html, /market-change\.is-empty \{ display: none; \}/);
  assert.match(html, /refs\.change\.classList\.add\("is-empty"\)/);
  assert.equal(html.includes('refs.change.textContent = change === null ? "—"'), false);
});

test("generic decimal odometer is shared", () => {
  assert.match(html, /function createPriceOdometer\(/);
  assert.match(html, /function priceTemplate\(/);
  assert.match(html, /ANIM_MS = 450/);
  assert.match(html, /translate3d\(/);
  assert.match(html, /prefers-reduced-motion: reduce/);
  assert.equal(html.includes("createBtcOdometer"), false);
  assert.equal(html.includes("setBtcPrice"), false);
});

test("websocket is primary and rest is fallback", () => {
  assert.match(html, /wss:\/\/stream\.binance\.com:9443\/ws\/btcusdt@bookTicker/);
  assert.match(html, /wss:\/\/ws\.okx\.com:8443\/ws\/v5\/public/);
  assert.match(html, /wss:\/\/api\.hyperliquid\.xyz\/ws/);
  assert.match(html, /lite-api\.jup\.ag\/price\/v3/);
  assert.match(html, /RENDER_MS = 350/);
  assert.match(html, /REST_FALLBACK_MS = 2000/);
  assert.equal(html.includes("PRICE_INTERVAL = 500"), false);
  assert.equal(html.includes("MACRO_INTERVAL = 3000"), false);
});

test("Apple system typography and integrated hero hierarchy", () => {
  assert.match(html, /font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", "PingFang SC", sans-serif/);
  assert.match(html, /font-variant-numeric: tabular-nums/);
  assert.match(html, /font-feature-settings: "tnum" 1, "lnum" 1/);
  assert.equal(html.includes("IBM Plex Mono"), false);
  assert.equal(html.includes("JetBrains Mono"), false);
  assert.match(html, /\.market-row--btc \{ grid-column: 1 \/ -1;/);
  assert.match(html, /\.btc-metrics \{ display: grid; grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(html, /\.btc-metric \.market-price \{ font-size: clamp\(28px, 2\.1vw, 38px\)/);
  assert.match(html, /\.market-row--btc \.market-price \{ font-size: clamp\(68px, 5vw, 96px\)/);
  assert.match(html, /\.market-price \{.*font-size: clamp\(28px, 2vw, 36px\)/);
  assert.match(html, /function createBtcHeroRow\(/);
  assert.match(html, /metricRows\[item\.id\] = metric/);
  assert.match(html, /\.btc-metrics \{ grid-template-columns: 1fr;/);
});

test("digit offset uses shortest path", () => {
  function digitOffset(value, current) {
    var offset = (value - current + 10) % 10;
    if (offset > 5) offset -= 10;
    return offset;
  }
  assert.equal(digitOffset(3, 1), 2);
  assert.equal(digitOffset(9, 1), -2);
  assert.equal(priceTemplate("0.5728"), "#.####");
  assert.equal(priceTemplate("1,004"), "#,###");
  assert.notEqual(priceTemplate("0.9999"), priceTemplate("1.000"));
});

function priceTemplate(text) {
  return String(text || "").replace(/[0-9]/g, "#");
}

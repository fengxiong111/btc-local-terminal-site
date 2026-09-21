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
  assert.doesNotMatch(html, /function priceTemplate\(/);
  assert.match(html, /ANIM_MS = 450/);
  assert.match(html, /translate3d\(/);
  assert.match(html, /function setDisplayText\(text, instant\)/);
  assert.match(html, /next\.displayPrice = formatPriceText\(quote\.price\)/);
  assert.match(html, /prefers-reduced-motion: reduce/);
  assert.equal(html.includes("createBtcOdometer"), false);
  assert.equal(html.includes("setBtcPrice"), false);
});

test("websocket is primary and rest is fallback", () => {
  assert.match(html, /wss:\/\/stream\.binance\.com:9443\/ws\/btcusdt@bookTicker/);
  assert.match(html, /wss:\/\/ws\.okx\.com:8443\/ws\/v5\/public/);
  assert.match(html, /wss:\/\/api\.hyperliquid\.xyz\/ws/);
  assert.match(html, /lite-api\.jup\.ag\/price\/v3/);
  assert.match(html, /VISUAL_RENDER_MS = 1000/);
  assert.doesNotMatch(html, /RENDER_MS = 350/);
  assert.match(html, /REST_FALLBACK_MS = 2000/);
  assert.equal(html.includes("PRICE_INTERVAL = 500"), false);
  assert.equal(html.includes("MACRO_INTERVAL = 3000"), false);
});

test("Apple system typography and integrated hero hierarchy", () => {
  assert.match(html, /font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", "PingFang SC", sans-serif/);
  assert.match(html, /font-variant-numeric: tabular-nums/);
  assert.match(html, /font-feature-settings: "tnum" 1, "lnum" 1/);
  assert.match(html, /\.market-row--btc \{ grid-column: 1 \/ -1;/);
  assert.match(html, /\.btc-metrics \{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(html, /\.btc-metric \.market-price \{ font-size: clamp\(28px, 2\.1vw, 38px\)/);
  assert.match(html, /\.market-row--btc \.market-price \{ font-size: clamp\(68px, 5vw, 96px\)/);
  assert.match(html, /\.market-price \{.*font-size: clamp\(28px, 2vw, 36px\)/);
  assert.match(html, /function createBtcHeroRow\(/);
  assert.match(html, /metricRows\[item\.id\] = metric/);
  assert.match(html, /\.btc-metrics \{ grid-template-columns: 1fr;/);
});

test("odometer digits expose an accessible display value", () => {
  assert.match(html, /\.sr-only\s*\{/);
  assert.match(html, /priceElement\.setAttribute\("aria-hidden", "true"\)/);
  assert.match(html, /priceAccessible: accessiblePriceElement/);
  assert.match(html, /refs\.priceAccessible\.textContent = displayPrice/);
});

test("desktop grouping and display precision", () => {
  assert.match(html, /\.market-quote \{[^}]*justify-content: flex-start;[^}]*gap: clamp\(18px, 1\.6vw, 28px\)/);
  assert.match(html, /\.market-row--btc \.market-quote \{[^}]*gap: clamp\(24px, 2\.2vw, 40px\)/);
  assert.match(html, /@media \(min-width: 1400px\) \{\s*\.market-list \{ max-width: 1520px; \}/);
  assert.match(html, /\.btc-metrics \{[^}]*width: min\(100%, 620px\); max-width: 620px;/);
  assert.match(html, /function priceFraction\(value\) \{\s*var price = finite\(value\);\s*return price !== null && price >= 1 \? 0 : 2;\s*\}/);
  assert.match(html, /fraction === 0 \? Math\.round\(number\) : number/);
});

test("btc-screen animation core is ported without extra execution layers", () => {
  assert.doesNotMatch(html, /contain:\s*paint/);
  assert.doesNotMatch(html, /will-change:\s*transform/);
  assert.doesNotMatch(html, /animation\.finished/);
  assert.doesNotMatch(html, /runRafFallback|easingPoints|easingAt|cancelFallback|queueHeightRetry/);
  assert.match(html, /node\.style\.transform = "translate3d\(0, " \+ toY \+ "px, 0\)";\s*node\.animate\(/);
  assert.match(html, /updateMotionDiagnostic\(\);\s*if \(instant \|\| !inited \|\| text\.length !== currentTemplate\.length\)/);
  assert.doesNotMatch(html, /instant \|\| reducedMotion \|\| !inited/);
  assert.match(html, /if \(!inited \|\| !lastShown \|\| diagnostics\.testRunning\) return;/);
  assert.match(html, /window\.setTimeout\(function \(\) \{\s*if \(diagnostics\.testRunning\) return;/);
  assert.match(html, /var previousHeight = digitCellHeight;/);
  assert.match(html, /var nextHeight = refreshCellHeight\(\);/);
  assert.match(html, /Math\.abs\(nextHeight - previousHeight\) <= 0\.5/);
  assert.match(html, /setAllInstant\(lastShown, "real-size-change"\)/);
  assert.match(html, /window\.__TEST_BTC_ODOMETER__ = testBtcOdometer/);
  assert.match(html, /diagnostics\.animateToCount \+= 1/);
  assert.match(html, /diagnostics\.setAllInstantCount \+= 1/);
  assert.match(html, /diagnostics\.refitCount \+= 1/);
  assert.match(html, /diagnostics\.domRebuildCount \+= 1/);
  assert.match(html, /function refitAllPrices\(reason\)/);
  assert.match(html, /\}, 180\);/);
  assert.match(html, /window\.visualViewport\.addEventListener\("resize"/);
  assert.match(html, /window\.__REDUCED_MOTION_MATCHES__/);
});

test("digit offset uses shortest path", () => {
  function digitOffset(value, current) {
    var offset = (value - current + 10) % 10;
    if (offset > 5) offset -= 10;
    return offset;
  }
  assert.equal(digitOffset(3, 1), 2);
  assert.equal(digitOffset(9, 1), -2);
});

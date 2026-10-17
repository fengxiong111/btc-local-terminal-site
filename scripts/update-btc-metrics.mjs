import { readFile, writeFile } from "node:fs/promises";

const output = "btc-metrics.json";
const source = "Binance Spot BTCUSDT (1d UTC candle)";
const asNum = (x) => { const v=Number(x); return Number.isFinite(v) && v>0 ? v : null; };
const getJson = async (url) => {
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 12000);
  try {
    const r = await fetch(url, {signal:ctrl.signal,headers:{"Accept":"application/json"}});
    if(!r.ok) throw new Error("BINANCE_HTTP_"+r.status);
    return await r.json();
  } finally {clearTimeout(timeout);}
};
let result={
  schema:"btc-metrics-v1",status:"BLOCKED_DATA",observed_at_ms:Date.now(),
  source,btc_price_usdt:null,btc_change_24h_pct:null,ema200:null,ma120:null,
  last_kline_open_ms:null,error:"NO_DATA"
};
try {
  const [price,change,candles]=await Promise.all([
    getJson("https://data-api.binance.vision/api/v3/ticker/price?symbol=BTCUSDT"),
    getJson("https://data-api.binance.vision/api/v3/ticker/24hr?symbol=BTCUSDT"),
    getJson("https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=1d&limit=365")
  ]);
  if (!Array.isArray(candles) || candles.length<200) throw new Error("INSUFFICIENT_CANDLES");
  const closes=candles.map(row=>asNum(row?.[4]));
  if(closes.some(x=>x===null)) throw new Error("INVALID_CANDLE");
  const btc=asNum(price.price);
  const changePct=Number(change.priceChangePercent);
  if(btc===null || !Number.isFinite(changePct)) throw new Error("INVALID_TICKER");
  let ema=closes.slice(0,200).reduce((a,b)=>a+b,0)/200;
  for(const close of closes.slice(200)) ema+=(close-ema)*(2/201);
  const ma=closes.slice(-120).reduce((a,b)=>a+b,0)/120;
  result={...result,status:"LIVE",observed_at_ms:Date.now(),
    btc_price_usdt:btc,btc_change_24h_pct:changePct,ema200:ema,ma120:ma,
    last_kline_open_ms:Number(candles.at(-1)[0]),error:null};
} catch(e) {
  result.error=(e instanceof Error?e.message:"UNKNOWN_METRICS_FAILURE").slice(0,160);
}
await writeFile(output,JSON.stringify(result,null,2)+"\n","utf8");
console.log(JSON.stringify({status:result.status,btc:result.btc_price_usdt,ema200:result.ema200,ma120:result.ma120,error:result.error}));

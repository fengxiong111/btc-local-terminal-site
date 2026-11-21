// PUBLIC GET only. Zero credentials, zero orders, zero account endpoints.
import {readFile,writeFile} from 'node:fs/promises';
import {buildPairs,validateDepth,chooseWinner,toSnapshot,annualizedRv} from '../best-option-core.mjs';
const now=()=>Date.now();
const base='https://eapi.binance.com/eapi/v1/';
async function get(url) {
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),12000);
  try {
    const r=await fetch(url,{headers:{'Accept':'application/json','User-Agent':'TCE-GitHub-Pages-ReadOnly/1'},signal:controller.signal});
    if(!r.ok) throw Error('HTTP '+r.status+' from '+new URL(url).host);
    return await r.json();
  } finally {clearTimeout(timer);}
}
async function oldWinner() {
  try{return JSON.parse(await readFile('best-option.json','utf8'));}catch{return null;}
}
async function run() {
  const previous=await oldWinner();
  try {
    const [info,marks,tickers,index,klines]=await Promise.all([
      get(base+'exchangeInfo'),get(base+'mark'),get(base+'ticker'),
      get(base+'index?underlying=BTCUSDT'),
      get('https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=1d&limit=32')
        .catch(()=>null)
    ]);
    const rv=[7,14,30].map(d=>annualizedRv(klines,d));
    const pairs=buildPairs({exchangeInfo:info,marks,tickers,index,nowMs:now(),rv});
    const qualified=[], depthCache=new Map();
    async function depth(sym) {
      if(!depthCache.has(sym)) depthCache.set(sym,await get(base+'depth?symbol='+encodeURIComponent(sym)+'&limit=10'));
      return depthCache.get(sym);
    }
    for (const pair of pairs.slice(0,12)) {
      try {
        const [c,p]=await Promise.all([depth(pair.call.symbol),depth(pair.put.symbol)]);
        const valid=validateDepth(pair,c,p,now());
        if(valid) qualified.push(valid);
      } catch(error) {
        if(String(error).includes('HTTP 429')||String(error).includes('HTTP 418')) throw error;
      }
    }
    const winner=chooseWinner(qualified,previous);
    const snapshot=toSnapshot(winner,now(),pairs.length,rv);
    snapshot.source='Binance official public /eapi/v1 exchangeInfo,index,mark,ticker,depth';
    snapshot.top_depth_verified=qualified.length;
    await writeFile('best-option.json',JSON.stringify(snapshot,null,2)+'\n');
    console.log(snapshot.state,winner?winner.call.symbol+' + '+winner.put.symbol:'CASH');
  } catch(error) {
    const snapshot={schema:'tce-best-option-v1',generated_at_ms:now(),
      expires_at_ms:now()+25*60*1000,decision:'CASH',
      mode:'READ_ONLY',tradable:false,auto_order:false,candidate:null,
      state:'BLOCKED_DATA',reason:String(error).slice(0,240)};
    await writeFile('best-option.json',JSON.stringify(snapshot,null,2)+'\n');
    console.error('FAIL-CLOSED:',snapshot.reason);
    process.exitCode=1;
  }
}
await run();

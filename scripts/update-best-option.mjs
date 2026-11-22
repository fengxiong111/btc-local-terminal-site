// Public BTC options: 3 venue scanner, no credentials or execution.
import {readFile,writeFile} from "node:fs/promises";
import {annualizedRv} from "../best-option-core.mjs";
import {shortlistStraddles,validateStraddle,chooseFive} from "../straddle-ladder-core.mjs";
import {normalizeBinance,normalizeBinanceBook,normalizeOKX,normalizeOKXBook,
  normalizeDeribit,normalizeDeribitBook,rankVenue,verifyVenuePair,
  chooseAcrossVenues,snapshotFromVenues} from "../best-option-venues.mjs";
const urls={BINANCE:"https://eapi.binance.com/eapi/v1/",
 OKX:"https://www.okx.com/api/v5/",DERIBIT:"https://www.deribit.com/api/v2/"};
async function get(url){
 const c=new AbortController(),timer=setTimeout(()=>c.abort(),10000);
 try{const r=await fetch(url,{signal:c.signal,headers:{Accept:"application/json"}});
  if(!r.ok)throw Error("HTTP "+r.status+" "+new URL(url).host);
  return await r.json();
 }finally{clearTimeout(timer)}
}
async function rvHistory(){
 try{
  const r=await get(urls.OKX+"market/history-candles?instId=BTC-USDT&bar=1D&limit=36");
  if(r.code!=="0"||!Array.isArray(r.data))return null;
  const bars=r.data.filter(x=>String(x[8])==="1").sort((a,b)=>Number(a[0])-Number(b[0]));
  const rv=[7,14,30].map(d=>annualizedRv(bars,d));
  return rv.every(x=>Number.isFinite(x)&&x>0)?rv:null;
 }catch{return null}
}
async function prepare(venue){
 const u=urls[venue];
 if(venue==="BINANCE"){
  const [exchangeInfo,marks,tickers,index]=await Promise.all([
   get(u+"exchangeInfo"),get(u+"mark"),get(u+"ticker"),get(u+"index?underlying=BTCUSDT")]);
  return normalizeBinance({exchangeInfo,marks,tickers,index});
 }
 if(venue==="OKX"){
  const [instruments,tickers,greeks,index]=await Promise.all([
   get(u+"public/instruments?instType=OPTION&instFamily=BTC-USD"),
   get(u+"market/tickers?instType=OPTION&instFamily=BTC-USD"),
   get(u+"public/opt-summary?instFamily=BTC-USD"),
   get(u+"market/index-tickers?instId=BTC-USD")]);
  return normalizeOKX({instruments,tickers,greeks,index},Date.now());
 }
 const [instruments,summaries]=await Promise.all([
  get(u+"public/get_instruments?currency=BTC&kind=option&expired=false"),
  get(u+"public/get_book_summary_by_currency?currency=BTC&kind=option")]);
 return normalizeDeribit({instruments,summaries},Date.now());
}
async function getBook(venue,symbol,spot){
 const url=urls[venue],name=encodeURIComponent(symbol);
 if(venue==="BINANCE")return normalizeBinanceBook(await get(url+"depth?symbol="+name+"&limit=10"));
 if(venue==="OKX")return normalizeOKXBook(await get(url+"market/books?instId="+name+"&sz=10"),spot);
 return normalizeDeribitBook(await get(url+"public/get_order_book?instrument_name="+name+"&depth=10"),spot);
}
async function probe(venue,rv){
 const adapter=await prepare(venue),pairs=rankVenue(adapter,rv,Date.now()),cache=new Map(),vetted=[],ladder=[];
 // Share the same cached L2 reader across candidate and straddle-ladder scans.
 const book=async sym=>{
   if(!cache.has(sym))cache.set(sym,getBook(venue,sym,adapter.spot));
   return cache.get(sym);
 };
 for(const pair of pairs.slice(0,6)){
  try{
   const [c,p]=await Promise.all([book(pair.call.symbol),book(pair.put.symbol)]);
   const good=verifyVenuePair(pair,c,p,Date.now());
   if(good)vetted.push(good);
  }catch(e){if(/HTTP (418|429)/.test(String(e)))throw e}
 }
 // Independently screen near-ATM long straddles at the five nearest expirations.
 // Keep the single-winner search untouched, and use the same cached L2 fetcher.
 const shortlist=shortlistStraddles(adapter,Date.now());
 const expirations=[...new Set(shortlist.map(x=>x.expiry_ms))].slice(0,6);
 const ladderDiag={near_atm_candidates:shortlist.length,near_atm_dates:expirations.length,
   attempted:0,failed:0,reasons:[],first:shortlist[0]?
     {symbols:[shortlist[0].call.symbol,shortlist[0].put.symbol],
      cost:shortlist[0].cost,expiry_ms:shortlist[0].expiry_ms}:null};
 const tried=new Map();
 for(const candidate of shortlist){
  if(!expirations.includes(candidate.expiry_ms))continue;
  if((tried.get(candidate.expiry_ms)||0)>=2 || ladder.some(x=>x.expiry_ms===candidate.expiry_ms))continue;
  tried.set(candidate.expiry_ms,(tried.get(candidate.expiry_ms)||0)+1);
  ladderDiag.attempted++;
  try{
   const [c,p]=await Promise.all([book(candidate.call.symbol),book(candidate.put.symbol)]);
   const verified=validateStraddle(candidate,c,p,Date.now());
   if(verified)ladder.push(verified);
  }catch(e){
   ladderDiag.failed++;if(ladderDiag.reasons.length<3)ladderDiag.reasons.push(String(e).slice(0,160));
   if(/HTTP (418|429)/.test(String(e)))throw e
  }
 }
 return {venue,universe:pairs.length,normalized:adapter.exchangeInfo?.optionSymbols?.length,
   diagnostics:adapter.diagnostics||null,vetted,ladder,ladderDiag};
}
async function main(){
 let prev=null;
 try{prev=JSON.parse(await readFile("best-option.json","utf8"))}catch{}
 const rv=await rvHistory(),names=["BINANCE","OKX","DERIBIT"];
 const result=await Promise.allSettled(names.map(name=>probe(name,rv)));
 const candidates=[],ladderRows=[],responded=[],errors=[],counts={},venueDiagnostics={};
 for(let i=0;i<result.length;i++){
  const x=result[i],venue=names[i];
  if(x.status==="fulfilled"){
   responded.push(venue);counts[venue]=x.value.universe;
   venueDiagnostics[venue]={normalized:x.value.normalized,detail:x.value.diagnostics,ladder:x.value.ladderDiag};
   candidates.push(...x.value.vetted);
   ladderRows.push(...x.value.ladder);
  }else errors.push(venue+": "+String(x.reason).slice(0,180));
 }
 const winner=chooseAcrossVenues(candidates,prev);
 const snapshot=snapshotFromVenues(winner,Date.now(),Object.values(counts).reduce((a,b)=>a+b,0),rv,
  {venues_checked:names,venues_responded:responded});
 snapshot.source="PUBLIC_MARKET_DATA_MULTI_VENUE";snapshot.autonomous=true;
 snapshot.venue_universe_counts=counts;snapshot.venue_diagnostics=venueDiagnostics;
 snapshot.validated_pairs=candidates.length;
 snapshot.scan_errors=errors;snapshot.order_sent=false;snapshot.signing=false;snapshot.capital_at_risk=0;
 snapshot.straddle_ladder={
   schema:"btc-atm-straddle-ladder-v1",
   generated_at_ms:snapshot.generated_at_ms,
   state:ladderRows.length?"SHADOW":"BLOCKED_DATA",
   rows:chooseFive(ladderRows),source:"REAL_PUBLIC_L2",decision:"CASH",
   note:"Expiry breakevens are approximate USD equivalents; BTC settled venues bear BTC conversion and exercise fee risk"
 };
 if(responded.length===0){
  snapshot.state="BLOCKED_DATA";snapshot.candidate=null;
  snapshot.reason="All 3 venue public market scans unavailable";
 }
 await writeFile("best-option.json",JSON.stringify(snapshot,null,2)+"\n");
 console.log(JSON.stringify({status:snapshot.state,venues:responded,winner:snapshot.candidate?.call_symbol,
  validated:candidates.length,errors}));
 if(responded.length===0)process.exitCode=1;
}
await main();

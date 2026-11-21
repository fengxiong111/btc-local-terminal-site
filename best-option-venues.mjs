// Public multi-venue options adapters. Research only. No credentials, trading or signing.
// All legs normalized to USD quote per 1 BTC exposure; lot is venue contract qty.
import {POLICY, buildPairs,validateDepth,chooseWinner,toSnapshot} from "./best-option-core.mjs";
const num=x=>Number(x), ok=x=>Number.isFinite(num(x))&&num(x)>0;
const t=(x)=>num(x?.ts??x?.T??x?.timestamp??x?.time);
const policyOKX={...POLICY,feeRate:0.0003,feeCap:0.07,maxBookLagMs:45000};
const policyDeribit={...POLICY,feeRate:0.0019,feeCap:0.25,maxBookLagMs:45000};
const policyBinance={...POLICY};

function okxData(x){
  if(x?.code!=="0"||!Array.isArray(x.data)) throw Error("OKX invalid public data: "+String(x?.code));
  return x.data;
}
export function normalizeOKX({instruments,tickers,greeks,index},nowMs){
  const inst=okxData(instruments), ticks=okxData(tickers), stats=okxData(greeks), indexRows=okxData(index);
  const spot=num(indexRows[0]?.idxPx),indexAt=t(indexRows[0]);
  if(!ok(spot)||!Number.isFinite(indexAt)||Math.abs(nowMs-indexAt)>60000) throw Error("OKX stale index");
  const quote=new Map(ticks.map(x=>[x.instId,x]));
  const greek=new Map(stats.map(x=>[x.instId,x]));
  const ei={optionSymbols:[]},marks=[],outTicks=[];
  const diag={raw_instruments:inst.length,raw_tickers:ticks.length,raw_greeks:stats.length,
    pairable:0,regex:0,live:0,btc_settlement:0,quotes:0,time_valid:0,
    first_instrument:inst[0]?{id:inst[0].instId,state:inst[0].state,settle:inst[0].settleCcy,
      family:inst[0].instFamily,minSz:inst[0].minSz,ctVal:inst[0].ctVal}:null};
  for(const i of inst){
    const m=/^BTC-USD-(\d{6})-(\d+)-([CP])$/.exec(i.instId||"");
    if(m)diag.regex++;
    if(m&&i.state==="live")diag.live++;
    if(m&&i.state==="live"&&i.settleCcy==="BTC")diag.btc_settlement++;
    if(!m||i.state!=="live"||i.instFamily!=="BTC-USD"||i.settleCcy!=="BTC") continue;
    const min=num(i.minSz),unit=num(i.ctVal),exp=num(i.expTime),strike=num(m[2]);
    const q=quote.get(i.instId),g=greek.get(i.instId);
    if(!ok(min)||!ok(unit)||!ok(exp)||!ok(strike)||!q||!g)continue;
    diag.quotes++;
    if(!Number.isFinite(t(q))||nowMs-t(q)>90000||!Number.isFinite(t(g))||nowMs-t(g)>120000)continue;
    diag.time_valid++;
    const ask=num(q.askPx),bid=num(q.bidPx),iv=num(g.markVol),delta=num(g.deltaBS);
    if(!ok(ask)||!ok(bid)||!ok(iv)||!Number.isFinite(delta)||bid>ask)continue;
    ei.optionSymbols.push({symbol:i.instId,underlying:"BTCUSDT",status:"TRADING",
      side:m[3]==="C"?"CALL":"PUT",strikePrice:strike,expiryDate:exp,minQty:min,unit});
    diag.pairable++;
    marks.push({symbol:i.instId,markIV:iv,delta});
    outTicks.push({symbol:i.instId,askPrice:ask*spot,bidPrice:bid*spot});
  }
  return {exchangeInfo:ei,marks,tickers:outTicks,index:{indexPrice:spot,time:indexAt},
    policy:policyOKX,venue:"OKX",currency:"BTC",spot,expiryCurrency:"BTC",diagnostics:diag};
}
export function normalizeOKXBook(payload,spot){
  const books=okxData(payload),b=books[0];
  if(!b||!Number.isFinite(num(b.ts)))return null;
  const convert=side=>Array.isArray(side)?side.map(x=>[num(x[0])*spot,num(x[1])]):[];
  return {T:num(b.ts),asks:convert(b.asks),bids:convert(b.bids)};
}
const normIv=(x)=> {const n=num(x);return n>3?n/100:n;};
const cdf=z=>{
  const x=Math.abs(z),t=1/(1+.2316419*x),p=.3989422804014327*Math.exp(-.5*x*x);
  const q=p*t*(.319381530+t*(-.356563782+t*(1.781477937+t*(-1.821255978+t*1.330274429))));
  return z>=0?1-q:q;
};
function bsDelta(spot,strike,dte,iv,isCall){
  if(!(spot>0&&strike>0&&dte>0&&iv>0))return null;
  const years=dte/365, d1=(Math.log(spot/strike)+.5*iv*iv*years)/(iv*Math.sqrt(years));
  const callDelta=cdf(d1);return isCall?callDelta:callDelta-1;
}
function dr(x){
  if(x?.jsonrpc!=="2.0"||!Array.isArray(x.result))throw Error("Deribit invalid response");
  return x.result;
}
export function normalizeDeribit({instruments,summaries},nowMs){
  const items=dr(instruments),quotes=dr(summaries);
  const quoted=new Map(quotes.map(x=>[x.instrument_name,x]));
  const samples=quotes.map(x=>num(x.underlying_price||x.index_price)).filter(ok);
  const spot=samples.length?samples[Math.floor(samples.length/2)]:NaN;
  if(!ok(spot))throw Error("Deribit missing live BTC index");
  const info={optionSymbols:[]},marks=[],tickers=[];
  for(const i of items){
    if(i.kind!=="option"||i.base_currency!=="BTC"||i.is_active===false||
       i.settlement_currency!=="BTC")continue;
    const q=quoted.get(i.instrument_name),strike=num(i.strike),
          exp=num(i.expiration_timestamp),lot=num(i.min_trade_amount),unit=num(i.contract_size),
          iv=normIv(q?.mark_iv),ask=num(q?.best_ask_price),bid=num(q?.best_bid_price);
    if(!ok(strike)||!ok(exp)||!ok(lot)||!ok(unit)||!ok(iv)||!ok(ask)||!ok(bid)||bid>ask)continue;
    const dte=(exp-nowMs)/86400000,kind=i.option_type==="call"?"CALL":i.option_type==="put"?"PUT":null;
    const delta=kind===null?null:bsDelta(spot,strike,dte,iv,kind==="CALL");
    if(!Number.isFinite(delta))continue;
    info.optionSymbols.push({symbol:i.instrument_name,underlying:"BTCUSDT",status:"TRADING",side:kind,
      strikePrice:strike,expiryDate:exp,minQty:lot,unit});
    marks.push({symbol:i.instrument_name,delta,markIV:iv});
    tickers.push({symbol:i.instrument_name,askPrice:ask*spot,bidPrice:bid*spot});
  }
  return {exchangeInfo:info,marks,tickers,index:{indexPrice:spot,time:nowMs},
    policy:policyDeribit,venue:"DERIBIT",currency:"BTC",spot,expiryCurrency:"BTC"};
}
export function normalizeDeribitBook(payload,spot){
  const b=payload?.result;
  if(payload?.jsonrpc!=="2.0"||!b||!Number.isFinite(num(b.timestamp)))return null;
  const cv=a=>Array.isArray(a)?a.map(x=>[num(x[0])*spot,num(x[1])]):[];
  return {T:num(b.timestamp),asks:cv(b.asks),bids:cv(b.bids)};
}
export function normalizeBinance({exchangeInfo,marks,tickers,index}){
  if(!Array.isArray(marks)||!Array.isArray(tickers)||!Array.isArray(exchangeInfo?.optionSymbols))
    throw Error("Binance chain invalid");
  return {exchangeInfo,marks,tickers,index,policy:policyBinance,venue:"BINANCE",
    currency:"USDT",spot:num(index?.indexPrice),expiryCurrency:"USDT"};
}
export function normalizeBinanceBook(x){return x}
export function rankVenue(adapter,rv,nowMs){
  return buildPairs({...adapter,rv,nowMs,policy:adapter.policy})
    .map(x=>({...x,venue:adapter.venue,policy:adapter.policy,
      currency:adapter.currency,expiryCurrency:adapter.expiryCurrency}));
}
export function verifyVenuePair(pair,bookCall,bookPut,nowMs){
  const p=validateDepth(pair,bookCall,bookPut,nowMs,pair.policy);
  return p?{...p,venue:pair.venue,currency:pair.currency,
    expiryCurrency:pair.expiryCurrency}:null;
}
export function chooseAcrossVenues(candidates,previous){
  // Never retain a previous candidate across venues unless it is still fully validated.
  const sorted=[...candidates].sort((a,b)=>b.score-a.score);
  if(!sorted.length)return null;
  const same=sorted.filter(x=>x.venue===previous?.candidate?.venue);
  const retained=chooseWinner(same,previous);
  if(retained&&retained.score>=sorted[0].score-.03)return retained;
  return sorted[0];
}
export function snapshotFromVenues(winner,nowMs,universe,rv,evidence={}){
  const snap=toSnapshot(winner,nowMs,universe,rv);
  snap.schema="tce-best-option-v1";
  snap.venues_checked=evidence.venues_checked||[];
  snap.venues_responded=evidence.venues_responded||[];
  if(!winner)return snap;
  snap.candidate.venue=winner.venue;
  snap.candidate.settlement_ccy=winner.currency;
  snap.candidate.min_notional_btc=winner.call.coinQty;
  snap.candidate.research_only=true;
  snap.candidate.fee_schedule="public_taker_assumption_not_account_verified";
  snap.candidate.model_rv_not_alpha=true;
  return snap;
}

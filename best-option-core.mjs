// Single-winner BTC option research selector; PUBLIC DATA ONLY. No order capability.
export const POLICY = Object.freeze({
  premiumCap: 60, feeRate: 0.00024, feeCap: 0.10,
  minDte: 7, maxDte: 45, maxAbsDelta: 0.28,
  maxLegSpread: 0.15, maxRoundTrip: 0.12,
  maxBookLagMs: 30000, maxSpotLagMs: 60000
});
const N = value => Number(value);
const good = value => Number.isFinite(N(value)) && N(value) > 0;
const cdf = z => {
  // Abramowitz-Stegun approximation, max error ~7.5e-8.
  const x=Math.abs(z), t=1/(1+0.2316419*x);
  const p=0.3989422804014327*Math.exp(-0.5*x*x);
  const q=p*t*(0.319381530+t*(-0.356563782+t*(1.781477937+t*(-1.821255978+t*1.330274429))));
  return z>=0 ? 1-q : q;
};
function bs(spot, strike, years, vol, isCall) {
  if (!(spot>0 && strike>0 && years>0 && vol>0))
    return isCall ? Math.max(spot-strike,0) : Math.max(strike-spot,0);
  const d1=(Math.log(spot/strike)+.5*vol*vol*years)/(vol*Math.sqrt(years));
  const d2=d1-vol*Math.sqrt(years);
  return isCall ? spot*cdf(d1)-strike*cdf(d2) : strike*cdf(-d2)-spot*cdf(-d1);
}
function gamma(spot,strike,years,vol) {
  if (!(spot>0&&years>0&&vol>0)) return 0;
  const d1=(Math.log(spot/strike)+.5*vol*vol*years)/(vol*Math.sqrt(years));
  return Math.exp(-.5*d1*d1)/(Math.sqrt(2*Math.PI)*spot*vol*Math.sqrt(years));
}
function fee(spot, rawAsk, coinQty, policy=POLICY) {
  return Math.min(policy.feeRate*spot*coinQty,policy.feeCap*rawAsk*coinQty);
}
export function annualizedRv(klines, days) {
  if (!Array.isArray(klines) || klines.length<days+1) return null;
  const closes=klines.slice(-(days+1)).map(k=>N(k[4]));
  if (closes.some(x=>!(x>0))) return null;
  const returns=closes.slice(1).map((v,i)=>Math.log(v/closes[i]));
  const mean=returns.reduce((a,b)=>a+b,0)/returns.length;
  const variance=returns.reduce((a,b)=>a+(b-mean)**2,0)/Math.max(1,returns.length-1);
  return Math.sqrt(variance*365);
}
function usableLeg(info, mark, ticker, spot, now, policy) {
  if (!info || info.status!=="TRADING" || !mark || !ticker || !good(info.strikePrice)) return null;
  const dte=(N(info.expiryDate)-now)/86400000;
  if (dte<policy.minDte || dte>policy.maxDte) return null;
  const delta=N(mark.delta), vol=N(mark.markIV), ask=N(ticker.askPrice), bid=N(ticker.bidPrice);
  if (!Number.isFinite(delta) || !good(vol)||!good(ask)||!good(bid)||bid>ask) return null;
  const lot=N(info.minQty), unit=N(info.unit), coinQty=lot*unit;
  if (!good(coinQty)) return null;
  const spread=(ask-bid)/ask;
  if (spread>policy.maxLegSpread || Math.abs(delta)<0.07 || Math.abs(delta)>0.94) return null;
  return {
    symbol:info.symbol, kind:info.side==="CALL"?"C":"P", strike:N(info.strikePrice),
    expiryMs:N(info.expiryDate), dte, delta, iv:vol, ask, bid, lot, unit, coinQty,
    spread, cost:coinQty*ask+fee(spot,ask,coinQty,policy),
    gamma:gamma(spot,N(info.strikePrice),dte/365,vol)*coinQty
  };
}
export function buildPairs({exchangeInfo, marks, tickers, index, nowMs, rv, policy=POLICY}) {
  const spot=N(index?.indexPrice);
  if (!good(spot) || !Number.isFinite(nowMs) || nowMs-N(index?.time)>policy.maxSpotLagMs || N(index?.time)>nowMs+5000)
    return [];
  const byMark=new Map((Array.isArray(marks)?marks:[]).map(x=>[x.symbol,x]));
  const byTicker=new Map((Array.isArray(tickers)?tickers:[]).map(x=>[x.symbol,x]));
  const grouped=new Map();
  for (const info of exchangeInfo?.optionSymbols||[]) {
    // Native instrument IDs differ across Binance (BTC-261204-60000-C),
    // OKX (BTC-USD-261204-60000-C), and Deribit (BTC-4DEC26-60000-C).
    const m=/^BTC(?:-USD)?-[A-Za-z0-9]+-\d+-(C|P)$/.exec(info.symbol||"");
    if(info.underlying!=="BTCUSDT"||!m||(m[1]==="C")!==(info.side==="CALL"))continue;
    const leg=usableLeg(info,byMark.get(info.symbol),byTicker.get(info.symbol),spot,nowMs,policy);
    if (!leg) continue;
    const key=String(leg.expiryMs);
    if (!grouped.has(key)) grouped.set(key,{calls:[],puts:[]});
    grouped.get(key)[leg.kind==="C"?"calls":"puts"].push(leg);
  }
  const scenarios=Array.isArray(rv)?rv.filter(x=>Number.isFinite(x)&&x>0):[];
  const conservative=scenarios.length===3 ? Math.min(...scenarios)*0.90 : null;
  const out=[];
  for (const [expiry,group] of grouped) {
    // With both sides in one expiration, allow symmetric/asymmetric/guts configurations.
    for (const call of group.calls) for (const put of group.puts) {
      if (call.lot!==put.lot || call.unit!==put.unit) continue;
      const totalDelta=call.delta+put.delta;
      if (Math.abs(totalDelta)>policy.maxAbsDelta) continue;
      const entryCost=call.cost+put.cost;
      const bidValue=call.bid*call.coinQty+put.bid*put.coinQty;
      const estimatedExitFees=fee(spot,call.bid,call.coinQty,policy)+fee(spot,put.bid,put.coinQty,policy);
      const friction=(entryCost-bidValue+estimatedExitFees)/entryCost;
      if (entryCost>policy.premiumCap || entryCost<=0 || friction>policy.maxRoundTrip) continue;
      const years=call.dte/365;
      const expectedIntrinsic=(sigma)=>(
        bs(spot,call.strike,years,sigma,true)*call.coinQty+
        bs(spot,put.strike,years,sigma,false)*put.coinQty
      );
      const modeledNet=conservative===null ? null : expectedIntrinsic(conservative)-entryCost
        -0.00015*spot*(call.coinQty+put.coinQty);
      const gamma5pct=0.5*(call.gamma+put.gamma)*(spot*0.05)**2;
      // Lexicographic hard gates above; objective is conservative modeled net ROI,
      // not an arbitrary weighted mix of incompatible units. Without RV, compare
      // execution-adjusted gamma efficiency only (research, never alpha evidence).
      const score=modeledNet===null ? gamma5pct/entryCost-friction : modeledNet/entryCost;
      out.push({
        call,put,expiryMs:N(expiry),entryCost,bidValue,friction,delta:totalDelta,
        gamma5pct, modeledNet, score,spot,conservativeRv:conservative
      });
    }
  }
  return out.sort((a,b)=>b.score-a.score || a.entryCost-b.entryCost);
}
function bookVwap(bookSide, qty) {
  if (!Array.isArray(bookSide) || !good(qty)) return null;
  let remaining=qty,notional=0;
  for(const level of bookSide) {
    const px=N(level[0]),sz=N(level[1]);
    if(!good(px)||!good(sz)) continue;
    const take=Math.min(remaining,sz);
    notional+=take*px;remaining-=take;
    if(remaining<=1e-9) break;
  }
  return remaining<=1e-9?notional/qty:null;
}
export function validateDepth(pair,bookCall,bookPut,nowMs,policy=POLICY) {
  if (!pair||!bookCall||!bookPut) return null;
  const books=[bookCall,bookPut],legs=[pair.call,pair.put];
  let cost=0,exit=0;
  for(let i=0;i<2;i++) {
    const book=books[i],leg=legs[i],t=N(book.T);
    if(!Number.isFinite(t)||Math.abs(nowMs-t)>policy.maxBookLagMs) return null;
    const ask=bookVwap(book.asks,leg.lot),bid=bookVwap(book.bids,leg.lot);
    if(!good(ask)||!good(bid)||bid>ask||(ask-bid)/ask>policy.maxLegSpread) return null;
    cost+=leg.coinQty*(ask+Math.min(policy.feeRate*pair.spot,policy.feeCap*ask));
    exit+=leg.coinQty*(bid-Math.min(policy.feeRate*pair.spot,policy.feeCap*bid));
  }
  const friction=(cost-exit)/cost;
  if(cost>policy.premiumCap || friction>policy.maxRoundTrip || friction<0) return null;
  const modeledNet=pair.modeledNet===null ? null : pair.modeledNet-(cost-pair.entryCost);
  const score=modeledNet===null ? pair.gamma5pct/cost-friction : modeledNet/cost;
  return {...pair,entryCost:cost,exitValue:exit,friction,modeledNet,score,verifiedDepth:true};
}
export function chooseWinner(candidates,previous) {
  const arr=[...candidates].sort((a,b)=>b.score-a.score);
  if(!arr.length) return null;
  if(previous?.candidate?.call_symbol && previous?.candidate?.put_symbol) {
    const old=arr.find(x=>x.call.symbol===previous.candidate.call_symbol &&
        x.put.symbol===previous.candidate.put_symbol);
    if(old && arr[0].score-old.score < Math.max(0.03,Math.abs(arr[0].score)*0.15)) return old;
  }
  return arr[0];
}
export function toSnapshot(pair,nowMs,universeSize,rv) {
  const base={schema:"tce-best-option-v1",generated_at_ms:nowMs,
    expires_at_ms:nowMs+25*60*1000,mode:"READ_ONLY",tradable:false,
    auto_order:false,universe_count:universeSize,decision:"CASH"};
  if(!pair) return {...base,state:"NO_FEASIBLE_CANDIDATE",candidate:null,
      reason:"No fresh, budget-feasible two-leg option pair with executable depth"};
  if(!pair.verifiedDepth || !Number.isFinite(pair.exitValue) || !Number.isFinite(pair.entryCost))
    return {...base,state:"BLOCKED_DATA",candidate:null,
      reason:"Candidate has not passed verified executable L2 depth"};
  return {...base,state:"SHADOW",reason:"Best screened convexity candidate; positive expectancy NOT established",
    evidence:"BLOCKED_EVIDENCE",candidate:{
      call_symbol:pair.call.symbol,put_symbol:pair.put.symbol,
      call_strike:pair.call.strike,put_strike:pair.put.strike,
      expiry_ms:pair.expiryMs,qty_contracts:pair.call.lot,
      premium_with_entry_fees_usdt:+pair.entryCost.toFixed(4),
      immediate_exit_net_usdt:+pair.exitValue.toFixed(4),
      roundtrip_loss_fraction:+pair.friction.toFixed(4),
      combined_delta:+pair.delta.toFixed(4),
      gamma_5pct_approx_usdt:+pair.gamma5pct.toFixed(4),
      conservative_rv_assumption:pair.conservativeRv,
      modeled_expiry_net_usdt:pair.modeledNet===null?null:+pair.modeledNet.toFixed(4),
      score:+pair.score.toFixed(4)
    },rv_7_14_30:rv};
}
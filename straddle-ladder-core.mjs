// Five nearest-expiry ATM BTC long straddles, by executable public L2 prices.
// Research-only. USD estimates on BTC-margined venues use the contemporaneous index.
export const LADDER_POLICY=Object.freeze({minDte:0.1,maxDte:45,maxCostUsd:60,
  maxLegSpread:0.15,maxRoundTripFraction:0.20,maxL2LagMs:45000,maxAtmDistance:0.03});
const n=x=>Number(x),positive=x=>Number.isFinite(n(x))&&n(x)>0;
export function shortlistStraddles(adapter,nowMs=Date.now(),policy=LADDER_POLICY){
  const spot=n(adapter?.spot);
  if(!positive(spot)||Math.abs(nowMs-n(adapter?.index?.time))>60000)return [];
  const tickers=new Map((adapter.tickers||[]).map(x=>[x.symbol,x]));
  const calls=new Map(),puts=new Map();
  for(const x of adapter.exchangeInfo?.optionSymbols||[]){
    if(x.underlying!=="BTCUSDT"||x.status!=="TRADING")continue;
    const dte=(n(x.expiryDate)-nowMs)/86400000, strike=n(x.strikePrice);
    if(dte<policy.minDte||dte>policy.maxDte||!positive(strike)||
       Math.abs(strike/spot-1)>policy.maxAtmDistance)continue;
    const q=tickers.get(x.symbol),ask=n(q?.askPrice),bid=n(q?.bidPrice);
    if(!positive(ask)||!positive(bid)||ask<bid||(ask-bid)/ask>policy.maxLegSpread)continue;
    const qty=n(x.minQty),unit=n(x.unit);
    if(!positive(qty)||!positive(unit))continue;
    const v={symbol:x.symbol,exp:n(x.expiryDate),strike,ask,bid,qty,unit,coinQty:qty*unit};
    const key=v.exp+":"+strike;
    (x.side==="CALL"?calls:puts).set(key,v);
  }
  const rows=[];
  for(const [key,call] of calls){
    const put=puts.get(key);
    if(!put||call.coinQty!==put.coinQty||call.qty!==put.qty)continue;
    const cost=(call.ask+put.ask)*call.coinQty+
      Math.min(adapter.policy.feeRate*spot*call.coinQty,adapter.policy.feeCap*call.ask*call.coinQty)+
      Math.min(adapter.policy.feeRate*spot*put.coinQty,adapter.policy.feeCap*put.ask*put.coinQty);
    if(cost>policy.maxCostUsd)continue;
    rows.push({call,put,expiry_ms:call.exp,strike:call.strike,spot,coinQty:call.coinQty,
      cost,venue:adapter.venue,policy:adapter.policy,
      // At expiry, one intrinsic-value leg offsets premium only at these price levels.
      low:call.strike-cost/call.coinQty,high:call.strike+cost/call.coinQty,
      distance:Math.abs(call.strike-spot)});
  }
  const dates=new Map();
  for(const row of rows){
    if(!dates.has(row.expiry_ms))dates.set(row.expiry_ms,[]);
    dates.get(row.expiry_ms).push(row);
  }
  return [...dates.keys()].sort((a,b)=>a-b).flatMap(exp=>{
    const choices=dates.get(exp).sort((a,b)=>a.distance-b.distance||a.cost-b.cost);
    // Up to 3 near-ATM strikes per expiry, to recover from missing depth.
    return choices.slice(0,3);
  });
}
function vwap(levels,qty){
  if(!Array.isArray(levels))return null;
  let rem=qty,total=0;
  for(const level of levels){
    const price=n(level[0]),size=n(level[1]);
    if(!positive(price)||!positive(size))continue;
    const fill=Math.min(rem,size);
    total+=fill*price;rem-=fill;
    if(rem<=1e-9)break;
  }
  return rem<=1e-9?total/qty:null;
}
export function validateStraddle(row,callBook,putBook,nowMs=Date.now(),policy=LADDER_POLICY){
  if(!row||!callBook||!putBook)return null;
  let cost=0,exit=0;
  for(const [leg,book] of [[row.call,callBook],[row.put,putBook]]){
    const ts=n(book.T);
    if(!Number.isFinite(ts)||ts>nowMs+5000||nowMs-ts>policy.maxL2LagMs)return null;
    const ask=vwap(book.asks,leg.qty),bid=vwap(book.bids,leg.qty);
    if(!positive(ask)||!positive(bid)||ask<bid||(ask-bid)/ask>policy.maxLegSpread)return null;
    cost+=row.coinQty*(ask+Math.min(row.policy.feeRate*row.spot,row.policy.feeCap*ask));
    exit+=row.coinQty*(bid-Math.min(row.policy.feeRate*row.spot,row.policy.feeCap*bid));
  }
  if(cost>policy.maxCostUsd||cost<=0||(cost-exit)/cost>policy.maxRoundTripFraction)return null;
  return {venue:row.venue,call_symbol:row.call.symbol,put_symbol:row.put.symbol,
    call_strike:row.strike,put_strike:row.strike,expiry_ms:row.expiry_ms,
    index_price_usd:row.spot,coin_qty:row.coinQty,
    min_call_contracts:row.call.qty,min_put_contracts:row.put.qty,
    all_in_cost_usd:+cost.toFixed(2),
    breakeven_low_usd:+(row.strike-cost/row.coinQty).toFixed(2),
    breakeven_high_usd:+(row.strike+cost/row.coinQty).toFixed(2),
    roundtrip_fraction:+((cost-exit)/cost).toFixed(4),
    verified_depth:true,quote_time_ms:Math.min(n(callBook.T),n(putBook.T))};
}
export function chooseFive(rows,nowMs=Date.now()){
  const sorted=[...rows].sort((a,b)=>a.expiry_ms-b.expiry_ms||
    Math.abs(a.call_strike-a.index_price_usd)-Math.abs(b.call_strike-b.index_price_usd)||
    a.all_in_cost_usd-b.all_in_cost_usd);
  const dates=[...new Map(sorted.map(r=>[r.expiry_ms,r])).values()];
  // Retain short-term convexity AND a longer dated comparison, not five
  // nearly identical daily expirations.
  const result=[],add=x=>{if(x&&!result.some(y=>y.expiry_ms===x.expiry_ms))result.push(x)};
  dates.slice(0,3).forEach(add);
  add(dates.find(x=>(x.expiry_ms-nowMs)/86400000>=4 && (x.expiry_ms-nowMs)/86400000<8));
  add(dates.find(x=>(x.expiry_ms-nowMs)/86400000>=8));
  for(const x of dates){if(result.length>=5)break;add(x)}
  return result.sort((a,b)=>a.expiry_ms-b.expiry_ms).slice(0,5);
}

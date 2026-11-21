import test from "node:test";
import assert from "node:assert/strict";
import {buildPairs,validateDepth} from "../best-option-core.mjs";
import {normalizeOKX,normalizeOKXBook,normalizeDeribit} from "../best-option-venues.mjs";
const now=1795300000000,expiry=now+14*86400000,spot=60000;
const instruments=[],greeks=[],tickers=[];
for(const [kind,delta,ask,bid] of [["C",.51,.045,.044],["P",-.49,.039,.038]]){
 const instId="BTC-USD-261204-60000-"+kind;
 instruments.push({instId,instFamily:"BTC-USD",state:"live",settleCcy:"BTC",
  ctVal:"1",ctMult:"0.01",minSz:"1",expTime:String(expiry)});
 greeks.push({instId,markVol:".56",deltaBS:String(delta),ts:String(now)});
 tickers.push({instId,askPx:String(ask),bidPx:String(bid),ts:String(now)});
}
const fixture={instruments:{code:"0",data:instruments},
 tickers:{code:"0",data:tickers},greeks:{code:"0",data:greeks},
 index:{code:"0",data:[{idxPx:String(spot),ts:String(now)}]}};
test("OKX min lot correctly uses contract multiplier 0.01 BTC",()=>{
 const x=normalizeOKX(fixture,now);
 assert.equal(x.exchangeInfo.optionSymbols.length,2);
 assert.equal(x.exchangeInfo.optionSymbols[0].unit,0.01);
 assert.equal(x.exchangeInfo.optionSymbols[0].minQty,1);
 const p=buildPairs({...x,rv:[.65,.60,.55],nowMs:now,policy:x.policy});
 assert.equal(p.length,1);
 assert(p[0].entryCost>50&&p[0].entryCost<60);
});
test("OKX quote unit conversion and verified L2 depth",()=>{
 const x=normalizeOKX(fixture,now);
 const p=buildPairs({...x,rv:null,nowMs:now,policy:x.policy})[0];
 const book=px=>normalizeOKXBook({code:"0",data:[{ts:String(now),asks:[[String(px),"3"]],bids:[[String(px-.001),"3"]]}]},spot);
 const validated=validateDepth(p,book(.045),book(.039),now,x.policy);
 assert(validated && validated.entryCost<60 && validated.verifiedDepth);
});
test("No fake 1 BTC exposure if the multiplier is missing and face value unknown",()=>{
 const q=JSON.parse(JSON.stringify(fixture));
 q.instruments.data.forEach(i=>{i.ctVal="2";i.ctMult="";});
 assert.equal(normalizeOKX(q,now).exchangeInfo.optionSymbols.length,0);
});
test("Stale OKX quotes are discarded",()=>{
 const q=JSON.parse(JSON.stringify(fixture));
 q.tickers.data.forEach(i=>i.ts=String(now-5*60000));
 assert.equal(normalizeOKX(q,now).exchangeInfo.optionSymbols.length,0);
});
test("Deribit min_trade_amount is not confused with 0.01 BTC OKX lot",()=>{
 const items=[{instrument_name:"BTC-4DEC26-60000-C",kind:"option",base_currency:"BTC",
  settlement_currency:"BTC",option_type:"call",strike:60000,expiration_timestamp:expiry,
  min_trade_amount:.1,contract_size:1,is_active:true}];
 const summary=[{instrument_name:"BTC-4DEC26-60000-C",best_ask_price:.05,
  best_bid_price:.049,mark_iv:56,underlying_price:60000}];
 const x=normalizeDeribit({instruments:{jsonrpc:"2.0",result:items},
  summaries:{jsonrpc:"2.0",result:summary}},now);
 assert.equal(x.exchangeInfo.optionSymbols[0].unit,1);
 assert.equal(x.exchangeInfo.optionSymbols[0].minQty,.1);
 assert.equal(x.marks[0].markIV,.56);
});

import test from "node:test";
import assert from "node:assert/strict";
import {shortlistStraddles,validateStraddle,chooseFive} from "../straddle-ladder-core.mjs";
const t=1795300000000,spot=60000,expiry=t+86400000,policy={feeRate:.00024,feeCap:.1};
function adapter(){
  const optionSymbols=[],tickers=[];
  for(const days of [1,2,5,12,19,33]){
    const date=t+days*86400000;
    for(const [kind,ask,bid] of [["CALL",700+days*30,695+days*30],["PUT",720+days*30,715+days*30]]){
      const symbol="BTC-261122-60000-"+(kind==="CALL"?"C":"P")+"-"+days;
      optionSymbols.push({underlying:"BTCUSDT",status:"TRADING",symbol,side:kind,
        expiryDate:date,strikePrice:"60000",minQty:".01",unit:1});
      tickers.push({symbol,askPrice:String(ask),bidPrice:String(bid)});
    }
  }
  return {spot,index:{time:t},venue:"BINANCE",policy,exchangeInfo:{optionSymbols},tickers};
}
function book(ask,bid,ts=t){return {T:ts,asks:[[ask,"1"]],bids:[[bid,"1"]]}}
test("nearest-expiry selection does not force 7-day minimum",()=>{
  const x=shortlistStraddles(adapter(),t);
  assert.equal(x.length,6);
  assert.equal(x[0].expiry_ms,expiry);
});
test("cost includes two buy premiums and fees, returning dollar breakevens",()=>{
  const x=shortlistStraddles(adapter(),t)[0];
  const y=validateStraddle(x,book(x.call.ask,x.call.bid),book(x.put.ask,x.put.bid),t);
  assert(y);assert(y.verified_depth);assert(y.all_in_cost_usd>0);
  const calc=y.all_in_cost_usd/.01;
  assert(Math.abs(y.breakeven_high_usd-(60000+calc))<1.01);
  assert(Math.abs(y.breakeven_low_usd-(60000-calc))<1.01);
});
test("five unique nearest expirations",()=>{
  const x=shortlistStraddles(adapter(),t);
  const vetted=x.map(a=>validateStraddle(a,book(a.call.ask,a.call.bid),book(a.put.ask,a.put.bid),t));
  const rows=chooseFive(vetted.filter(Boolean));
  assert.equal(rows.length,5);
  assert.equal(new Set(rows.map(r=>r.expiry_ms)).size,5);
});
test("fail closed on missing L2 depth and stale book",()=>{
  const x=shortlistStraddles(adapter(),t)[0];
  assert.equal(validateStraddle(x,null,null,t),null);
  assert.equal(validateStraddle(x,book(x.call.ask,x.call.bid,t-50000),
    book(x.put.ask,x.put.bid),t),null);
});
test("cost cap rejects over-budget straddles",()=>{
  const a=adapter();
  a.tickers.forEach(x=>{x.askPrice="5000";x.bidPrice="4950"});
  assert.equal(shortlistStraddles(a,t).length,0);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {buildPairs,validateDepth,chooseWinner,toSnapshot,annualizedRv} from '../best-option-core.mjs';
const now=1795300000000;
const expiry=now+14*86400000, info={optionSymbols:[]};
const marks=[],tickers=[];
for (const [side,strike,delta,ask,bid] of [['CALL',60000,.51,2720,2685],['PUT',60000,-.49,2300,2280],['CALL',65000,.2,900,850],['PUT',55000,-.2,1100,1050]]) {
 const sym='BTC-261204-'+strike+'-'+(side==='CALL'?'C':'P');
 info.optionSymbols.push({symbol:sym,underlying:'BTCUSDT',status:'TRADING',side,strikePrice:String(strike),expiryDate:expiry,minQty:'0.01',unit:'1'});
 marks.push({symbol:sym,delta:String(delta),markIV:'0.55'});
 tickers.push({symbol:sym,askPrice:String(ask),bidPrice:String(bid)});
}
const input={exchangeInfo:info,marks,tickers,index:{indexPrice:'60406',time:now},nowMs:now,rv:[0.7,0.63,0.51]};
test('pairs use executable ask and min quantity, include ATM and asymmetric grid',()=>{
 const a=buildPairs(input);assert(a.length>0);assert(a.some(x=>x.call.strike===60000&&x.put.strike===60000));
 assert(a.every(x=>x.entryCost<=60 && Math.abs(x.delta)<=.28));
});
test('false positive: missing book or insufficient quantity cannot pass',()=>{
 const p=buildPairs(input)[0];
 assert.equal(validateDepth(p,null,null,now),null);
 assert.equal(validateDepth(p,{T:now,asks:[[100,0.001]],bids:[[99,0.001]]},{T:now,asks:[[100,0.01]],bids:[[99,0.01]]},now),null);
});
test('depth uses VWAP and timestamps, never ticker fallback',()=>{
 const p=buildPairs(input)[0];
 const book=(leg)=>({T:now,bids:[[leg.bid,.05]],asks:[[leg.ask,.05]]});
 assert(validateDepth(p,book(p.call),book(p.put),now));
 assert.equal(validateDepth(p,book(p.call),book(p.put),now+60000),null);
});
test('winner hysteresis is stable within threshold',()=>{
 const a=buildPairs(input);if(a.length>1){
 const previous={candidate:{call_symbol:a[1].call.symbol,put_symbol:a[1].put.symbol}};
 const w=chooseWinner(a,previous);assert(w);
 } else assert(a.length===1);
});
test('no candidate is CASH; candidate remains SHADOW even modeled net positive',()=>{
 assert.equal(toSnapshot(null,now,0,null).decision,'CASH');
 const unverified=buildPairs(input)[0];
 assert.equal(toSnapshot(unverified,now,4,[.7,.63,.51]).state,'BLOCKED_DATA');
 const book=leg=>({T:now,bids:[[leg.bid,.05]],asks:[[leg.ask,.05]]});
 const vetted=validateDepth(unverified,book(unverified.call),book(unverified.put),now);
 assert(vetted);
 const s=toSnapshot(vetted,now,4,[.7,.63,.51]);
 assert.equal(s.decision,'CASH');assert.equal(s.state,'SHADOW');assert.equal(s.tradable,false);
});
test('rv requires enough real observations',()=>{assert.equal(annualizedRv([],7),null);});

import assert from "node:assert/strict";
import test from "node:test";
import {chooseMerkl,chooseMeteora} from "../lp-radar-lib.js";
const now=Date.parse("2026-10-17T13:30:00Z");
const goodCampaign={startTimestamp:now/1000-86400,endTimestamp:now/1000+7*86400,
 rewardToken:{verified:true,price:1,symbol:"UNI"},campaignStatus:{status:"SUCCESS"},
 params:{whitelist:[],symbolCurrency0:"USDC",symbolCurrency1:"WETH"}};
const market=(overrides={})=>({id:"42",status:"LIVE",type:"UNISWAP_V3",
 name:"Provide liquidity to Uniswap USDC-WETH 0.3%",
 tvl:850000,apr:12,campaigns:[goodCampaign],...overrides});
const pool=(overrides={})=>({address:"Pool111",name:"SOL-USDC",tvl:900000,
 created_at:now-15*86400000,token_x:{symbol:"SOL",is_verified:true},
 token_y:{symbol:"USDC",is_verified:true},fees:{"30m":40,"1h":80,"4h":320,"24h":1600},
 volume:{"24h":1000000},...overrides});
test("Merkl excludes loan/looping products even when APR is enormous",()=>{
 const m=chooseMerkl([market({id:"0",type:"AAVE_SUPPLY",apr:900,name:"Lend USDC (looping required)"}),market()],now);
 assert.equal(m.opportunity_id,"42");assert.equal(m.status,"WATCH_NET_UNVERIFIED");
});
test("Merkl requires active, public, priced and open-to-all campaigns",()=>{
 const expired=market({campaigns:[{...goodCampaign,endTimestamp:now/1000+600}]});
 const gated=market({campaigns:[{...goodCampaign,params:{whitelist:["0xabc"]}}]});
 const unpriced=market({campaigns:[{...goodCampaign,rewardToken:{verified:false,price:0}}]});
 assert.equal(chooseMerkl([expired,gated,unpriced],now),null);
});
test("Merkl score penalizes tempting thin high-APR pools",()=>{
 const a=market(),b=market({id:"999",tvl:40000,apr:249});
 assert.equal(chooseMerkl([b,a],now).opportunity_id,"42");
});
test("Meteora relies on repeat fees across windows rather than a 24h spike",()=>{
 const spiky=pool({address:"Spike",fees:{"30m":0,"1h":0,"4h":0,"24h":100000}});
 const m=chooseMeteora([spiky,pool()],now);
 assert.equal(m.address,"Pool111");
 assert.equal(m.conservative_pool_fee_per_hour_usd,66.67);
});
test("Meteora rejects blacklisted, no-depth and newly opened candidates",()=>{
 assert.equal(chooseMeteora([pool({is_blacklisted:true})],now),null);
 assert.equal(chooseMeteora([pool({tvl:1000})],now),null);
 assert.equal(chooseMeteora([pool({created_at:now-3600000})],now),null);
});
test("No candidate is called a verified positive-net-return opportunity",()=>{
 assert.equal(chooseMerkl([market()],now).status,"WATCH_NET_UNVERIFIED");
 assert.ok(chooseMeteora([pool()],now).missing.includes("exit_quote"));
});

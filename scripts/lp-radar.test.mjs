import assert from "node:assert/strict";
import test from "node:test";
import {chooseMerkl,chooseMeteora,requirePositionNetEvidence,assessDailyPoolPriceChange} from "../lp-radar-lib.js";
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
test("Meteora cannot promote unknown/unverified Meme despite enormous pool fees",()=>{
 const m=pool({address:"Unknown",name:"simulator-SOL",token_x:{symbol:"simulator",is_verified:false},
  fees:{"30m":9000,"1h":18000,"4h":72000,"24h":400000}});
 assert.equal(chooseMeteora([m,pool()],now).address,"Pool111");
});
test("No candidate is called a verified positive-net-return opportunity",()=>{
 assert.equal(chooseMerkl([market()],now).status,"WATCH_NET_UNVERIFIED");
 assert.ok(chooseMeteora([pool()],now).missing.includes("exit_quote"));
});

test("Merkl exposes fee-weight and out-of-range eligibility rather than claiming the shown APR is a position return",()=>{
 const weighted={...goodCampaign,params:{...goodCampaign.params,weightFees:8000,
  isOutOfRangeIncentivized:false}};
 const c=chooseMerkl([market({campaigns:[weighted]})],now);
 assert.equal(c.reward_policy.fee_weight_min,8000);
 assert.equal(c.reward_policy.out_of_range_incentivized,false);
 assert.equal(c.net_edge_state,"UNKNOWN_NO_POSITION_LEVEL_FEES_OR_EXIT_QUOTE");
});
test("No APR or pool fees can become verified net edge without independent fresh eligible exit quote",()=>{
 const c=chooseMeteora([pool()],now);
 assert.equal(requirePositionNetEvidence(c,null),null);
 const e={source:"POSITION_LEVEL_INDEPENDENT_SIMULATION",expected_position_fee_usd:20,
  claimable_rewards_usd:5,inventory_loss_usd:3,gas_usd:1,swap_slippage_usd:1,
  rebalance_usd:1,out_of_range_usd:2,exit_cost_usd:1,
  eligibility_verified:true,exit_route_verified:true,fresh_quote_age_ms:35000};
 assert.equal(requirePositionNetEvidence(c,{...e,exit_route_verified:false}),null);
 assert.equal(requirePositionNetEvidence(c,{...e,fresh_quote_age_ms:150000}),null);
 assert.equal(requirePositionNetEvidence(c,{...e,inventory_loss_usd:100}),null);
 assert.equal(requirePositionNetEvidence(c,e).simulated_net_usd,16);
});
test("Observed 1-day pair-price move is independent from fee pool gross ROI",()=>{
 const bars=[
   {timestamp:100000,close:50},
   {timestamp:100000+86400,close:35}
 ];
 assert.equal(assessDailyPoolPriceChange(bars),-30);
 assert.equal(assessDailyPoolPriceChange([{timestamp:1,close:50}]),null);
 assert.equal(assessDailyPoolPriceChange([{timestamp:1,close:50},{timestamp:61,close:35}]),null);
});

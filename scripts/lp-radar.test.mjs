import assert from "node:assert/strict";
import test from "node:test";
import {chooseMerkl,chooseMeteora,requirePositionNetEvidence,assessDailyPoolPriceChange,sameMeteoraPoolIdentity,sameMerklOpportunityIdentity,compareSameHorizonLP} from "../lp-radar-lib.js";
const now=Date.parse("2026-10-17T13:30:00Z");
const goodCampaign={startTimestamp:now/1000-86400,endTimestamp:now/1000+7*86400,
 rewardToken:{verified:true,price:1,symbol:"UNI"},campaignStatus:{status:"SUCCESS"},
 params:{whitelist:[],symbolCurrency0:"USDC",symbolCurrency1:"WETH"}};
const market=(overrides={})=>({id:"42",status:"LIVE",type:"UNISWAP_V3",
 name:"Provide liquidity to Uniswap USDC-WETH 0.3%",
 tvl:850000,apr:12,campaigns:[goodCampaign],...overrides});
const pool=(overrides={})=>({address:"Pool111",name:"SOL-USDC",tvl:900000,
 created_at:now-15*86400000,token_x:{address:"mintSOL",symbol:"SOL",is_verified:true,market_cap:90000000},
 token_y:{address:"mintUSDC",symbol:"USDC",is_verified:true,market_cap:900000000},
 fees:{"30m":40,"1h":80,"4h":320,"24h":1600},
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
test("Meteora selects the highest absolute 24h pool fee even when short windows are quiet",()=>{
 const large=pool({address:"HighFee",fees:{"30m":0,"1h":0,"4h":0,"24h":100000}});
 const pick=chooseMeteora([pool(),large],now);
 assert.equal(pick.address,"HighFee");
 assert.equal(pick.fee_24h_usd,100000);
 assert.equal(pick.ranking_metric,"ABSOLUTE_POOL_FEES_24H_USD");
});
test("Meteora enforces TVL >=100k, both token market caps >=500k and blacklist",()=>{
 assert.equal(chooseMeteora([pool({is_blacklisted:true})],now),null);
 assert.equal(chooseMeteora([pool({tvl:99999})],now),null);
 assert.equal(chooseMeteora([pool({tvl:100000})],now)?.address,"Pool111");
 assert.equal(chooseMeteora([pool({token_x:{address:"mintSOL",symbol:"SOL",market_cap:499999}})],now),null);
 assert.equal(chooseMeteora([pool({token_y:{address:"mintUSDC",symbol:"USDC",market_cap:undefined}})],now),null);
 assert.equal(chooseMeteora([pool({token_x:{address:"mintSOL",symbol:"SOL",market_cap:500000}})],now)?.address,"Pool111");
});
test("Meteora does not conflate token verified badge with required numeric market cap",()=>{
 const high=pool({address:"Meme",name:"MEME-SOL",
  token_x:{address:"mintMEME",symbol:"MEME",is_verified:false,market_cap:600000},
  fees:{"30m":0,"1h":0,"4h":0,"24h":400000}});
 assert.equal(chooseMeteora([high,pool()],now).address,"Meme");
 assert.equal(chooseMeteora([{
  ...high,token_x:{...high.token_x,market_cap:0,is_verified:true}
 }],now),null);
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

test("Meteora pools with identical display symbols must match address AND token mints",()=>{
 const a=pool({address:"poolA",name:"DOPE-SOL",token_x:{address:"mintA",symbol:"DOPE",is_verified:true},
   token_y:{address:"mintSOL",symbol:"SOL",is_verified:true}});
 assert.equal(sameMeteoraPoolIdentity(a,{...a}),true);
 assert.equal(sameMeteoraPoolIdentity(a,{...a,address:"poolB"}),false);
 assert.equal(sameMeteoraPoolIdentity(a,{...a,token_x:{...a.token_x,address:"otherMint"}}),false);
 assert.equal(sameMeteoraPoolIdentity(a,{...a,is_blacklisted:true}),false);
});
test("Merkl list and exact detail must match ID, chain, pool key and LIVE status",()=>{
 const a=market({identifier:"0xpool",chainId:1});
 assert.equal(sameMerklOpportunityIdentity(a,{...a}),true);
 assert.equal(sameMerklOpportunityIdentity(a,{...a,identifier:"0xother"}),false);
 assert.equal(sameMerklOpportunityIdentity(a,{...a,chainId:42161}),false);
 assert.equal(sameMerklOpportunityIdentity(a,{...a,status:"PAST"}),false);
});


test("LP optimizer rejects stale, incomplete or different-horizon position economics",()=>{
 const ev={source:"POSITION_LEVEL_INDEPENDENT_SIMULATION",observed_at_ms:now-30000,
   horizon_hours:24,capital_usd:1000,pool_or_position_id:"a",
   exit_route_verified:true,eligibility_verified:true,swap_back_to_stable_verified:true,
   swap_fees_usd:30,flash_fees_usd:0,claimable_rewards_usd:4,
   inventory_loss_usd:10,gas_usd:1,swap_slippage_usd:1,
   rebalance_usd:2,out_of_range_usd:0,exit_cost_usd:2,migration_cost_usd:3};
 const entry={id:"a",evidence:ev};
 const good=compareSameHorizonLP({capitalUsd:1000,horizonHours:24,nowMs:now,candidates:[entry]});
 assert.equal(good.action,"CANARY_REVIEW");
 assert.equal(good.leader.net_usd,18);
 assert.equal(good.order_permission,"ABSENT");
 assert.equal(compareSameHorizonLP({capitalUsd:1000,horizonHours:24,nowMs:now,
   candidates:[{id:"a",evidence:{...ev,observed_at_ms:now-180000}}]}).action,"CASH");
 assert.equal(compareSameHorizonLP({capitalUsd:1000,horizonHours:168,nowMs:now,
   candidates:[entry]}).action,"CASH");
 assert.equal(compareSameHorizonLP({capitalUsd:1000,horizonHours:24,nowMs:now,
   candidates:[{id:"a",evidence:{...ev,exit_route_verified:false}}]}).action,"CASH");
 assert.equal(compareSameHorizonLP({capitalUsd:1000,horizonHours:24,nowMs:now,
   candidates:[{id:"a",evidence:{...ev,pool_or_position_id:"other"}}]}).action,"CASH");
 assert.equal(compareSameHorizonLP({capitalUsd:1000,horizonHours:24,nowMs:now,
   candidates:[{id:"a",evidence:{...ev,flash_fees_usd:undefined}}]}).action,"CASH");
});

test("LP optimizer demands improvement exceeding twice incremental migration costs",()=>{
 const base={source:"POSITION_LEVEL_INDEPENDENT_SIMULATION",observed_at_ms:now-30000,
   horizon_hours:24,capital_usd:1000,exit_route_verified:true,
   eligibility_verified:true,swap_back_to_stable_verified:true,
   swap_fees_usd:20,flash_fees_usd:2,claimable_rewards_usd:0,
   inventory_loss_usd:5,gas_usd:1,swap_slippage_usd:1,
   rebalance_usd:1,out_of_range_usd:1,exit_cost_usd:1,migration_cost_usd:0};
 const incumbent={id:"old",evidence:{...base,pool_or_position_id:"old"}};
 const incumbentNet=compareSameHorizonLP({capitalUsd:1000,horizonHours:24,nowMs:now,
    candidates:[incumbent]}).leader.net_usd;
 assert.equal(incumbentNet,12);
 // 18-12=6. Incremental migration=4, minimum required gain >8: HOLD.
 const candidate={id:"new",evidence:{...base,pool_or_position_id:"new",
   swap_fees_usd:26,migration_cost_usd:4}};
 const hold=compareSameHorizonLP({capitalUsd:1000,horizonHours:24,nowMs:now,
   incumbent,candidates:[candidate]});
 assert.equal(hold.action,"HOLD_REVIEW");
 assert.equal(hold.delta_usd,6);
 assert.equal(hold.hurdle_usd,8);
 // 23-12=11 >8: switch only in SHADOW mode, no execution.
 const improved={id:"new",evidence:{...candidate.evidence,swap_fees_usd:31}};
 const switcher=compareSameHorizonLP({capitalUsd:1000,horizonHours:24,nowMs:now,
   incumbent,candidates:[improved]});
 assert.equal(switcher.action,"SWITCH_REVIEW");
 assert.equal(switcher.delta_usd,11);
 assert.equal(switcher.order_permission,"ABSENT");
 const blocked=compareSameHorizonLP({capitalUsd:1000,horizonHours:24,nowMs:now,
   incumbent:{id:"old",evidence:{...base,exit_route_verified:false,pool_or_position_id:"old"}},
   candidates:[improved]});
 assert.equal(blocked.status,"BLOCKED_EVIDENCE");
});

test("Meteora tie-break is deterministic and not influenced by liquidity ratio",()=>{
 const a=pool({address:"A",tvl:110000,fees:{"24h":5000}});
 const b=pool({address:"B",tvl:950000,fees:{"24h":5000}});
 assert.equal(chooseMeteora([a,b],now).address,"B");
 const c=pool({address:"C",tvl:100000,fees:{"24h":5001}});
 assert.equal(chooseMeteora([a,b,c],now).address,"C");
});
test("No valid market cap -> no winner even if liquidity and 24h fees are huge",()=>{
 const unknown=pool({tvl:10000000,fees:{"24h":500000},
  token_x:{address:"mintU",symbol:"U",is_verified:true}});
 assert.equal(chooseMeteora([unknown],now),null);
});

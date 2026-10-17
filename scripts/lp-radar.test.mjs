import assert from "node:assert/strict";
import test from "node:test";
import {chooseMerkl, chooseMeteora} from "../lp-radar-lib.js";

const now = Date.parse("2026-10-17T13:30:00Z");
const k = "1:0xPool";
const campaign = {
  startTimestamp:now/1000-86400,endTimestamp:now/1000+7*86400,
  rewardToken:{verified:true,price:1,symbol:"USDC"},
  campaignStatus:{status:"SUCCESS"},params:{whitelist:[],blacklist:[],
    symbolCurrency0:"USDC",symbolCurrency1:"WETH",hooks:"0xHook",weightFees:50}
};
const merkl = (overrides={}) => ({
  id:"42",chainId:1,status:"LIVE",type:"UNISWAP_V4",action:"POOL",
  name:"Provide liquidity to Uniswap V4 ETH-USDC",
  identifier:"0xPool",tvl:850000,apr:12,campaigns:[campaign],...overrides
});
const evidence=(overrides={})=>({observed_at_ms:now-60000,
  pool_fee_usd_24h:500,active_liquidity_usd:500000,natural_volume_usd_4h:20000,...overrides});
const mint=(symbol,other={})=>({symbol,address:symbol+"11111111",is_verified:true,...other});
const pool=(overrides={})=>({
  address:"Pool111",name:"SOL-USDC",tvl:900000,created_at:now-35*86400000,
  token_x:mint("SOL"),token_y:mint("USDC"),is_blacklisted:false,
  pool_config:{base_fee_pct:0.3,protocol_fee_pct:10},
  fees:{"30m":40,"1h":80,"4h":320,"24h":1600},
  volume:{"30m":6000,"24h":1000000},...overrides
});

test("Merkl incentives alone never produce a ranked pool regardless of APR",()=>{
 assert.equal(chooseMerkl([merkl({apr:400})],now),null);
});
test("Merkl requires independent fresh real fee and liquidity evidence",()=>{
 assert.equal(chooseMerkl([merkl()],now,{[k]:evidence({observed_at_ms:now-2*3600000})}),null);
 assert.equal(chooseMerkl([merkl()],now,{[k]:evidence({pool_fee_usd_24h:0})}),null);
 const p=chooseMerkl([merkl()],now,{[k]:evidence()});
 assert.equal(p.status,"RESEARCH_ONLY_NET_EDGE_UNKNOWN");
 assert.ok(p.missing.includes("position_specific_reward_eligibility"));
 assert.ok(p.campaign_mechanism_flags.includes("hook_rules"));
});
test("Merkl excludes invalid, private and loan campaigns even with independent fee evidence",()=>{
 const invalid=[
  merkl({type:"AAVE_SUPPLY",name:"Lend USDC"}),
  merkl({campaigns:[{...campaign,endTimestamp:now/1000+3600}]}),
  merkl({campaigns:[{...campaign,isPrivate:true}]}),
  merkl({campaigns:[{...campaign,params:{whitelist:["0xPerson"]}}]}),
  merkl({campaigns:[{...campaign,rewardToken:{verified:false,price:0}}]})
 ];
 assert.equal(chooseMerkl(invalid,now,{[k]:evidence()}),null);
});
test("Merkl fee evidence takes priority over an attractive incentive APR",()=>{
 const b=merkl({id:"55",identifier:"0xBetter",apr:3});
 const win=chooseMerkl([merkl({apr:80}),b],now,{
  [k]:evidence({pool_fee_usd_24h:50}),
  "1:0xBetter":evidence({pool_fee_usd_24h:1200})
 });
 assert.equal(win.opportunity_id,"55");
});

test("Meteora recognizes repeat fee flow but labels it unverified research",()=>{
 const p=chooseMeteora([pool()],now);
 assert.equal(p.address,"Pool111");
 assert.equal(p.conservative_pool_fee_per_hour_usd,66.67);
 assert.equal(p.status,"RESEARCH_ONLY_NET_EDGE_UNKNOWN");
 assert.ok(p.missing.includes("active_bin_liquidity"));
});
test("Meteora rejects spikes without sustained traffic and stale 30m activity",()=>{
 const spike=pool({fees:{"30m":0,"1h":0,"4h":1000,"24h":50000}});
 const idle=pool({volume:{"30m":0,"24h":1000000}});
 assert.equal(chooseMeteora([spike,idle],now),null);
});
test("Meteora rejects missing token mints, unverified, blacklisted, thin, too-new pools",()=>{
 const variants=[
  pool({token_x:mint("SOL",{address:""})}),
  pool({token_y:mint("USDC",{is_verified:false})}),
  pool({is_blacklisted:true}),
  pool({tvl:1000}),
  pool({created_at:now-3600000})
 ];
 for(const p of variants)assert.equal(chooseMeteora([p],now),null);
});
test("Meteora DOPE-SOL 3pct fee pool cannot pass spot evidence gate",()=>{
 const dope=pool({address:"J2XBZkpC7ygBQiPw2MWWCqiVJn9i44b8GwtTRoFV1ijj",
  name:"DOPE-SOL",token_x:mint("DOPE"),
  token_y:mint("SOL"),pool_config:{base_fee_pct:3,protocol_fee_pct:10},
  fees:{"30m":76.6,"1h":172.7,"4h":548.1,"24h":4357},
  volume:{"30m":2767,"24h":155000},tvl:128070,
  created_at:now-6*86400000});
 assert.equal(chooseMeteora([dope],now),null);
});
test("A meme or 3pct fee pool needs active-bin and exit review, not an automatic spot winner",()=>{
 const pair=pool({token_x:mint("DOPE"),token_y:mint("SOL"),tvl:500000});
 const fee=pool({pool_config:{base_fee_pct:3}});
 assert.equal(chooseMeteora([pair,fee],now),null);
});
test("Huge fee-to-TVL outlier is not independently verified net opportunity",()=>{
 const p=pool({fees:{"30m":2000,"1h":4000,"4h":16000,"24h":24000}});
 assert.equal(chooseMeteora([p],now),null);
});

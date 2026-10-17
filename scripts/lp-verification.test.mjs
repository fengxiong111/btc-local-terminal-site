import test from "node:test";
import assert from "node:assert/strict";
import {assessMerklCampaignRules,summarizeMerklRewards,
 summarizeMeteoraBins,assessMeteoraSwapQuote} from "../lp-verification-lib.js";
const t=Date.parse("2026-10-18T00:00:00Z");
const campaign={campaignId:"0xabc",startTimestamp:t/1000-86400,
 endTimestamp:t/1000+86400*4,distributionChainId:1,
 campaignStatus:{status:"SUCCESS"},distributionType:"DUTCH_AUCTION",
 rewardToken:{verified:true,price:1,symbol:"USDC"},
 params:{weightFees:8000,weightToken0:1000,weightToken1:1000,
  isOutOfRangeIncentivized:false,whitelist:[],blacklist:[]}};
test("Merkl validates live rule weights but never elevates to position eligibility",()=>{
 const x=assessMerklCampaignRules({campaigns:[campaign]},t);
 assert.equal(x.state,"RULES_VERIFIED_POSITION_UNKNOWN");
 assert.equal(x.campaigns[0].weight_fees_bps,8000);
 assert.equal(x.campaigns[0].only_in_range,true);
 assert.equal(x.eligible_position,false);
 assert.equal(x.claimable_verified,false);
});
test("Merkl fails closed on whitelist, weight sum, expiry and unpriced rewards",()=>{
 const make=c=>assessMerklCampaignRules({campaigns:[c]},t);
 assert.equal(make({...campaign,params:{...campaign.params,weightFees:9000}}).state,"BLOCKED_RULES");
 assert.equal(make({...campaign,params:{...campaign.params,whitelist:["0xabc"]}}).state,"BLOCKED_RULES");
 assert.equal(make({...campaign,endTimestamp:t/1000-1}).state,"NO_ACTIVE_PUBLIC_CAMPAIGN");
 assert.equal(make({...campaign,rewardToken:{verified:false,price:0,symbol:"POINT"}}).state,"BLOCKED_RULES");
});
test("Merkl user cumulative amount minus claimed ignores pending and never attributes campaign",()=>{
 const x=summarizeMerklRewards([{chain:{id:1},rewards:[
  {token:{symbol:"USDC",address:"0xabc"},amount:"2000000",claimed:"1500000",pending:"9000000"}
 ]}],1);
 assert.equal(x.tokens[0].claimable_raw,"500000");
 assert.equal(x.tokens[0].pending_raw,"9000000");
 assert.equal(x.campaign_attribution_verified,false);
 assert.equal(summarizeMerklRewards([{chain:{id:1},rewards:[
  {amount:"5",claimed:"6"}]}],1).state,"BLOCKED_REWARD_SCHEMA");
});
test("Meteora Bin position shares use real liquidity share, not pool TVL",()=>{
 const bins=[{binId:50,xAmount:"5000",yAmount:"6000",supply:"1000000",pricePerToken:"1"},
  {binId:49,xAmount:"10",yAmount:"0",supply:"8000",pricePerToken:"0.9"}];
 const pos={totalXAmount:"1000",totalYAmount:"1000",feeX:"17",feeY:"8",
  totalClaimedFeeXAmount:"50",totalClaimedFeeYAmount:"30",
  positionBinData:[{binId:50,positionLiquidity:"123450",binLiquidity:"1000000"}]};
 const v=summarizeMeteoraBins({binId:50,...bins[0]},bins,pos);
 assert.equal(v.position_share_state,"ACTIVE_BIN_SHARE_OBSERVED");
 assert.equal(v.position_active_bin_share_pct,12.345);
 assert.equal(v.position_balances.accrued_fee_x_raw,"17");
 assert.equal(v.fee_velocity_state,"NOT_DERIVABLE_FROM_ONE_SNAPSHOT");
 const miss=summarizeMeteoraBins({binId:50,...bins[0]},bins);
 assert.equal(miss.position_share_state,"POSITION_NOT_SUPPLIED");
 assert.equal(miss.position_active_bin_share_pct,null);
});
test("SDK single-hop quote is not LP withdrawal; partial fill is blocked",()=>{
 const q={consumedInAmount:"1000",outAmount:"900",minOutAmount:"890",fee:"10"};
 const x=assessMeteoraSwapQuote(q,"1000",{stableOutput:true});
 assert.equal(x.state,"SINGLE_HOP_STABLE_SWAP_QUOTED");
 assert.equal(x.full_lp_withdrawal_verified,false);
 assert.equal(x.route_to_stable_complete,true);
 assert.equal(assessMeteoraSwapQuote({...q,consumedInAmount:"999"},"1000").state,
  "BLOCKED_PARTIAL_FILL");
 assert.equal(assessMeteoraSwapQuote(q,"1000",{stableOutput:false}).state,
  "BLOCKED_NONSTABLE_OUTPUT");
 assert.equal(assessMeteoraSwapQuote(q,"1000",{stableOutput:true,slippageBps:200}).state,
  "BLOCKED_QUOTE_SCHEMA");
});

// Pure public-data gate. Campaign APR and pool-wide fees are never wallet net returns.
const finite=x=>typeof x==="number"&&Number.isFinite(x);
const amount=x=>{
 if(typeof x==="bigint")return x>=0n?x:null;
 if(typeof x==="number")return Number.isSafeInteger(x)&&x>=0?BigInt(x):null;
 const raw=(typeof x==="string"||x&&typeof x==="object"&&typeof x.toString==="function")
   ?String(x):"";
 return /^\d+$/.test(raw)?BigInt(raw):null;
};

export function assessMerklCampaignRules(opportunity,nowMs=Date.now()){
 const now=nowMs/1000, campaigns=Array.isArray(opportunity?.campaigns)?opportunity.campaigns:[];
 const active=campaigns.filter(c=>Number(c.startTimestamp)<=now
   && Number(c.endTimestamp)>now
   && c.isPrivate!==true&&c.hidden!==true
   && c.campaignStatus?.status==="SUCCESS");
 if(!active.length)return {state:"NO_ACTIVE_PUBLIC_CAMPAIGN",eligible_position:false,
   claimable_verified:false,active_campaigns:0};
 const ruleChecks=active.map(c=>{
  const p=c.params||{},keys=["weightFees","weightToken0","weightToken1"];
  const weights=keys.map(k=>Number(p[k]));
  const weightsValid=weights.every(Number.isInteger)&&weights.every(n=>n>=0)
    &&weights.reduce((a,b)=>a+b,0)===10000;
  const whitelist=Array.isArray(p.whitelist)?p.whitelist:[];
  const blacklist=Array.isArray(p.blacklist)?p.blacklist:[];
  const reward=c.rewardToken||{};
  const eligibleAsset=reward.verified===true && finite(Number(reward.price))&&Number(reward.price)>0;
  return {campaign_id:c.campaignId||null,
    distribution_chain_id:c.distributionChainId??null,
    start_timestamp:Number(c.startTimestamp),end_timestamp:Number(c.endTimestamp),
    reward_token:reward.symbol||null,weights_valid:weightsValid,
    weight_fees_bps:weightsValid?weights[0]:null,
    weight_token_0_bps:weightsValid?weights[1]:null,
    weight_token_1_bps:weightsValid?weights[2]:null,
    only_in_range:p.isOutOfRangeIncentivized===false,
    has_whitelist:whitelist.length>0,has_blacklist:blacklist.length>0,
    reward_verified_and_priced:eligibleAsset,
    distribution_type:c.distributionType||null,
    rules_complete:weightsValid&&typeof p.isOutOfRangeIncentivized==="boolean"
       &&eligibleAsset&&whitelist.length===0};
 });
 const complete=ruleChecks.every(x=>x.rules_complete);
 return {state:complete?"RULES_VERIFIED_POSITION_UNKNOWN":"BLOCKED_RULES",
   eligible_position:false,claimable_verified:false,
   active_campaigns:active.length,ranked_apr_not_claimable:true,campaigns:ruleChecks,
   reason:complete?"NO_POSITION_AND_FEE_WEIGHT_PROOF":"INVALID_OR_RESTRICTED_CAMPAIGN"};
}

/** Cumulative Merkl amount - already claimed, never add pending to claimable.
 *  Per-wallet claimable by token is NOT proof it came from this campaign. */
export function summarizeMerklRewards(data,chainId){
 if(!Array.isArray(data))return {state:"BLOCKED_REWARD_SCHEMA"};
 const chains=data.filter(x=>Number(x.chain?.id)===Number(chainId));
 if(!chains.length)return {state:"NO_REWARDS_ON_DISTRIBUTION_CHAIN",tokens:[]};
 const out=[];
 for(const chain of chains){
  if(!Array.isArray(chain.rewards))return {state:"BLOCKED_REWARD_SCHEMA"};
  for(const r of chain.rewards){
   const total=amount(r.amount),claimed=amount(r.claimed);
   if(total===null||claimed===null||claimed>total)return {state:"BLOCKED_REWARD_SCHEMA"};
   out.push({token:r.token?.symbol||null,token_address:r.token?.address||null,
     claimable_raw:(total-claimed).toString(),pending_raw:amount(r.pending)?.toString()??null});
  }
 }
 return {state:"WALLET_AGGREGATE_ONLY_NOT_CAMPAIGN_PROOF",tokens:out,
   campaign_attribution_verified:false};
}

/** Bin share is liquidity shares, not pool TVL share. Never use a fake position. */
export function summarizeMeteoraBins(activeBin,bins,positionData=null){
 const id=activeBin?.binId;
 if(!Number.isInteger(id)||!Array.isArray(bins))return {state:"BLOCKED_BIN_SCHEMA"};
 const active=bins.find(b=>b.binId===id)||activeBin;
 const principal=positionData?{
   x_raw:amount(positionData.totalXAmount)?.toString()??null,
   y_raw:amount(positionData.totalYAmount)?.toString()??null,
   accrued_fee_x_raw:amount(positionData.feeX)?.toString()??null,
   accrued_fee_y_raw:amount(positionData.feeY)?.toString()??null,
   claimed_fee_x_raw:amount(positionData.totalClaimedFeeXAmount)?.toString()??null,
   claimed_fee_y_raw:amount(positionData.totalClaimedFeeYAmount)?.toString()??null
 }:null;
 const rows=positionData?.positionBinData;
 let sharePct=null,shareState="POSITION_NOT_SUPPLIED";
 if(positionData){
  shareState="BLOCKED_POSITION_BIN";
  if(Array.isArray(rows)){
   const v=rows.find(x=>x.binId===id);
   if(v){
    const p=amount(v.positionLiquidity),total=amount(v.binLiquidity);
    if(p!==null&&total!==null&&total>0n&&p<=total){
     sharePct=Number(p*1000000n/total)/10000;
     shareState="ACTIVE_BIN_SHARE_OBSERVED";
    }
   }else shareState="OUTSIDE_ACTIVE_BIN";
  }
 }
 const liquidity_bins=bins.filter(b=>amount(b.supply)!==null&&amount(b.supply)>0n).length;
 return {state:"ACTIVE_BIN_OBSERVED",active_bin_id:id,
   active_price_per_token:active?.pricePerToken??null,
   active_bin_x_raw:amount(active?.xAmount)?.toString()??null,
   active_bin_y_raw:amount(active?.yAmount)?.toString()??null,
   active_bin_liquidity_raw:amount(active?.supply)?.toString()??null,
   sampled_bins:bins.length,nonempty_bins:liquidity_bins,
   position_share_state:shareState,position_active_bin_share_pct:sharePct,
   position_balances:principal,
   fee_velocity_state:"NOT_DERIVABLE_FROM_ONE_SNAPSHOT"};
}

/** SDK exact-input swapQuote is one leg, never proof of LP principal withdrawal. */
export function assessMeteoraSwapQuote(quote,inputRaw,{stableOutput=false,slippageBps=50}={}){
 const input=amount(inputRaw),consumed=amount(quote?.consumedInAmount?.toString()),
  output=amount(quote?.outAmount?.toString()),minimum=amount(quote?.minOutAmount?.toString()),
  fee=amount(quote?.fee?.toString());
 if(input===null||input===0n||consumed===null||output===null
    ||minimum===null||fee===null||!Number.isInteger(slippageBps)
    ||slippageBps<0||slippageBps>50)
   return {state:"BLOCKED_QUOTE_SCHEMA"};
 if(minimum>output)return {state:"BLOCKED_QUOTE_SCHEMA"};
 if(consumed!==input)return {state:"BLOCKED_PARTIAL_FILL",input_raw:input.toString(),
   consumed_raw:consumed.toString()};
 return {state:stableOutput?"SINGLE_HOP_STABLE_SWAP_QUOTED":"BLOCKED_NONSTABLE_OUTPUT",
   input_raw:input.toString(),output_raw:output.toString(),
   min_output_raw:minimum.toString(),fee_raw:fee.toString(),
   full_lp_withdrawal_verified:false,route_to_stable_complete:stableOutput,
   same_slot_exit_verified:false,slippage_bps:slippageBps};
}

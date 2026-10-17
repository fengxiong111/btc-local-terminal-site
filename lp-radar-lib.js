// Pure, read-only screening. Rank gross pool fees ONLY for discovery, not wallet net returns.
export const MIN_LP_TVL_USD=100000;
export const MIN_TOKEN_MARKET_CAP_USD=500000;
const num=x=>typeof x==="number"&&Number.isFinite(x)?x:null;
const f=(x,d=null)=>num(x)??d;
export function chooseMerkl(opps,nowMs=Date.now()){
 if(!Array.isArray(opps))return null;
 const now=nowMs/1000;
 return opps.flatMap(o=>{
  if(o?.status!=="LIVE"||!/^UNISWAP_V[34]$/.test(o.type)||!/^Provide liquidity/i.test(String(o.name))||f(o.tvl,0)<MIN_LP_TVL_USD)return [];
  const campaigns=(Array.isArray(o.campaigns)?o.campaigns:[]).filter(c=>
   f(c.startTimestamp,Infinity)<=now&&f(c.endTimestamp,0)>now+48*3600&&
   !c.isPrivate&&!c.hidden&&c.rewardToken?.verified===true&&f(c.rewardToken?.price,0)>0&&
   !(Array.isArray(c.params?.whitelist)&&c.params.whitelist.length>0)&&
   (!c.campaignStatus?.status||c.campaignStatus.status==="SUCCESS"));
  if(!campaigns.length||f(o.apr,0)<=0)return [];
  const end=Math.min(...campaigns.map(c=>c.endTimestamp)),days=(end-now)/86400;
  const apr=f(o.apr,0),tvl=o.tvl;
  const tokens=campaigns.flatMap(c=>[c.params?.symbolCurrency0,c.params?.symbolCurrency1]).filter(Boolean);
  const stable=tokens.some(t=>["USDC","USDT","USDG","DAI","USDS","USD₮"].includes(t));
  const score=apr*(apr>80?0.2:apr>40?0.55:1)*Math.min(1,Math.sqrt(tvl/800000))*
    Math.min(1,Math.sqrt(days/7))*(stable?1.15:0.75);
  return [{platform:"Merkl",name:o.name,opportunity_id:String(o.id),chain_id:o.chainId,
   pool_identifier:o.identifier,type:o.type,tvl_usd:tvl,incentive_apr_pct:apr,
   valid_campaign_count:campaigns.length,reward_tokens:[...new Set(campaigns.map(c=>c.rewardToken.symbol))],
   nearest_end_unix_sec:end,underlying_tokens:tokens.slice(0,2),score:Math.round(score*1e6)/1e6,
   reward_policy:{
     out_of_range_incentivized:campaigns.every(c=>c.params?.isOutOfRangeIncentivized===true),
     fee_weight_min:Math.min(...campaigns.map(c=>f(c.params?.weightFees,0))),
     fee_weight_max:Math.max(...campaigns.map(c=>f(c.params?.weightFees,0))),
     position_claimability:"UNKNOWN_NO_POSITION_OR_CAMPAIGN_PROOF"
   },
   net_edge_state:"UNKNOWN_NO_POSITION_LEVEL_FEES_OR_EXIT_QUOTE",
   status:"WATCH_NET_UNVERIFIED",missing:["underlying_pool_realized_fee_velocity","bin_tick_distribution",
    "position_eligibility","exit_quote","IL_and_inventory_cost","net_reward_after_dilution"]}];
 }).sort((a,b)=>b.score-a.score||a.opportunity_id.localeCompare(b.opportunity_id))[0]||null;
}
export function chooseMeteora(pools,nowMs=Date.now()){
 if(!Array.isArray(pools))return null;
 return pools.flatMap(p=>{
  const tvl=f(p?.tvl,0),marketCapX=f(p?.token_x?.market_cap),
    marketCapY=f(p?.token_y?.market_cap),fee24=f(p?.fees?.["24h"],0);
  // Owner's three discovery rules. Missing market cap is NOT a pass.
  // Never substitute token is_verified, liquidity/TVL ratio or high APR for market cap.
  if(p?.is_blacklisted===true || !p?.address || !p?.token_x?.address ||
    !p?.token_y?.address || !p?.token_x?.symbol || !p?.token_y?.symbol ||
    tvl<MIN_LP_TVL_USD || !(marketCapX>=MIN_TOKEN_MARKET_CAP_USD) ||
    !(marketCapY>=MIN_TOKEN_MARKET_CAP_USD) || !(fee24>0))return [];
  const ageDays=Number.isFinite(p?.created_at)?(nowMs-p.created_at)/86400000:null;
  return [{
    platform:"Meteora",name:p.name,address:p.address,
    token_mints:[p.token_x.address,p.token_y.address],
    token_symbols:[p.token_x.symbol,p.token_y.symbol],
    token_x_market_cap_usd:marketCapX,token_y_market_cap_usd:marketCapY,
    min_token_market_cap_usd:Math.min(marketCapX,marketCapY),
    tvl_usd:tvl,fee_24h_usd:fee24,
    fee_30m_usd:f(p?.fees?.["30m"]),fee_1h_usd:f(p?.fees?.["1h"]),
    fee_4h_usd:f(p?.fees?.["4h"]),volume_24h_usd:f(p?.volume?.["24h"]),
    pool_age_days:ageDays===null?null:Math.round(ageDays*10)/10,
    pool_base_fee_pct:f(p?.pool_config?.base_fee_pct),
    ranking_metric:"ABSOLUTE_POOL_FEES_24H_USD",ranking_value_usd:fee24,
    status:"WATCH_NET_UNVERIFIED",
    net_edge_state:"UNKNOWN_NO_POSITION_LEVEL_FEES_OR_EXIT_QUOTE",
    missing:["active_bin_and_tick_depth","position_fee_share",
      "realized_position_fees","exit_quote","IL_and_inventory_cost"]
  }];
 }).sort((a,b)=>b.fee_24h_usd-a.fee_24h_usd ||
   b.tvl_usd-a.tvl_usd || a.address.localeCompare(b.address))[0]||null;
}

/**
 * No public pool APR is evidence of a profitable, safely exitable LP position.
 * A production NET_EDGE candidate requires independent position-level economics:
 * net fees actually attributable to the proposed bins/ticks, claimable rewards,
 * inventory/IL cost, gas, full swap/exit quote and future-horizon comparison.
 * The public scanner does not have those facts, and must never call its leader "best".
 */
export function requirePositionNetEvidence(candidate,evidence=null){
 if(!candidate||!evidence||evidence.source!=="POSITION_LEVEL_INDEPENDENT_SIMULATION")return null;
 const fields=["expected_position_fee_usd","claimable_rewards_usd","inventory_loss_usd",
  "gas_usd","swap_slippage_usd","rebalance_usd","out_of_range_usd","exit_cost_usd"];
 if(fields.some(k=>typeof evidence[k]!=="number"||!Number.isFinite(evidence[k])||evidence[k]<0))return null;
 if(evidence.exit_route_verified!==true||evidence.eligibility_verified!==true||
    evidence.fresh_quote_age_ms>120000||evidence.fresh_quote_age_ms<0||
    !Number.isFinite(evidence.fresh_quote_age_ms))return null;
 const net=evidence.expected_position_fee_usd+evidence.claimable_rewards_usd-
   evidence.inventory_loss_usd-evidence.gas_usd-evidence.swap_slippage_usd-
   evidence.rebalance_usd-evidence.out_of_range_usd-evidence.exit_cost_usd;
 return net>0?{...candidate,net_edge_state:"SHADOW_NET_POSITIVE_UNEXECUTED",
   simulated_net_usd:Math.round(net*100)/100}:null;
}

export function assessDailyPoolPriceChange(bars){
 if(!Array.isArray(bars)||bars.length<2)return null;
 const last=[...bars].filter(b=>Number.isFinite(b?.timestamp)&&Number.isFinite(b?.close)&&b.close>0)
   .sort((a,b)=>a.timestamp-b.timestamp).slice(-2);
 if(last.length!==2)return null;
 if(last[1].timestamp-last[0].timestamp<20*3600||last[1].timestamp-last[0].timestamp>28*3600)return null;
 return Math.round((last[1].close/last[0].close-1)*10000)/100;
}


/** Provider identity is the pool/opportunity ID plus immutable underlying asset IDs.
 *  Symbols such as DOPE-SOL are not unique among real Meteora pools. */
export function sameMeteoraPoolIdentity(listed,detail){
 return !!(listed && detail && listed.address && listed.address===detail.address
  && listed.token_x?.address && listed.token_x.address===detail.token_x?.address
  && listed.token_y?.address && listed.token_y.address===detail.token_y?.address
  && listed.is_blacklisted!==true && detail.is_blacklisted!==true);
}
export function sameMerklOpportunityIdentity(listed,detail){
 return !!(listed && detail && String(listed.id)===String(detail.id)
  && listed.identifier && listed.identifier===detail.identifier
  && listed.chainId===detail.chainId && listed.type===detail.type
  && listed.status==="LIVE" && detail.status==="LIVE");
}


/**
 * Comparative *shadow* economics for one capital amount / one future horizon.
 * All values must be independent position-level estimates, not fee/TVL or headline APR.
 * This models decisions only: it cannot turn scanner public leads into an order.
 */
export function compareSameHorizonLP({ incumbent = null, candidates = [], capitalUsd, horizonHours, nowMs = Date.now() } = {}) {
  const reject = (reason) => ({status:"BLOCKED_EVIDENCE",reason,action:"NO_ACTION",
    order_permission:"ABSENT",incumbent:null,leader:null,delta_usd:null});
  if(!(capitalUsd>0) || !Number.isFinite(capitalUsd) || ![1,24,168].includes(horizonHours))
    return reject("INVALID_CAPITAL_OR_HORIZON");

  function project(entry) {
    if(!entry || typeof entry.id!=="string" || !entry.id.trim()) return null;
    const e=entry.evidence;
    if(!e || e.source!=="POSITION_LEVEL_INDEPENDENT_SIMULATION"
      || !Number.isFinite(e.observed_at_ms) || nowMs-e.observed_at_ms<0
      || nowMs-e.observed_at_ms>120000 || e.horizon_hours!==horizonHours
      || e.capital_usd!==capitalUsd || e.exit_route_verified!==true
      || e.eligibility_verified!==true || e.swap_back_to_stable_verified!==true
      || !e.pool_or_position_id || e.pool_or_position_id!==entry.id) return null;

    // Collect *different* fee channels separately, no double-counting.
    const positive=["swap_fees_usd","flash_fees_usd","claimable_rewards_usd"];
    const costs=["inventory_loss_usd","gas_usd","swap_slippage_usd",
      "rebalance_usd","out_of_range_usd","exit_cost_usd"];
    if([...positive,...costs,"migration_cost_usd"].some(k=>
      !Number.isFinite(e[k]) || e[k]<0))return null;
    const proceeds=positive.reduce((a,k)=>a+e[k],0);
    const expenses=costs.reduce((a,k)=>a+e[k],0);
    return {id:entry.id,net_usd:Math.round((proceeds-expenses)*100)/100,
      incremental_migration_cost_usd:e.migration_cost_usd,
      horizon_hours:horizonHours,capital_usd:capitalUsd};
  }

  const holding=incumbent?project(incumbent):null;
  if(incumbent&&!holding)return reject("INCUMBENT_NOT_COMPARABLE");
  const valid=(Array.isArray(candidates)?candidates:[]).map(project).filter(Boolean)
    .sort((a,b)=>b.net_usd-a.net_usd || a.id.localeCompare(b.id));
  const leader=valid[0]||null;
  if(!leader){
    return {status:"SHADOW_ONLY",action:holding?.net_usd>=0?"HOLD_REVIEW":
      holding?"EXIT_REVIEW":"CASH",order_permission:"ABSENT",
      incumbent:holding,leader:null,delta_usd:null,comparable:valid.length};
  }
  if(!holding){
    return {status:"SHADOW_ONLY",action:leader.net_usd>0?"CANARY_REVIEW":"CASH",
      order_permission:"ABSENT",incumbent:null,leader,
      delta_usd:null,comparable:valid.length};
  }
  const delta=Math.round((leader.net_usd-holding.net_usd)*100)/100;
  // User LP V3: incremental expected gain must exceed ALL migration costs twice.
  const hurdle=2*leader.incremental_migration_cost_usd;
  return {status:"SHADOW_ONLY",action:leader.net_usd>0&&delta>hurdle?
    "SWITCH_REVIEW":holding.net_usd>=0?"HOLD_REVIEW":"EXIT_REVIEW",
    order_permission:"ABSENT",incumbent:holding,leader,
    delta_usd:delta,hurdle_usd:Math.round(hurdle*100)/100,
    comparable:valid.length};
}

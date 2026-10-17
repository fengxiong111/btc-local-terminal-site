// Pure, read-only screening. Gross fees / incentive APR are never treated as net returns.
const num=x=>typeof x==="number"&&Number.isFinite(x)?x:null;
const f=(x,d=null)=>num(x)??d;
export function chooseMerkl(opps,nowMs=Date.now()){
 if(!Array.isArray(opps))return null;
 const now=nowMs/1000;
 return opps.flatMap(o=>{
  if(o?.status!=="LIVE"||!/^UNISWAP_V[34]$/.test(o.type)||!/^Provide liquidity/i.test(String(o.name))||f(o.tvl,0)<30000)return [];
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
  const tvl=f(p.tvl,0),ageDays=(nowMs-f(p.created_at,nowMs))/86400000;
  const fees=p.fees||{},vol=p.volume||{};
  const hourly=[f(fees["30m"],0)*2,f(fees["1h"],0),f(fees["4h"],0)/4,f(fees["24h"],0)/24];
  // Only recommend independently recognized token pairs; unverified Meme pools stay in raw research.
  if(p.token_x?.is_verified!==true||p.token_y?.is_verified!==true)return [];
  if(p.is_blacklisted||!p.address||!p.token_x?.symbol||!p.token_y?.symbol||
    tvl<30000||ageDays<1||f(fees["24h"],0)<50||Math.min(...hourly)<=0||f(vol["24h"],0)<10000)return [];
  const rate=Math.min(...hourly),tokens=[p.token_x.symbol,p.token_y.symbol];
  const stable=tokens.some(t=>["USDC","USDT","USDG","DAI","USDS"].includes(t));
  const major=tokens.some(t=>["SOL","BTC","WBTC","ETH","WETH"].includes(t));
  const quality=(p.token_x.is_verified&&p.token_y.is_verified)?1:0.45;
  const asset=stable&&major?1.5:stable?0.8:0.55;
  const score=rate/tvl*quality*asset*Math.min(1,Math.sqrt(tvl/200000))*
   Math.min(1,Math.sqrt(ageDays/10));
  return [{platform:"Meteora",name:p.name,address:p.address,token_symbols:tokens,tvl_usd:tvl,
   fee_30m_usd:fees["30m"],fee_1h_usd:fees["1h"],fee_4h_usd:fees["4h"],fee_24h_usd:fees["24h"],
   volume_24h_usd:vol["24h"],pool_age_days:Math.round(ageDays*10)/10,
   conservative_pool_fee_per_hour_usd:Math.round(rate*100)/100,
   gross_fee_to_tvl_24h_pct:Math.round(10000*fees["24h"]/tvl)/100,
   score:Math.round(score*1e10)/1e10,status:"WATCH_NET_UNVERIFIED",
   pool_base_fee_pct:f(p.pool_config?.base_fee_pct),
   token_metadata_verified_only:true,
   net_edge_state:"UNKNOWN_NO_POSITION_LEVEL_FEES_OR_EXIT_QUOTE",
   missing:["5m_trades","independent_trader_count","active_bin_and_tick_depth",
    "position_fee_share","realized_position_fees","exit_quote","IL_and_inventory_cost"]}];
 }).sort((a,b)=>b.score-a.score||a.address.localeCompare(b.address))[0]||null;
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

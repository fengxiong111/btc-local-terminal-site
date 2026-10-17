import { writeFile } from "node:fs/promises";
import { chooseMerkl, chooseMeteora } from "../lp-radar-lib.js";

// This public scanner discovers research leads. It cannot establish position-specific
// realized fees, complete exit costs or reward eligibility. Never label a lead "best".
const report={
  schema:"lp-radar-v2",generated_at_ms:Date.now(),read_only:true,
  merkl:{api_state:"BLOCKED_DATA",state:"BLOCKED_DATA",best:null,research_lead:null},
  meteora:{api_state:"BLOCKED_DATA",state:"BLOCKED_DATA",best:null,research_lead:null},
  comparability:"NET_EDGE_UNKNOWN"
};
const now=Date.now();
async function get(base,path) {
 const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),13000);
 try{
  const response=await fetch(base+path,{signal:ctrl.signal,headers:{Accept:"application/json","User-Agent":"lp-radar-public-v2/1"}});
  if(!response.ok){
   const body=await response.text();
   const err=new Error("HTTP_"+response.status+" "+body.slice(0,100));err.status=response.status;throw err;
  }
  return await response.json();
 } finally {clearTimeout(timer)}
}
async function merklGet(path) {
 try{return {data:await get("https://api.merkl.xyz",path),source:"primary"}}
 catch(e){
  // Only temporary transport/5xx failover, never bypass auth or rate limits.
  if(e.status&&e.status<500)throw e;
  return {data:await get("https://api.merkl.fr",path),source:"backup"};
 }
}
function economicBlockers(kind) {
 return kind==="Merkl" ? [
  "underlying_pool_realized_fee_velocity","campaign_position_eligibility",
  "fee_weighting_and_dilution","reward_token_exit_value","range_inventory_loss",
  "withdraw_and_swap_quote","gas_and_migration_cost","same_horizon_net_lower_bound"
 ] : [
  "5m_natural_trade_activity","independent_trader_count",
  "active_bin_distribution_and_fee_share","position_realized_fee_velocity",
  "IL_and_inventory_loss","withdraw_and_swap_quote","rebalance_and_gas_cost",
  "same_horizon_net_lower_bound"
 ];
}
try {
 const items=[],pages={};let backup=false;
 for(const type of ["UNISWAP_V3","UNISWAP_V4"]){
  for(let page=0;page<3;page++){
   const q=new URLSearchParams({status:"LIVE",type,page:String(page),items:"60",campaigns:"true"});
   const {data,source}=await merklGet("/v4/opportunities?"+q);
   if(!Array.isArray(data))throw new Error("MERKL_LIST_SCHEMA_INVALID");
   items.push(...data);pages[type]=(pages[type]||0)+1;backup ||= source==="backup";
   if(data.length<60)break;
  }
 }
 const distinct=[...new Map(items.map(x=>[String(x.id),x])).values()];
 let lead=chooseMerkl(distinct,now),identity_check="NOT_EVALUATED";
 if(lead){
  // Re-read the exact opportunity, not only a stale/partial ranked list.
  const r=await merklGet("/v4/opportunities/"+encodeURIComponent(lead.opportunity_id));
  backup ||= r.source==="backup";
  const detail=r.data;
  identity_check=detail && String(detail.id)===lead.opportunity_id
    && detail.identifier===lead.pool_identifier && detail.type===lead.type && detail.status==="LIVE"
    ? "MATCHED" : "MISMATCH";
  lead=identity_check==="MATCHED" ? chooseMerkl([detail],now) : null;
 }
 report.merkl={
  api_state:"PASS",state:lead?"NET_EDGE_UNKNOWN":"NO_VERIFIED_CANDIDATE",
  sampled:distinct.length,coverage:"SAMPLED_V3_V4_ONLY",types:["UNISWAP_V3","UNISWAP_V4"],
  pages,used_backup:backup,identity_check,
  // best must stay null while same-horizon, position-specific net edge is unknown.
  best:null,research_lead:lead?{...lead,status:"RESEARCH_ONLY"}:null,
  blocking_evidence:lead?economicBlockers("Merkl"):[]
 };
} catch(e){
 report.merkl={api_state:"BLOCKED_DATA",state:"BLOCKED_DATA",best:null,
  research_lead:null,error:String(e.message).slice(0,180)};
}
try {
 // Official Meteora sort key is singular "fee" (not "fees"), verified on REST.
 // This is bounded discovery, not the full pool universe.
 const paths=[
  "/pools?page=1&page_size=150&sort_by=fee_24h%3Adesc",
  "/pools?page=1&page_size=150&sort_by=fee_1h%3Adesc",
  "/pools?page=1&page_size=150&sort_by=volume_24h%3Adesc",
  "/pools?page=1&page_size=150&sort_by=tvl%3Adesc"
 ],pools=[];
 for(const path of paths){
  const result=await get("https://dlmm.datapi.meteora.ag",path);
  if(!Array.isArray(result?.data))throw new Error("METEORA_LIST_SCHEMA_INVALID");
  pools.push(...result.data);
 }
 const distinct=[...new Map(pools.map(x=>[String(x.address),x])).values()];
 let lead=chooseMeteora(distinct,now),identity_check="NOT_EVALUATED";
 if(lead){
  const detail=await get("https://dlmm.datapi.meteora.ag",
   "/pools/"+encodeURIComponent(lead.address));
  identity_check=detail?.address===lead.address && detail?.name===lead.name
    && Array.isArray([detail?.token_x,detail?.token_y])
    && detail?.is_blacklisted!==true ? "MATCHED":"MISMATCH";
  lead=identity_check==="MATCHED" ? chooseMeteora([detail],now) : null;
 }
 report.meteora={
  api_state:"PASS",state:lead?"NET_EDGE_UNKNOWN":"NO_VERIFIED_CANDIDATE",
  sampled:distinct.length,coverage:"SAMPLED_FOUR_INDEPENDENT_RANKINGS",pages:paths.length,
  window_coverage:["30m","1h","4h","24h"],identity_check,
  best:null,research_lead:lead?{...lead,status:"RESEARCH_ONLY"}:null,
  blocking_evidence:lead?economicBlockers("Meteora"):[]
 };
} catch(e){
 report.meteora={api_state:"BLOCKED_DATA",state:"BLOCKED_DATA",best:null,
  research_lead:null,error:String(e.message).slice(0,180)};
}
report.generated_at_ms=Date.now();
await writeFile("lp-opportunities.json",JSON.stringify(report,null,2)+"\n");
console.log("LP_RADAR "+JSON.stringify({
  merkl:{api:report.merkl.api_state,state:report.merkl.state,sampled:report.merkl.sampled,
    identity:report.merkl.identity_check,lead:report.merkl.research_lead?.opportunity_id,
    blockers:report.merkl.blocking_evidence?.length,error:report.merkl.error},
  meteora:{api:report.meteora.api_state,state:report.meteora.state,sampled:report.meteora.sampled,
    identity:report.meteora.identity_check,lead:report.meteora.research_lead?.address,
    blockers:report.meteora.blocking_evidence?.length,error:report.meteora.error}
}));
if(report.merkl.api_state==="BLOCKED_DATA"&&report.meteora.api_state==="BLOCKED_DATA")process.exitCode=1;

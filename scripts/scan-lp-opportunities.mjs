import { writeFile } from "node:fs/promises";
import { chooseMerkl, chooseMeteora, sameMeteoraPoolIdentity, sameMerklOpportunityIdentity } from "../lp-radar-lib.js";

const now=Date.now();
const report={schema:"lp-radar-v1",policy_version:"FEE_24H_TVL100K_MCAP500K_DISCOVERY",generated_at_ms:now,read_only:true,
  merkl:{state:"BLOCKED_DATA",best:null},meteora:{state:"BLOCKED_DATA",best:null},
  comparability:"NET_EDGE_UNKNOWN"};

async function get(base,path){
 const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),13000);
 try{
  const r=await fetch(base+path,{signal:ctrl.signal,headers:{"Accept":"application/json","User-Agent":"kindle-lp-radar-readonly/1"}});
  if(!r.ok){const body=await r.text(),err=new Error(`HTTP_${r.status}: ${body.slice(0,100)}`);err.status=r.status;throw err}
  return await r.json();
 }finally{clearTimeout(timer)}
}
async function merklGet(path){
 try{return {data:await get("https://api.merkl.xyz",path),source:"primary"}}
 catch(err){
  // Never bypass permission/rate limits. Backup only for transport errors and HTTP 5xx.
  if(err.status&&err.status<500)throw err;
  return {data:await get("https://api.merkl.fr",path),source:"backup"};
 }
}
try{
 const found=[],pages={};let backup=false;
 // Merkl REST: page=0 is empirically valid. API web guide's page=1 convention
 // conflicts with this behavior. Capture pagination, never only the first page.
 for(const type of ["UNISWAP_V3","UNISWAP_V4"]){
  for(let page=0;page<3;page++){
   const q=new URLSearchParams({status:"LIVE",type,page:String(page),items:"60",campaigns:"true"});
   const {data,source}=await merklGet("/v4/opportunities?"+q.toString());
   if(!Array.isArray(data))throw new Error("MERKL_SCHEMA_NOT_ARRAY");
   found.push(...data);pages[type]=(pages[type]||0)+1;backup ||= source==="backup";
   if(data.length<60)break;
  }
 }
 const distinct=[...new Map(found.map(x=>[String(x.id),x])).values()];
 let leader=chooseMerkl(distinct,now),identity_check="NOT_APPLICABLE";
 if(leader){
  const listed=distinct.find(x=>String(x.id)===leader.opportunity_id);
  try{
   const exact=(await merklGet("/v4/opportunities/"+encodeURIComponent(leader.opportunity_id)+"?campaigns=true")).data;
   identity_check=sameMerklOpportunityIdentity(listed,exact)?"MATCHED":"MISMATCH";
  }catch(e){identity_check="BLOCKED_RECHECK"; }
  if(identity_check!=="MATCHED")leader=null;
 }
 report.merkl={state:"NO_VERIFIED_NET_EDGE",sampled:distinct.length,identity_check,
   types:["UNISWAP_V3","UNISWAP_V4"],pages,used_backup:backup,
   best:null,research_leader:leader,
   reason:leader?"MISSING_POSITION_ELIGIBILITY_REALIZED_FEES_EXIT_AND_IL":"NO_LIVE_ELIGIBLE_POOL"};
 // A public APR is never evidence of position-level net edge.
}catch(e){report.merkl={state:"BLOCKED_DATA",best:null,error:String(e.message).slice(0,200)}}


try {
 // Scan actual highest USD 24h fee pools FIRST. Official API supports TVL
 // filter + fee_24h:desc; pagination is 1-based. No composite scores.
 const pageSize=200,maxPages=12,filter="tvl>=100000 && is_blacklisted=false";
 let leader=null,verifiedPool=null,inspected=0,sampled=0,apiTotal=null;
 let identity_check="NOT_APPLICABLE",lastPageSize=null;
 for(let page=1;page<=maxPages;page++){
  const q=new URLSearchParams({
   page:String(page),page_size:String(pageSize),sort_by:"fee_24h:desc",
   filter_by:filter
  });
  const batch=await get("https://dlmm.datapi.meteora.ag","/pools?"+q.toString());
  if(!Array.isArray(batch?.data))throw Error("METEORA_LIST_SCHEMA_INVALID");
  inspected++;sampled+=batch.data.length;
  apiTotal=Number.isInteger(batch.total)?batch.total:apiTotal;
  lastPageSize=batch.data.length;
  let remaining=batch.data;
  for(let attempt=0;attempt<5;attempt++){
   const pick=chooseMeteora(remaining,now);
   if(!pick)break;
   const detail=await get("https://dlmm.datapi.meteora.ag",
     "/pools/"+encodeURIComponent(pick.address));
   if(!sameMeteoraPoolIdentity(remaining.find(p=>p.address===pick.address),detail))
     throw Error("METEORA_EXACT_POOL_IDENTITY_MISMATCH");
   const exact=chooseMeteora([detail],now);
   if(exact){
    leader=exact;verifiedPool=detail;identity_check="MATCHED";
    break;
   }
   remaining=remaining.filter(p=>p.address!==pick.address);
   identity_check="STALE_POOL_FILTERED_OUT";
  }
  if(leader||batch.data.length<pageSize)break;
 }
 report.meteora={
  state:"NO_VERIFIED_NET_EDGE",best:null,
  fee_leader:leader,research_leader:leader,
  rank_by:"fee_24h_usd_desc",min_tvl_usd:100000,
  min_token_market_cap_usd:500000,token_market_cap_rule:"BOTH_TOKENS",
  sampled,api_total_after_tvl_filter:apiTotal,pages:inspected,
  page_size:pageSize,max_pages:maxPages,
  coverage:leader?"MAX_FEE_WITHIN_SORTED_LIVE_FILTERED_API":
    lastPageSize===pageSize?"CAPPED_SCAN_NO_ELIGIBLE_POOL":"NO_ELIGIBLE_POOL",
  identity_check,read_only:true,
  reason:leader?"POSITION_NET_RETURN_NOT_VERIFIED":
    "NO_POOL_MEETING_TVL_AND_BOTH_TOKEN_MARKET_CAP_FILTERS"
 };
 // Do not relabel pool gross fees as a wallet's realized earnings.
}catch(e){
 report.meteora={state:"BLOCKED_DATA",best:null,fee_leader:null,
  research_leader:null,error:String(e.message).slice(0,200)};
}

await writeFile("lp-opportunities.json",JSON.stringify(report,null,2)+"\n","utf8");
console.log("LP_RADAR "+JSON.stringify({
 merkl:{state:report.merkl.state,sampled:report.merkl.sampled,best:report.merkl.best?.name,
   research_leader:report.merkl.research_leader?.name,
   reward_policy:report.merkl.research_leader?.reward_policy,
   reason:report.merkl.reason,error:report.merkl.error},
 meteora:{state:report.meteora.state,sampled:report.meteora.sampled,best:report.meteora.best?.name,
   research_leader:report.meteora.research_leader?.name,
   fee_24h_usd:report.meteora.fee_leader?.fee_24h_usd,
   tvl_usd:report.meteora.fee_leader?.tvl_usd,
   min_token_market_cap_usd:report.meteora.fee_leader?.min_token_market_cap_usd,
   reason:report.meteora.reason,error:report.meteora.error}
}));
if(report.merkl.state==="BLOCKED_DATA"&&report.meteora.state==="BLOCKED_DATA")process.exitCode=1;

import { writeFile } from "node:fs/promises";
import { chooseMerkl, chooseMeteora, assessDailyPoolPriceChange, sameMeteoraPoolIdentity, sameMerklOpportunityIdentity } from "../lp-radar-lib.js";

const now=Date.now();
const report={schema:"lp-radar-v1",policy_version:"POSITION_NET_GATE_V2",generated_at_ms:now,read_only:true,
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

try{
 // Explore materially different parts of the pool universe, not merely the
 // default top-volume + top-TVL page. Official field is fee_24h (not fees_24h).
 const paths=["/pools?page=1&page_size=150",
              "/pools?page=1&page_size=150&sort_by=tvl%3Adesc",
              "/pools?page=1&page_size=150&sort_by=fee_1h%3Adesc",
              "/pools?page=1&page_size=150&sort_by=fee_24h%3Adesc"];
 const found=[];
 for(const path of paths){
  const r=await get("https://dlmm.datapi.meteora.ag",path);
  if(!Array.isArray(r?.data))throw new Error("METEORA_SCHEMA_INVALID");
  found.push(...r.data);
 }
 const distinct=[...new Map(found.map(x=>[String(x.address),x])).values()];
 let leader=chooseMeteora(distinct,now),identity_check="NOT_APPLICABLE";
 if(leader){
  const listed=distinct.find(x=>String(x.address)===leader.address);
  try{
   const exact=await get("https://dlmm.datapi.meteora.ag","/pools/"+encodeURIComponent(leader.address));
   identity_check=sameMeteoraPoolIdentity(listed,exact)?"MATCHED":"MISMATCH";
  }catch(e){identity_check="BLOCKED_RECHECK"; }
  if(identity_check!=="MATCHED")leader=null;
 }
 if(leader){
  try{
    const candles=await get("https://dlmm.datapi.meteora.ag",
      "/pools/"+encodeURIComponent(leader.address)+"/ohlcv");
    const priceMove=assessDailyPoolPriceChange(candles);
    leader.observed_1d_pool_price_change_pct=priceMove;
    leader.price_shock_vs_gross_pool_fees=priceMove===null?"UNKNOWN":
      Math.abs(priceMove)>leader.gross_fee_to_tvl_24h_pct?
        "PRICE_MOVE_LARGER_THAN_POOL_LEVEL_GROSS_FEES":"NO_POOL_LEVEL_SHOCK_FLAG";
  }catch(e){
    leader.observed_1d_pool_price_change_pct=null;
    leader.price_shock_vs_gross_pool_fees="PRICE_HISTORY_UNAVAILABLE";
  }
 }
 report.meteora={state:"NO_VERIFIED_NET_EDGE",sampled:distinct.length,identity_check,
   pages:paths.length,window_coverage:["30m","1h","4h","24h"],
   best:null,research_leader:leader,
   reason:leader?"MISSING_5M_TRADERS_ACTIVE_BIN_POSITION_FEES_EXIT_AND_IL":"NO_USABLE_POOL"};
 // We cannot infer active Bin fee share or inventory loss from pool-level gross
 // fees and TVL. Do not call a research ranking "best".
}catch(e){report.meteora={state:"BLOCKED_DATA",best:null,error:String(e.message).slice(0,200)}}

await writeFile("lp-opportunities.json",JSON.stringify(report,null,2)+"\n","utf8");
console.log("LP_RADAR "+JSON.stringify({
 merkl:{state:report.merkl.state,sampled:report.merkl.sampled,best:report.merkl.best?.name,
   research_leader:report.merkl.research_leader?.name,
   reward_policy:report.merkl.research_leader?.reward_policy,
   reason:report.merkl.reason,error:report.merkl.error},
 meteora:{state:report.meteora.state,sampled:report.meteora.sampled,best:report.meteora.best?.name,
   research_leader:report.meteora.research_leader?.name,
   price_change_1d:report.meteora.research_leader?.observed_1d_pool_price_change_pct,
   price_shock:report.meteora.research_leader?.price_shock_vs_gross_pool_fees,
   reason:report.meteora.reason,error:report.meteora.error}
}));
if(report.merkl.state==="BLOCKED_DATA"&&report.meteora.state==="BLOCKED_DATA")process.exitCode=1;

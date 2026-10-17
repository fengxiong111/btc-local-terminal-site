import { writeFile } from "node:fs/promises";
import { chooseMerkl, chooseMeteora } from "../lp-radar-lib.js";

const now=Date.now();
const report={schema:"lp-radar-v1",generated_at_ms:now,read_only:true,
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
 report.merkl={state:"PASS",sampled:distinct.length,types:["UNISWAP_V3","UNISWAP_V4"],
   pages,used_backup:backup,best:chooseMerkl(distinct,now)};
 if(!report.merkl.best)report.merkl.state="NO_VERIFIED_CANDIDATE";
}catch(e){report.merkl={state:"BLOCKED_DATA",best:null,error:String(e.message).slice(0,200)}}

try{
 const paths=["/pools?page=1&page_size=150",
              "/pools?page=1&page_size=150&sort_by=tvl%3Adesc"];
 const found=[];
 for(const path of paths){
  const r=await get("https://dlmm.datapi.meteora.ag",path);
  if(!Array.isArray(r?.data))throw new Error("METEORA_SCHEMA_INVALID");
  found.push(...r.data);
 }
 const distinct=[...new Map(found.map(x=>[String(x.address),x])).values()];
 report.meteora={state:"PASS",sampled:distinct.length,pages:paths.length,
   window_coverage:["30m","1h","4h","24h"],best:chooseMeteora(distinct,now)};
 if(!report.meteora.best)report.meteora.state="NO_VERIFIED_CANDIDATE";
}catch(e){report.meteora={state:"BLOCKED_DATA",best:null,error:String(e.message).slice(0,200)}}

await writeFile("lp-opportunities.json",JSON.stringify(report,null,2)+"\n","utf8");
console.log("LP_RADAR "+JSON.stringify({
 merkl:{state:report.merkl.state,sampled:report.merkl.sampled,best:report.merkl.best?.name,
   id:report.merkl.best?.opportunity_id,apr:report.merkl.best?.incentive_apr_pct,error:report.merkl.error},
 meteora:{state:report.meteora.state,sampled:report.meteora.sampled,best:report.meteora.best?.name,
   address:report.meteora.best?.address,fees24h:report.meteora.best?.fee_24h_usd,error:report.meteora.error}
}));
if(report.merkl.state==="BLOCKED_DATA"&&report.meteora.state==="BLOCKED_DATA")process.exitCode=1;

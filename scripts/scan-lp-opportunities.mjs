import { writeFile } from "node:fs/promises";
import { chooseMerkl, chooseMeteora } from "../lp-radar-lib.js";

const now = Date.now();
const report = {
  schema:"lp-radar-v2", generated_at_ms:now, read_only:true,
  merkl:{data_state:"BLOCKED_DATA",net_edge_state:"UNKNOWN",best:null,research_lead:null},
  meteora:{data_state:"BLOCKED_DATA",net_edge_state:"UNKNOWN",best:null,research_lead:null},
  comparability:"NET_EDGE_UNKNOWN"
};

async function get(base,path) {
  const ctrl = new AbortController(),timer=setTimeout(()=>ctrl.abort(),15000);
  try {
    const r=await fetch(base+path,{signal:ctrl.signal,headers:{
      "Accept":"application/json","User-Agent":"kindle-lp-radar-readonly/2"}});
    if(!r.ok) {
      const body=await r.text(),err=new Error(`HTTP_${r.status}: ${body.slice(0,100)}`);
      err.status=r.status;throw err;
    }
    return await r.json();
  } finally {clearTimeout(timer)}
}
async function merklGet(path) {
  try{return {data:await get("https://api.merkl.xyz",path),source:"primary"}}
  catch(err) {
    if(err.status && err.status<500)throw err; // never evade API permission/rate limits
    return {data:await get("https://api.merkl.fr",path),source:"backup"};
  }
}
try {
  const found=[],pages={};let backup=false;
  for(const type of ["UNISWAP_V3","UNISWAP_V4"]) {
    for(let page=0;page<3;page++) {
      const q=new URLSearchParams({status:"LIVE",type,page:String(page),items:"100",campaigns:"true"});
      const {data,source}=await merklGet("/v4/opportunities?"+q.toString());
      if(!Array.isArray(data))throw new Error("MERKL_SCHEMA_NOT_ARRAY");
      found.push(...data);pages[type]=(pages[type]||0)+1;backup ||= source==="backup";
      if(data.length<100)break;
    }
  }
  const distinct=[...new Map(found.map(x=>[String(x.id),x])).values()];
  // Direct swap-fee readings are absent: Merkl's incentive APR alone cannot
  // satisfy LP V3 (fees first, incentives second). Never promote a fake 'best'.
  const lead=chooseMerkl(distinct,now,{});
  report.merkl={
    data_state:"PASS",net_edge_state:"UNKNOWN",state:"NO_VERIFIED_NET_EDGE",
    sampled:distinct.length,types:["UNISWAP_V3","UNISWAP_V4"],pages,used_backup:backup,
    best:null,research_lead:lead,
    blocker:"UNDERLYING_POSITION_FEE_AND_REWARD_ELIGIBILITY_NOT_VERIFIED",
    caution:"Merkl opportunity APR only estimates incentives, not position claimability or net LP yield."
  };
} catch(e) {
  report.merkl={data_state:"BLOCKED_DATA",net_edge_state:"UNKNOWN",state:"BLOCKED_DATA",
    best:null,research_lead:null,error:String(e.message).slice(0,200)};
}
try {
  const paths = [
    "/pools?page=1&page_size=500&sort_by=tvl%3Adesc&filter_by=is_blacklisted%3Dfalse%20%26%26%20tvl%3E30000",
    "/pools?page=2&page_size=500&sort_by=tvl%3Adesc&filter_by=is_blacklisted%3Dfalse%20%26%26%20tvl%3E30000",
    "/pools?page=1&page_size=250&sort_by=volume_24h%3Adesc",
    "/pools?page=1&page_size=250&sort_by=fee_tvl_ratio_30m%3Adesc"
  ];
  const found=[];let sampledPages=0,totalFiltered=null;
  for(const path of paths) {
    const r=await get("https://dlmm.datapi.meteora.ag",path);
    if(!Array.isArray(r?.data))throw new Error("METEORA_SCHEMA_INVALID");
    found.push(...r.data);sampledPages++;
    if(path.includes("tvl%3Adesc"))totalFiltered=r.total;
    if(path.includes("page=1&page_size=500")&&r.data.length<500) {
      // page 2 is redundant; do not double count (we intentionally continue this bounded path list).
    }
  }
  const distinct=[...new Map(found.filter(x=>x?.address).map(x=>[String(x.address),x])).values()];
  let lead=chooseMeteora(distinct,now);
  if(lead){
    // Re-read the *exact* pool, not only aggregated ranking results, and reject changed identity.
    const detail=await get("https://dlmm.datapi.meteora.ag",`/pools/${encodeURIComponent(lead.address)}`);
    const p=detail?.data||detail;
    if(!p||p.address!==lead.address ||
      p.token_x?.address!==lead.token_mints[0]||p.token_y?.address!==lead.token_mints[1]||
      p.is_blacklisted||!chooseMeteora([p],now)) lead=null;
    else lead=chooseMeteora([p],now);
  }
  report.meteora={
    data_state:"PASS",net_edge_state:"UNKNOWN",state:"NO_VERIFIED_NET_EDGE",
    sampled:distinct.length,pages:sampledPages,eligible_tvl_filter_total:totalFiltered,
    window_coverage:["30m","1h","4h","24h"], best:null,research_lead:lead,
    blocker:"ACTIVE_BIN_POSITION_FEE_SHARE_AND_EXIT_QUOTE_MISSING",
    caution:"Pool-wide fees and TVL cannot establish realizable position-level net returns."
  };
} catch(e) {
  report.meteora={data_state:"BLOCKED_DATA",net_edge_state:"UNKNOWN",state:"BLOCKED_DATA",
    best:null,research_lead:null,error:String(e.message).slice(0,200)};
}
await writeFile("lp-opportunities.json",JSON.stringify(report,null,2)+"\n","utf8");
console.log("LP_RADAR "+JSON.stringify({
  merkl:{data:report.merkl.data_state,status:report.merkl.state,
    sampled:report.merkl.sampled,best:report.merkl.best,lead:report.merkl.research_lead?.name,
    error:report.merkl.error},
  meteora:{data:report.meteora.data_state,status:report.meteora.state,
    sampled:report.meteora.sampled,best:report.meteora.best,lead:report.meteora.research_lead?.name,
    error:report.meteora.error}
}));
if(report.merkl.data_state==="BLOCKED_DATA"&&report.meteora.data_state==="BLOCKED_DATA")
  process.exitCode=1;

// Public-only diagnostics for previous two candidates.
async function get(url) {
 const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),12000);
 try {
  const response=await fetch(url,{signal:ctrl.signal,headers:{Accept:"application/json"}});
  const body=await response.text();
  if(!response.ok)return {http:response.status,error:body.slice(0,120)};
  return {http:response.status,data:JSON.parse(body)};
 } catch(e) {return {error:String(e.cause?.code||e.message)}}
 finally {clearTimeout(timer)}
}
const urls={
 oldMeteora:"https://dlmm.datapi.meteora.ag/pools/J2XBZkpC7ygBQiPw2MWWCqiVJn9i44b8GwtTRoFV1ijj",
 topFees24:"https://dlmm.datapi.meteora.ag/pools?page=1&page_size=8&sort_by=fee_24h%3Adesc",
 topFees1h:"https://dlmm.datapi.meteora.ag/pools?page=1&page_size=8&sort_by=fee_1h%3Adesc",
 merklV4:"https://api.merkl.xyz/v4/opportunities?status=LIVE&type=UNISWAP_V4&page=0&items=60&campaigns=true"
};
for(const [name,url] of Object.entries(urls)) {
 const r=await get(url),o=r.data,rows=Array.isArray(o)?o:o?.data;
 if(name==="oldMeteora")console.log("AUDIT",JSON.stringify({name,http:r.http,error:r.error,keys:o?Object.keys(o):[],pool:o&&{address:o.address,name:o.name,tvl:o.tvl,created_at:o.created_at,fees:o.fees,volume:o.volume,apr:o.apr,token_x:o.token_x,token_y:o.token_y,config:o.pool_config,blacklisted:o.is_blacklisted}}));
 else if(name==="merklV4") {
  const old=Array.isArray(rows)?rows.find(x=>String(x.id)==="14902452956286592010"):null;
  console.log("AUDIT",JSON.stringify({name,http:r.http,error:r.error,n:Array.isArray(rows)?rows.length:null,found:!!old,old:old&&{id:old.id,name:old.name,type:old.type,tvl:old.tvl,apr:old.apr,totalApr:old.totalApr,nativeApr:old.nativeApr,liveCampaigns:old.liveCampaigns,identifier:old.identifier,description:old.description?.slice(0,600),campaigns:old.campaigns?.map(c=>({apr:c.apr,start:c.startTimestamp,end:c.endTimestamp,status:c.campaignStatus?.status,rewardToken:c.rewardToken?.symbol,distributionType:c.distributionType,paramsKeys:Object.keys(c.params||{}),paramsSummary:{fee:c.params?.fee,hook:c.params?.hooks,poolId:c.params?.poolId,whitelist:c.params?.whitelist}}))}}));
 } else console.log("AUDIT",JSON.stringify({name,http:r.http,error:r.error,total:o?.total,rows:Array.isArray(rows)?rows.slice(0,8).map(p=>({address:p.address,name:p.name,tvl:p.tvl,fees24:p.fees?.["24h"],fees1h:p.fees?.["1h"],fees5m:p.fees?.["5m"],volume24:p.volume?.["24h"],ageMs:Date.now()-p.created_at,verified:[p.token_x?.is_verified,p.token_y?.is_verified]})):null}));
}

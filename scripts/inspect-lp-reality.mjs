// Official public read-only API diagnostics. Never log addresses tied to users or tokens.
const urls=[
 ["merkl-actual","https://api.merkl.xyz/v4/opportunities/14902452956286592010"],
 ["merkl-list","https://api.merkl.xyz/v4/opportunities?status=LIVE&type=UNISWAP_V4&page=0&items=60&campaigns=true"],
 ["meteora-dope","https://dlmm.datapi.meteora.ag/pools/J2XBZkpC7ygBQiPw2MWWCqiVJn9i44b8GwtTRoFV1ijj"],
 ["meteora-fee-sort","https://dlmm.datapi.meteora.ag/pools?page=1&page_size=5&sort_by=fee_24h:desc"],
 ["meteora-1h-sort","https://dlmm.datapi.meteora.ag/pools?page=1&page_size=5&sort_by=fee_1h:desc"],
 ["meteora-fee-ratio-sort","https://dlmm.datapi.meteora.ag/pools?page=1&page_size=5&sort_by=fee_tvl_ratio_24h:desc"],
 ["meteora-dope-ohlcv","https://dlmm.datapi.meteora.ag/pools/J2XBZkpC7ygBQiPw2MWWCqiVJn9i44b8GwtTRoFV1ijj/ohlcv"],
 ["meteora-sol-usdc","https://dlmm.datapi.meteora.ag/pools?query=SOL-USDC&page=1&page_size=4&sort_by=fee_1h:desc"]
];
for(const [name,url] of urls){
 const ac=new AbortController(), timer=setTimeout(()=>ac.abort(),14000);
 try{
  const r=await fetch(url,{signal:ac.signal,headers:{Accept:"application/json"}});
  const str=await r.text();let j;
  try{j=JSON.parse(str)}catch{}
  const data=Array.isArray(j)?j:Array.isArray(j?.data)?j.data:null;
  const xs=data?.slice(0,5);
  const extract=x=>x?({
   name:x.name,address:x.address,id:x.id,status:x.status,apr:x.apr,totalApr:x.totalApr,
   tvl:x.tvl,liveCampaigns:x.liveCampaigns,token_x:x.token_x,token_y:x.token_y,
   created_at:x.created_at,fees:x.fees,volume:x.volume,fee_tvl_ratio:x.fee_tvl_ratio,
   keys:Object.keys(x).slice(0,85)
  }):null;
  const one=j&&!Array.isArray(j)&&!Array.isArray(j.data)?j:null;
  console.log("INSPECT "+JSON.stringify({name,http:r.status,count:data?.length,
   rootKeys:one?Object.keys(one).slice(0,85):[],single:extract(one),
   campaigns:Array.isArray(one?.campaigns)?one.campaigns.slice(0,2).map(c=>({
    id:c.id,apr:c.apr,startTimestamp:c.startTimestamp,endTimestamp:c.endTimestamp,
    rewardToken:c.rewardToken?.symbol,paramsKeys:Object.keys(c.params||{}).slice(0,50),campaignStatus:c.campaignStatus
   })):null,
   items:xs?.map((x)=>name.includes("ohlcv")?x:extract(x)),
   merklDetails:name==="merkl-list"?xs?.[0]?.campaigns?.map(c=>({id:c.id,apr:c.apr,end:c.endTimestamp,
     rewardToken:c.rewardToken?.symbol,params:c.params,distributionType:c.distributionType})):null,
   poolConfig:name==="meteora-dope"?one?.pool_config:null,
   cumMetrics:name==="meteora-dope"?one?.cumulative_metrics:null,
   error:r.ok?null:str.slice(0,200)}));
 }catch(e){console.log("INSPECT "+JSON.stringify({name,error:String(e?.message||e)}))}
 finally{clearTimeout(timer)}
}

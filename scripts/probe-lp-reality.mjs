// Probe API assumptions, public GET only; no keys, positions, trading or account info.
const probes=[
  ["meteora-volume-sort","https://dlmm.datapi.meteora.ag/pools?page=1&page_size=30&sort_by=volume_24h%3Adesc"],
  ["meteora-fee-ratio-sort","https://dlmm.datapi.meteora.ag/pools?page=1&page_size=30&sort_by=fee_tvl_ratio_30m%3Adesc"],
  ["meteora-fees-sort","https://dlmm.datapi.meteora.ag/pools?page=1&page_size=30&sort_by=fees_24h%3Adesc"],
  ["meteora-filter","https://dlmm.datapi.meteora.ag/pools?page=1&page_size=30&filter_by=is_blacklisted%3Dfalse%20%26%26%20tvl%3E100000&sort_by=tvl%3Adesc"],
  ["meteora-dope-detail","https://dlmm.datapi.meteora.ag/pools/J2XBZkpC7ygBQiPw2MWWCqiVJn9i44b8GwtTRoFV1ijj"],
  ["merkl-v4","https://api.merkl.xyz/v4/opportunities?status=LIVE&type=UNISWAP_V4&page=0&items=100&campaigns=true"]
];
const now=Date.now();const out=await Promise.all(probes.map(async ([key,url])=>{
 const ctl=new AbortController(),tm=setTimeout(()=>ctl.abort(),15000);
 try{
   const r=await fetch(url,{signal:ctl.signal,headers:{"Accept":"application/json"}});
   const body=await r.text();if(!r.ok)return {key,http:r.status,error:body.slice(0,180)};
   const v=JSON.parse(body),arr=Array.isArray(v)?v:Array.isArray(v?.data)?v.data:null;
   if(key==="meteora-dope-detail"){
    const p=Array.isArray(v?.data)?v.data[0]:v?.data||v;
    return {key,http:r.status,keys:Object.keys(p||{}),id:p.address,token_x:p.token_x,
     token_y:p.token_y,created_at:p.created_at,fees:p.fees,volume:p.volume,
     tvl:p.tvl,tags:p.tags,fee_tvl_ratio:p.fee_tvl_ratio,config:p.pool_config,
     blacklist:p.is_blacklisted,cumulative_metrics:p.cumulative_metrics};
   }
   if(key==="merkl-v4"){
     const item=arr?.find(x=>String(x.id)==="14902452956286592010");
     const result={key,http:r.status,total:arr?.length,found:!!item};
     if(item){result.op={id:item.id,name:item.name,apr:item.apr,nativeApr:item.nativeApr,
       totalApr:item.totalApr,maxApr:item.maxApr,tvl:item.tvl,liveCampaigns:item.liveCampaigns,
       identifier:item.identifier,chainId:item.chainId,action:item.action,tags:item.tags,
       campaigns:item.campaigns?.map(c=>({id:c.id,start:c.startTimestamp,end:c.endTimestamp,
         apr:c.apr,dailyRewards:c.dailyRewards,rewardToken:c.rewardToken&&
         {symbol:c.rewardToken.symbol,verified:c.rewardToken.verified,price:c.rewardToken.price},
         status:c.campaignStatus,type:c.type,params:c.params&&
         {keys:Object.keys(c.params).slice(0,40),rewardStartTimestamp:c.params.rewardStartTimestamp,
          whitelist:c.params.whitelist}}))};
     }return result;
   }
   return {key,http:r.status,total:v?.total,items:arr?.length,
     first:arr?.slice(0,4).map(p=>({name:p.name,address:p.address,tvl:p.tvl,
     fees:p.fees,volume:p.volume,age:p.created_at,
     verified:[p.token_x?.is_verified,p.token_y?.is_verified],blacklist:p.is_blacklisted}))};
 }catch(e){return {key,http:null,error:String(e?.cause?.code||e.message).slice(0,170)}}
 finally{clearTimeout(tm)}
}));
for(const row of out)console.log("REALITY "+JSON.stringify(row));

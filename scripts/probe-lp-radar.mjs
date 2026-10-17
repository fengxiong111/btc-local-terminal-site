// Diagnostic only: public GETs, no credentials, no trading operations.
const jobs = [
 ["merkl-primary-page0", "https://api.merkl.xyz/v4/opportunities?status=LIVE&page=0&items=4&campaigns=true"],
 ["merkl-primary-page1", "https://api.merkl.xyz/v4/opportunities?status=LIVE&page=1&items=4&campaigns=true"],
 ["merkl-campaigns", "https://api.merkl.xyz/v4/campaigns?status=LIVE&page=0&items=4"],
 ["merkl-mirror", "https://api.merkl.fr/v4/opportunities?status=LIVE&page=0&items=4"],
 ["meteora-pools", "https://dlmm.datapi.meteora.ag/pools?page=1&page_size=3"]
];
const results = await Promise.all(jobs.map(async ([name, url]) => {
 const ctrl = new AbortController();
 const timer = setTimeout(() => ctrl.abort(), 14000);
 const start = Date.now();
 try {
  const res = await fetch(url, {signal:ctrl.signal,headers:{"Accept":"application/json","User-Agent":"kindle-lp-radar-readonly/1"}});
  const body = await res.text();
  let obj;
  try {obj = JSON.parse(body);} catch {}
  const root = Array.isArray(obj) ? obj : (obj?.data || obj?.results || obj?.items);
  const first = Array.isArray(root) && root.length ? root[0] : null;
  const status = res.status;
  return {name,http:status,ms:Date.now()-start,ctype:res.headers.get("content-type"),
    length:body.length,rootType:Array.isArray(obj)?"array":typeof obj,
    keys:obj && !Array.isArray(obj)?Object.keys(obj).slice(0,15):[],
    listSize:Array.isArray(root)?root.length:null,
    firstKeys:first?Object.keys(first).slice(0,25):[],
    firstInfo:first?{id:first.id,name:first.name,chainId:first.chainId,type:first.type,
      status:first.status,apr:first.apr,tvl:first.tvl,
      symbol:first.symbol,fee_24h:first.fee_24h,volume_24h:first.volume_24h}:null,
    error:res.ok?null:body.slice(0,250)};
 } catch(e) {
  return {name,http:null,ms:Date.now()-start,error:String(e?.cause?.code||e?.message||e).slice(0,170)};
 } finally {clearTimeout(timer);}
}));
for(const r of results) console.log("PROBE "+JSON.stringify(r));
if(results.filter(x=>x.http===200).length===0) process.exitCode=1;

/* BTC one-winner display; Binance public data, no keys/orders. */
(function(){
  "use strict";
  var ROOT="https://raw.githubusercontent.com/fengxiong111/btc-local-terminal-site/main/best-option.json";
  var snapshots={github:null,browser:null};
  var scanError="";
  var scanning=false;
  var lastAttemptAt=0;
  var retryAfter=0;
  var MAX_AGE=25*60*1000;
  var diagnostics={source:"none",browserScan:"PENDING",lastError:"",lastScanAt:0};
  window.__BEST_OPTION_DIAGNOSTICS__=diagnostics;

  function isFresh(x){
    var ts=Date.now();
    return !!(x && x.schema==="tce-best-option-v1" &&
      Number.isFinite(x.generated_at_ms) && x.generated_at_ms>0 &&
      x.generated_at_ms<=ts+60000 && ts-x.generated_at_ms<MAX_AGE &&
      Number.isFinite(x.expires_at_ms) && x.expires_at_ms>ts);
  }
  function chosen(){
    var candidates=[snapshots.github,snapshots.browser].filter(isFresh);
    // A fresh BLOCKED_DATA receipt from a geo-blocked GitHub runner must
    // never suppress a separately verified fresh browser SHADOW candidate.
    var valid=candidates.filter(function(x){
      return x.state==="SHADOW" && x.candidate && x.candidate.expiry_ms>Date.now();
    });
    var ranked=valid.length?valid:candidates;
    ranked.sort(function(a,b){return b.generated_at_ms-a.generated_at_ms;});
    return ranked[0]||null;
  }
  function render(){
    var root=document.getElementById("best-option-card");
    if(!root) return;
    var name=root.querySelector("[data-option-name]");
    var expiry=root.querySelector("[data-option-date]");
    if(!name||!expiry)return;
    var best=chosen(),c=best&&best.candidate;
    var valid=best&&best.state==="SHADOW"&&c&&c.expiry_ms>Date.now()&&
      Number.isFinite(c.call_strike)&&Number.isFinite(c.put_strike);
    if(valid){
      var d=new Date(c.expiry_ms);
      name.textContent=String(c.call_strike)+"C / "+String(c.put_strike)+"P";
      expiry.textContent=String(d.getUTCMonth()+1).padStart(2,"0")+
        "/"+String(d.getUTCDate()).padStart(2,"0");
      root.dataset.marketState="live";
      diagnostics.source=best.source||"github";
      root.title="筛选第一候选，不代表已证明正期望或允许交易";
      return;
    }
    name.textContent="CASH";
    if(best){
      expiry.textContent=best.state==="BLOCKED_DATA"?
        (scanError || (/451/.test(best.reason||"") ? "服务端地区限制(451)" : "行情受阻")):
        best.state==="NO_FEASIBLE_CANDIDATE"?"暂无合格组合":"证据未通过";
    }else if(scanning){
      expiry.textContent="扫描期权行情…";
    }else if(scanError){
      expiry.textContent=scanError;
    }else{
      expiry.textContent="尚无有效报价";
    }
    root.dataset.marketState="stale";
  }
  window.__BEST_OPTION_RENDER__=render;

  async function getJson(url,timeout=8000){
    var controller=new AbortController();
    var timer=setTimeout(function(){controller.abort();},timeout);
    try{
      var r=await fetch(url,{cache:"no-store",mode:"cors",signal:controller.signal});
      if(!r.ok)throw Error("HTTP "+r.status);
      return await r.json();
    }finally{clearTimeout(timer);}
  }
  async function readGithub(){
    try{
      var x=await getJson(ROOT+"?t="+Math.floor(Date.now()/120000),7000);
      if(isFresh(x)){x.source="github";snapshots.github=x;render();return;}
    }catch(e){}
    // API supports reading latest branch file when raw.githubusercontent is cached.
    try{
      var url="https://api.github.com/repos/fengxiong111/btc-local-terminal-site/contents/best-option.json?ref=main&t="+Math.floor(Date.now()/120000);
      var env=await getJson(url,7000);
      if(!env || env.encoding!=="base64" || !env.content)return;
      var bytes=Uint8Array.from(atob(env.content.replace(/\s/g,"")),function(x){return x.charCodeAt(0);});
      var json=JSON.parse(new TextDecoder().decode(bytes));
      if(isFresh(json)){json.source="github";snapshots.github=json;render();}
    }catch(e){}
  }
  async function directScan(){
    if(scanning || Date.now()<retryAfter || Date.now()-lastAttemptAt<5*60*1000){render();return;}
    lastAttemptAt=Date.now();scanning=true;scanError="";render();
    const roots={BINANCE:"https://eapi.binance.com/eapi/v1/",
      OKX:"https://www.okx.com/api/v5/",DERIBIT:"https://www.deribit.com/api/v2/"};
    try {
      const mod=await import("./best-option-venues.mjs");
      const core=await import("./best-option-core.mjs");
      var rv=null;
      try{
        const hist=await getJson(roots.OKX+"market/history-candles?instId=BTC-USDT&bar=1D&limit=36");
        const bars=hist.code==="0" && Array.isArray(hist.data)?
          hist.data.filter(x=>String(x[8])==="1").sort((a,b)=>Number(a[0])-Number(b[0])):[];
        var computed=[7,14,30].map(x=>core.annualizedRv(bars,x));
        if(computed.every(x=>Number.isFinite(x)&&x>0))rv=computed;
      }catch(e){}
      async function attempt(venue){
        var root=roots[venue],adapter;
        if(venue==="OKX"){
          const [instruments,tickers,greeks,index]=await Promise.all([
            getJson(root+"public/instruments?instType=OPTION&instFamily=BTC-USD"),
            getJson(root+"market/tickers?instType=OPTION&instFamily=BTC-USD"),
            getJson(root+"public/opt-summary?instFamily=BTC-USD"),
            getJson(root+"market/index-tickers?instId=BTC-USD")]);
          adapter=mod.normalizeOKX({instruments,tickers,greeks,index},Date.now());
        }else if(venue==="DERIBIT"){
          const [instruments,summaries]=await Promise.all([
            getJson(root+"public/get_instruments?currency=BTC&kind=option&expired=false"),
            getJson(root+"public/get_book_summary_by_currency?currency=BTC&kind=option")]);
          adapter=mod.normalizeDeribit({instruments,summaries},Date.now());
        }else {
          const [exchangeInfo,marks,tickers,index]=await Promise.all([
            getJson(root+"exchangeInfo"),getJson(root+"mark"),
            getJson(root+"ticker"),getJson(root+"index?underlying=BTCUSDT")]);
          adapter=mod.normalizeBinance({exchangeInfo,marks,tickers,index});
        }
        const pairs=mod.rankVenue(adapter,rv,Date.now()).slice(0,3),passed=[],cache=new Map();
        async function depth(symbol){
          if(cache.has(symbol))return cache.get(symbol);
          var url=venue==="OKX"?
            root+"market/books?instId="+encodeURIComponent(symbol)+"&sz=10":
            venue==="DERIBIT"?
            root+"public/get_order_book?instrument_name="+encodeURIComponent(symbol)+"&depth=10":
            root+"depth?symbol="+encodeURIComponent(symbol)+"&limit=10";
          var json=await getJson(url,7000);
          var book=venue==="OKX"?mod.normalizeOKXBook(json,adapter.spot):
            venue==="DERIBIT"?mod.normalizeDeribitBook(json,adapter.spot):
            mod.normalizeBinanceBook(json);
          cache.set(symbol,book);return book;
        }
        for(const pair of pairs){
          try{
            const books=await Promise.all([depth(pair.call.symbol),depth(pair.put.symbol)]);
            const valid=mod.verifyVenuePair(pair,books[0],books[1],Date.now());
            if(valid)passed.push(valid);
          }catch(e){if(/HTTP (418|429)/.test(String(e)))throw e;}
        }
        return passed;
      }
      var names=["OKX","DERIBIT","BINANCE"];
      var outcomes=await Promise.allSettled(names.map(x=>attempt(x)));
      var candidates=[],errors=[];
      for(var i=0;i<outcomes.length;i++){
        if(outcomes[i].status==="fulfilled")candidates.push(...outcomes[i].value);
        else errors.push(names[i]+": "+String(outcomes[i].reason));
      }
      var winner=mod.chooseAcrossVenues(candidates,snapshots.browser);
      var snap=mod.snapshotFromVenues(winner,Date.now(),candidates.length,rv,
        {venues_checked:names,venues_responded:names.filter((x,i)=>outcomes[i].status==="fulfilled")});
      if(outcomes.every(x=>x.status==="rejected"))snap.state="BLOCKED_DATA";
      snap.source="browser-multi-venue";
      snapshots.browser=snap;diagnostics.browserScan=snap.state;
      diagnostics.lastScanAt=Date.now();diagnostics.lastError=errors.join("; ");
      scanError=errors.length===names.length?"所有公开接口不可达":"";
      if(errors.some(x=>/HTTP (418|429)/.test(x)))retryAfter=Date.now()+30*60*1000;
    }catch(error){
      diagnostics.browserScan="BLOCKED_DATA";diagnostics.lastError=String(error);
      scanError="多交易所行情受阻";
    }finally{scanning=false;render();}
  }
  async function refresh(){
    await readGithub();
    // Even if GitHub holds a previously published snapshot, independently
    // rescan when it becomes older than five minutes. No ChatGPT is involved.
    var githubAge=snapshots.github?Date.now()-snapshots.github.generated_at_ms:Infinity;
    if(!isFresh(snapshots.github) || snapshots.github.state!=="SHADOW" ||
       githubAge>5*60*1000) await directScan();
    else render();
  }
  refresh();
  window.setInterval(refresh,5*60*1000);
  document.addEventListener("visibilitychange",function(){if(!document.hidden)refresh();});
})();
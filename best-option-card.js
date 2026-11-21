/* BTC one-winner display; Binance public data, no keys/orders. */
(function(){
  "use strict";
  var ROOT="https://raw.githubusercontent.com/fengxiong111/btc-local-terminal-site/main/best-option.json";
  var snapshots={github:null,browser:null};
  var scanError="";
  var scanning=false;
  var lastAttemptAt=0;
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
    candidates.sort(function(a,b){return b.generated_at_ms-a.generated_at_ms;});
    return candidates[0]||null;
  }
  function render(){
    var root=document.getElementById("best-option-card");
    if(!root) return;
    var name=root.querySelector("[data-option-name]");
    var expiry=root.querySelector("[data-option-date]");
    var badge=root.querySelector("[data-option-state]");
    if(!name||!expiry||!badge)return;
    var best=chosen(),c=best&&best.candidate;
    var valid=best&&best.state==="SHADOW"&&c&&c.expiry_ms>Date.now()&&
      Number.isFinite(c.call_strike)&&Number.isFinite(c.put_strike);
    if(valid){
      var d=new Date(c.expiry_ms);
      name.textContent=String(c.call_strike)+"C / "+String(c.put_strike)+"P";
      expiry.textContent=String(d.getUTCMonth()+1).padStart(2,"0")+
        "/"+String(d.getUTCDate()).padStart(2,"0")+" · SHADOW";
      badge.textContent="候选";
      root.dataset.marketState="live";
      diagnostics.source=best.source||"github";
      root.title="筛选第一候选，不代表已证明正期望或允许交易";
      return;
    }
    name.textContent="CASH";
    if(best){
      expiry.textContent=best.state==="BLOCKED_DATA"?"行情受阻":
        best.state==="NO_FEASIBLE_CANDIDATE"?"暂无合格组合":"证据未通过";
    }else if(scanning){
      expiry.textContent="扫描期权行情…";
    }else if(scanError){
      expiry.textContent=scanError;
    }else{
      expiry.textContent="尚无有效报价";
    }
    badge.textContent="只读";
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
    if(scanning || Date.now()-lastAttemptAt<5*60*1000)return;
    lastAttemptAt=Date.now();
    scanning=true;scanError="";render();
    var api="https://eapi.binance.com/eapi/v1/";
    try{
      var lib=await import("./best-option-core.mjs");
      var values=await Promise.all([
        getJson(api+"exchangeInfo"),getJson(api+"mark"),getJson(api+"ticker"),
        getJson(api+"index?underlying=BTCUSDT")
      ]);
      var info=values[0],marks=values[1],tickers=values[2],index=values[3];
      var rv=null;
      try{
        var bars=await getJson("https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=1d&limit=32",7000);
        rv=[7,14,30].map(function(days){return lib.annualizedRv(bars,days);});
      }catch(e){rv=null;}
      var list=lib.buildPairs({exchangeInfo:info,marks:marks,tickers:tickers,index:index,nowMs:Date.now(),rv:rv});
      var qualified=[];
      var depths=new Map();
      async function depth(symbol){
        if(!depths.has(symbol)){
          var d=await getJson(api+"depth?symbol="+encodeURIComponent(symbol)+"&limit=10");
          depths.set(symbol,d);
        }
        return depths.get(symbol);
      }
      // A maximum of 6 pairs, serial requests: avoid per-user IP rate spikes.
      for(var i=0;i<Math.min(list.length,6);i++){
        try{
          var pair=list[i];
          var books=await Promise.all([depth(pair.call.symbol),depth(pair.put.symbol)]);
          var vetted=lib.validateDepth(pair,books[0],books[1],Date.now());
          if(vetted)qualified.push(vetted);
        }catch(e){
          if(/HTTP (429|418|403)/.test(String(e)))throw e;
        }
      }
      var winner=lib.chooseWinner(qualified,snapshots.browser);
      var snap=lib.toSnapshot(winner,Date.now(),list.length,rv);
      snap.source="browser";
      snapshots.browser=snap;
      diagnostics.browserScan=snap.state;
      diagnostics.lastScanAt=Date.now();
      diagnostics.lastError="";
      scanError="";
    }catch(e){
      diagnostics.browserScan="BLOCKED_DATA";
      diagnostics.lastError=String(e);
      scanError=/Failed to fetch|NetworkError|Load failed|TypeError/i.test(String(e))?
        "公开接口不可达":"行情获取失败";
      // Never publish a synthetic or unverified quote on failure.
    }finally{
      scanning=false;render();
    }
  }
  function refresh(){
    readGithub();
    if(!isFresh(snapshots.github))directScan();
    else render();
  }
  refresh();
  window.setInterval(refresh,5*60*1000);
  document.addEventListener("visibilitychange",function(){if(!document.hidden)refresh();});
})();
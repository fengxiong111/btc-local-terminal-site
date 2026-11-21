(function(){
  "use strict";
  var latest=null;
  var RAW="https://raw.githubusercontent.com/fengxiong111/btc-local-terminal-site/main/best-option.json";
  var API="https://api.github.com/repos/fengxiong111/btc-local-terminal-site/contents/best-option.json?ref=main";
  function isFresh(x){
    var now=Date.now();
    return x && x.schema==="tce-best-option-v1" &&
      Number.isFinite(x.generated_at_ms) &&
      x.generated_at_ms>0 && x.generated_at_ms<=now+60000 &&
      now-x.generated_at_ms<25*60*1000 &&
      x.expires_at_ms>now;
  }
  function render(){
    var root=document.getElementById("best-option-card");
    if(!root) return;
    var name=root.querySelector("[data-option-name]");
    var date=root.querySelector("[data-option-date]");
    var badge=root.querySelector("[data-option-state]");
    var fresh=isFresh(latest), c=fresh&&latest.candidate;
    var valid=c && latest.state==="SHADOW" && c.expiry_ms>Date.now();
    if(!valid){
      name.textContent="CASH";
      date.textContent=!latest?"数据源不可达":
        latest.generated_at_ms===0?"扫描尚未运行":
        !fresh?"快照已过期":
        latest.state==="BLOCKED_DATA"?"行情受阻":"暂无合格组合";
      badge.textContent="只读";
      root.dataset.marketState="stale";
      return;
    }
    name.textContent=String(c.call_strike)+"C / "+String(c.put_strike)+"P";
    var d=new Date(c.expiry_ms);
    date.textContent=String(d.getUTCMonth()+1).padStart(2,"0")+"/"+String(d.getUTCDate()).padStart(2,"0")+" · SHADOW";
    badge.textContent="候选";
    root.dataset.marketState="live";
    root.title="研究第一候选，不代表正期望或实盘授权";
  }
  window.__BEST_OPTION_RENDER__=render;
  async function getJson(url){
    var resp=await fetch(url,{cache:"no-store",mode:"cors"});
    if(!resp.ok) throw new Error("HTTP "+resp.status);
    return await resp.json();
  }
  async function githubApiSnapshot(){
    var envelope=await getJson(API+"&t="+Math.floor(Date.now()/120000));
    if(envelope.encoding!=="base64" || !envelope.content) throw Error("Invalid GitHub API response");
    var ascii=atob(envelope.content.replace(/\s/g,""));
    var bytes=Uint8Array.from(ascii,function(char){return char.charCodeAt(0);});
    return JSON.parse(new TextDecoder().decode(bytes));
  }
  async function load(){
    var raw=null,api=null,local=null;
    try{raw=await getJson(RAW+"?t="+Math.floor(Date.now()/120000));}catch(e){}
    if(isFresh(raw)){latest=raw;render();return;}
    try{api=await githubApiSnapshot();}catch(e){}
    if(isFresh(api)){latest=api;render();return;}
    try{local=await getJson("./best-option.json?t="+Date.now());}catch(e){}
    latest=api||raw||local||null;
    render();
  }
  load();
  window.setInterval(load,120000);
  document.addEventListener("visibilitychange",function(){if(!document.hidden)load();});
})();
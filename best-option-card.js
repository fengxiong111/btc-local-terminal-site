(function(){
  'use strict';
  var latest=null;
  function render() {
    var root=document.getElementById('best-option-card');
    if(!root) return;
    var name=root.querySelector('[data-option-name]');
    var date=root.querySelector('[data-option-date]');
    var badge=root.querySelector('[data-option-state]');
    var now=Date.now();
    var good=latest && latest.schema==='tce-best-option-v1' &&
      typeof latest.generated_at_ms==='number' && now>=latest.generated_at_ms-60000 &&
      now-latest.generated_at_ms<25*60*1000 && latest.expires_at_ms>now;
    var valid=good && latest.candidate && latest.state==='SHADOW' &&
      latest.candidate.expiry_ms>now;
    if(!valid) {
      name.textContent='CASH';
      date.textContent=!good?'数据未更新':latest?.state==='BLOCKED_DATA'?'行情受阻':'暂无合格组合';
      badge.textContent='只读';
      root.dataset.marketState='stale';
      return;
    }
    var c=latest.candidate;
    name.textContent=String(c.call_strike)+'C / '+String(c.put_strike)+'P';
    var d=new Date(c.expiry_ms);
    var month=String(d.getUTCMonth()+1).padStart(2,'0');
    var day=String(d.getUTCDate()).padStart(2,'0');
    date.textContent=month+'/'+day+' · CASH';
    badge.textContent='候选';
    root.dataset.marketState='live';
    root.title='仅为实时筛选最优候选，不代表已验证正期望或允许交易';
  }
  window.__BEST_OPTION_RENDER__=render;
  function refresh(){
    fetch('./best-option.json?t='+Date.now(),{cache:'no-store'}).then(function(r){
      if(!r.ok) throw Error('HTTP '+r.status);
      return r.json();
    }).then(function(j){
      latest=j; render();
    }).catch(function(){latest=null;render();});
  }
  refresh();
  window.setInterval(refresh,60000);
  document.addEventListener('visibilitychange',function(){if(!document.hidden) refresh();});
})();

// ── RECENT ACTIVITY ──────────────────────────────────────────
function activitySentiment(score){
  score=Number(score||0);
  if(score>=9)return {emoji:'😍',word:'loved'};
  if(score>=7.5)return {emoji:'🙂',word:'liked'};
  if(score>=6)return {emoji:'😐',word:'felt meh about'};
  if(score>=4)return {emoji:'😕',word:'disliked'};
  return {emoji:'😭',word:'hated'};
}
function formatActivityDate(value){
  const raw=String(value||'').trim();
  if(!raw)return '';
  const iso=raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if(iso){
    const months=['January','February','March','April','May','June','July','August','September','October','November','December'];
    const month=months[Number(iso[2])-1];
    if(month)return month+' '+Number(iso[3])+', '+iso[1];
  }
  const parsed=new Date(raw);
  if(Number.isNaN(parsed.getTime()))return raw;
  return parsed.toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'});
}
async function loadRecentActivity(){
  const wrap=document.getElementById('recent-activity-list');if(!wrap)return;
  wrap.innerHTML='<div class="stats-loading">Loading recent ratings...</div>';
  const timeout=new Promise((_,reject)=>window.setTimeout(()=>reject(new Error('Activity timed out')),10000));
  try{
    const data=await Promise.race([apiCall('getRecentActivity',{token:getSessionToken()}),timeout]);
    const rows=data.rows||[];
    if(!rows.length){wrap.innerHTML='<div class="stats-empty">No recent activity is available yet.</div>';return;}
    wrap.innerHTML=rows.map(function(r){
      const s=activitySentiment(r.score10);
      const categoryInfo=r.category==='restaurant'
        ? {label:'Le Guide',emoji:'🍽️'}
        : (r.category==='tv'?{label:'TV',emoji:'📺'}:{label:'Film',emoji:'🎬'});
      return '<div class="activity-item"><div class="activity-emoji">'+s.emoji+'</div><div class="activity-main"><div class="activity-line"><strong>'+escHtml(r.user||'Someone')+'</strong> '+s.word+' <span class="activity-title-name">'+escHtml(r.title||'')+'</span></div><div class="activity-meta">'+categoryInfo.emoji+' '+escHtml(categoryInfo.label)+' · '+escHtml(formatActivityDate(r.displayDate||r.date||r.timestamp||''))+'</div></div><div class="activity-score">'+Number(r.score10||0).toFixed(1)+'<span>/10</span></div></div>';
    }).join('');
  }catch(e){wrap.innerHTML='<div class="stats-empty">Recent activity took too long to load. <button type="button" class="activity-retry" id="activity-retry">Retry</button></div>';document.getElementById('activity-retry')?.addEventListener('click',loadRecentActivity);}
}


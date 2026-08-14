// ── FILM RECOMMENDATIONS ─────────────────────────────────────
let recommendationMode='movie';
let recommendationSources=[];
let recommendationSessionId='';
let recommendationResults=[];
let recommendationSeenIds=[];
let recommendationAudience='me';
let groupRecommendationMembers=[];
let groupAvailableUsers=[];

function toggleRecommendationPanel(force){
  if(wishlistMode!=='film') return;
  const panel=document.getElementById('recommend-panel');
  const open=typeof force==='boolean'?force:!panel.classList.contains('open');
  panel.classList.toggle('open',open);
  if(open && !recommendationSources.length) loadRecommendationSources();
}

function currentUserName(){ return String((currentUser&&currentUser.name)||currentUser||'').trim(); }

async function setRecommendationAudience(mode){
  recommendationAudience=mode==='group'?'group':'me';
  document.getElementById('rec-audience-me').classList.toggle('active',recommendationAudience==='me');
  document.getElementById('rec-audience-group').classList.toggle('active',recommendationAudience==='group');
  document.getElementById('group-matchmaker').classList.toggle('open',recommendationAudience==='group');
  document.getElementById('personal-recommendation-modes').style.display=recommendationAudience==='group'?'none':'flex';
  document.getElementById('rec-source-wrap').style.display=recommendationAudience==='group'?'none':(recommendationMode==='movie'?'block':'none');
  const pool=document.getElementById('rec-pool');
  if(recommendationAudience==='group'){
    pool.options[0].textContent='New to Everyone';
    pool.options[1].textContent='Not Rated or Wishlisted by Anyone';
    if(!groupRecommendationMembers.length){ const me=currentUserName(); if(me) groupRecommendationMembers=[me]; }
    await loadGroupUsers();
  }else{ pool.options[0].textContent='New to Me';pool.options[1].textContent='Not Rated or Wishlisted'; }
  renderGroupMembers();
}

async function loadGroupUsers(){
  try{ const data=await apiCall('getUsers',{}); groupAvailableUsers=(data.users||[]).map(function(u){return String(u.name||u);}).filter(Boolean); renderGroupPersonMenu(); }
  catch(e){ document.getElementById('rec-status').textContent='Could not load the user list.'; }
}
function renderGroupMembers(){
  const wrap=document.getElementById('group-member-list');if(!wrap)return;
  const me=currentUserName();
  wrap.innerHTML=groupRecommendationMembers.map(function(name,index){
    const host=name.toLowerCase()===me.toLowerCase();
    return '<div class="group-member '+(host?'host':'')+'"><span>'+escHtml(name)+'</span>'+(host?'':'<button class="group-member-remove" type="button" data-member-index="'+index+'" aria-label="Remove '+escHtml(name)+'">×</button>')+'</div>';
  }).join('');
  wrap.querySelectorAll('.group-member-remove').forEach(function(btn){
    btn.addEventListener('click',function(){
      const index=Number(btn.getAttribute('data-member-index'));
      if(Number.isInteger(index)&&groupRecommendationMembers[index]) removeGroupMember(groupRecommendationMembers[index]);
    });
  });
  renderGroupPersonMenu();
}
function renderGroupPersonMenu(){
  const menu=document.getElementById('group-person-menu');if(!menu)return;
  const used={};groupRecommendationMembers.forEach(function(n){used[n.toLowerCase()]=true;});
  const available=groupAvailableUsers.filter(function(n){return !used[n.toLowerCase()];});
  menu.innerHTML=available.length?available.map(function(n,index){return '<button class="group-person-option" type="button" data-person-index="'+index+'">'+escHtml(n)+'</button>';}).join(''):'<div class="group-person-option" style="cursor:default">Everyone is already included.</div>';
  menu.querySelectorAll('.group-person-option[data-person-index]').forEach(function(btn){
    btn.addEventListener('click',function(){
      const index=Number(btn.getAttribute('data-person-index'));
      if(Number.isInteger(index)&&available[index]) addGroupMember(available[index]);
    });
  });
}
function toggleGroupPersonMenu(){document.getElementById('group-person-menu').classList.toggle('open');}
function addGroupMember(name){if(!groupRecommendationMembers.some(function(n){return n.toLowerCase()===String(name).toLowerCase();}))groupRecommendationMembers.push(String(name));document.getElementById('group-person-menu').classList.remove('open');renderGroupMembers();}
function removeGroupMember(name){groupRecommendationMembers=groupRecommendationMembers.filter(function(n){return n.toLowerCase()!==String(name).toLowerCase();});renderGroupMembers();}

function setRecommendationMode(mode){
  recommendationMode=mode==='taste'?'taste':'movie';
  document.getElementById('rec-mode-movie').classList.toggle('active',recommendationMode==='movie');
  document.getElementById('rec-mode-taste').classList.toggle('active',recommendationMode==='taste');
  document.getElementById('rec-source-wrap').style.display=(recommendationAudience==='me'&&recommendationMode==='movie')?'block':'none';
}

async function loadRecommendationSources(){
  const select=document.getElementById('rec-source');
  try{
    const data=await apiCall('getRecommendationSources',{token:getSessionToken()});
    recommendationSources=data.rows||[];
    select.innerHTML='<option value="">Choose one of your rated movies...</option>'+recommendationSources.map(function(r){
      return '<option value="'+escHtml(String(r.tmdbId||''))+'">'+escHtml(r.title+' ('+r.year+') — '+Number(r.score10).toFixed(1)+'/10')+'</option>';
    }).join('');
  }catch(e){
    document.getElementById('rec-status').textContent=e.message||'Could not load your rated movies.';
  }
}

async function generateFilmRecommendations(options){
  options=options||{};
  const btn=document.getElementById('rec-generate'),status=document.getElementById('rec-status'),results=document.getElementById('rec-results');
  const sourceTmdbId=document.getElementById('rec-source').value;
  if(recommendationAudience==='me'&&recommendationMode==='movie'&&!sourceTmdbId){status.textContent='Choose a source movie first.';return;}
  if(recommendationAudience==='group'&&groupRecommendationMembers.length<2){status.textContent='Add at least one other person to use Group Matchmaker.';return;}
  btn.disabled=true;btn.textContent='Building Recommendations...';status.textContent=recommendationAudience==='group'?'Balancing the group’s ratings and validating shared movie candidates...':'Reviewing your ratings and validating movie candidates...';results.innerHTML='';document.getElementById('rec-diagnostics').style.display='none';
  try{
    const payload={sourceMode:recommendationAudience==='group'?'group':recommendationMode,sourceTmdbId:sourceTmdbId,pool:document.getElementById('rec-pool').value,style:document.getElementById('rec-style').value,excludeTmdbIds:options.continueBatch?recommendationSeenIds:[],groupMode:recommendationAudience==='group',groupMembers:recommendationAudience==='group'?groupRecommendationMembers.slice():[]};
    const data=await apiCall('generateFilmRecommendations',{token:getSessionToken(),payload:payload});
    recommendationSessionId=data.recommendationId||'';recommendationResults=data.recommendations||[];
    if(!options.continueBatch) recommendationSeenIds=[];
    recommendationResults.forEach(function(r){if(r&&r.tmdbId&&!recommendationSeenIds.includes(String(r.tmdbId)))recommendationSeenIds.push(String(r.tmdbId));});
    status.textContent=(data.aiEnhanced?'AI jury enhanced · ':'Taste engine · ')+(data.profileSummary?.ratingCount||0)+' ratings reviewed'+(data.profileSummary?.memberCount?' across '+data.profileSummary.memberCount+' people':'');
    const diagnostics=document.getElementById('rec-diagnostics');
    const d=data.diagnostics||{};
    diagnostics.style.display='block';
    diagnostics.innerHTML='<strong>Recommendation engine:</strong> '+escHtml(d.engine|| (data.aiEnhanced?'Gemini-generated recommendations':'Deterministic fallback'))+'<br><strong>Recommendation batch:</strong> '+escHtml(String(d.validatedCount||d.candidateCount||0))+' validated movies · 5 shown · '+escHtml(String(d.backupCount||0))+' backups'+(d.aiCandidateCount?('<br><strong>AI proposals:</strong> '+escHtml(String(d.aiCandidateCount))+' movies generated for TMDB validation'):'')+(d.model?('<br><strong>AI model:</strong> '+escHtml(d.model)):'')+(d.aiError?('<br><strong>AI status:</strong> '+escHtml(d.aiError)):'');
    renderFilmRecommendations();
  }catch(e){status.textContent=e.message||'Could not generate recommendations.';}
  btn.disabled=false;btn.textContent='Generate 5 Movies';
}

function renderFilmRecommendations(){
  const wrap=document.getElementById('rec-results');
  wrap.innerHTML=recommendationResults.map(function(r,index){
    const poster=r.posterPath?'<img class="recommend-poster" src="https://image.tmdb.org/t/p/w185'+escHtml(r.posterPath)+'" alt="">':'<div class="recommend-poster"></div>';
    const meta=[r.year,(r.genres||[]).join(' · '),r.runtimeMinutes?(r.runtimeMinutes+' min'):'',r.tmdbRating?('TMDB '+r.tmdbRating):'',r.ratedScore!==''?('You rated '+Number(r.ratedScore).toFixed(1)):''].filter(Boolean).join(' · ');
    return '<div class="recommend-card" id="rec-card-'+index+'">'+poster+'<div><div class="recommend-role">'+escHtml(r.role||'Recommendation')+'</div><div class="recommend-movie">'+escHtml(r.title||'')+'</div><div class="recommend-meta">'+escHtml(meta)+'</div><div class="recommend-reason">'+escHtml(r.explanation||'')+'</div></div><div class="recommend-actions"><button class="recommend-action primary" onclick="saveRecommendationToWishlist('+index+')">'+(r.wishlisted?'On Wishlist':'Add to Wishlist')+'</button><button class="recommend-action" onclick="replaceFilmRecommendation('+index+')">Replace</button><button class="recommend-action" onclick="dismissFilmRecommendation('+index+')">Not Interested</button></div></div>';
  }).join('');
}

async function saveRecommendationToWishlist(index){
  const r=recommendationResults[index];if(!r||r.wishlisted)return;
  const status=document.getElementById('rec-status');
  try{
    const details=await apiCall('getMovieDetails',{token:getSessionToken(),id:r.tmdbId});
    await apiCall('addFutureFilm',{token:getSessionToken(),payload:details});
    await apiCall('recordRecommendationFeedback',{token:getSessionToken(),payload:{recommendationId:recommendationSessionId,recommendedTmdbId:r.tmdbId,action:'added_to_wishlist'}});
    r.wishlisted=true;status.textContent=r.title+' was added to your wishlist.';renderFilmRecommendations();await loadWishlist();
  }catch(e){status.textContent=e.message||'Could not add this movie.';}
}

async function replaceFilmRecommendation(index){
  const current=recommendationResults[index];if(!current)return;
  const status=document.getElementById('rec-status');status.textContent='Loading the next best backup...';
  try{
    const data=await apiCall('replaceFilmRecommendation',{token:getSessionToken(),payload:{recommendationId:recommendationSessionId,currentTmdbId:current.tmdbId}});
    if(data.exhausted){
      status.textContent='You reviewed all 10 movies. Generating a fresh batch...';
      await generateFilmRecommendations({continueBatch:true});
      return;
    }
    recommendationResults[index]=data.recommendation;
    if(data.recommendation&&data.recommendation.tmdbId&&!recommendationSeenIds.includes(String(data.recommendation.tmdbId)))recommendationSeenIds.push(String(data.recommendation.tmdbId));
    status.textContent='Recommendation replaced'+(data.remainingBackups!==undefined?' · '+data.remainingBackups+' backups remaining':'')+'.';renderFilmRecommendations();
  }catch(e){status.textContent=e.message||'Could not replace this recommendation.';}
}

async function dismissFilmRecommendation(index){
  const current=recommendationResults[index];if(!current)return;
  try{await apiCall('recordRecommendationFeedback',{token:getSessionToken(),payload:{recommendationId:recommendationSessionId,recommendedTmdbId:current.tmdbId,action:'not_interested'}});}catch(e){}
  replaceFilmRecommendation(index);
}


// ── TV + RESTAURANT RECOMMENDATIONS ──────────────────────────
const genericRecommendationState={
  tv:{mode:'source',sources:[],sessionId:'',results:[],seen:[]},
  restaurant:{mode:'source',sources:[],sessionId:'',results:[],seen:[]}
};
function toggleGenericRecommendationPanel(kind,force){
  const panel=document.getElementById(kind+'-recommend-panel');
  const open=typeof force==='boolean'?force:!panel.classList.contains('open');panel.classList.toggle('open',open);
  if(open&&kind==='restaurant') prepareRestaurantLocation();
  if(open&&!genericRecommendationState[kind].sources.length)loadGenericRecommendationSources(kind);
}
function setGenericRecommendationMode(kind,mode){const st=genericRecommendationState[kind];st.mode=mode==='taste'?'taste':'source';document.getElementById(kind+'-rec-mode-source').classList.toggle('active',st.mode==='source');document.getElementById(kind+'-rec-mode-taste').classList.toggle('active',st.mode==='taste');document.getElementById(kind+'-rec-source-wrap').style.display=st.mode==='source'?'block':'none';}
async function loadGenericRecommendationSources(kind){const st=genericRecommendationState[kind],select=document.getElementById(kind+'-rec-source'),status=document.getElementById(kind+'-rec-status');try{const action=kind==='tv'?'getTvRecommendationSources':'getRestaurantRecommendationSources',data=await apiCall(action,{token:getSessionToken()});st.sources=data.rows||[];select.innerHTML='<option value="">Choose one of your rated '+(kind==='tv'?'shows':'restaurants')+'...</option>'+st.sources.map(function(r){const id=kind==='tv'?r.tmdbTvId:r.placeId,title=kind==='tv'?r.title:r.name,detail=kind==='tv'?r.year:r.city;return '<option value="'+escHtml(String(id||''))+'">'+escHtml(title+(detail?' ('+detail+')':'')+' — '+Number(r.score10||0).toFixed(1)+'/10')+'</option>';}).join('');}catch(e){status.textContent=e.message||'Could not load recommendation sources.';}}
async function generateGenericRecommendations(kind,options){
  options=options||{};
  const st=genericRecommendationState[kind],btn=document.getElementById(kind+'-rec-generate'),status=document.getElementById(kind+'-rec-status'),results=document.getElementById(kind+'-rec-results'),source=document.getElementById(kind+'-rec-source').value;
  if(st.mode==='source'&&!source){status.textContent='Choose a source '+(kind==='tv'?'show':'restaurant')+' first.';return;}
  btn.disabled=true;status.textContent='Building recommendations...';results.innerHTML='';document.getElementById(kind+'-rec-diagnostics').style.display='none';
  try{
    const action=kind==='tv'?'generateTvRecommendations':'generateRestaurantRecommendations';
    const payload={sourceMode:st.mode==='taste'?'taste':'source',pool:document.getElementById(kind+'-rec-pool').value,style:document.getElementById(kind+'-rec-style').value,excludeIds:options.continueBatch?st.seen:[]};
    if(kind==='tv') payload.sourceTmdbId=source;
    else Object.assign(payload,{sourcePlaceId:source},restaurantRecommendationLocationPayload());
    const data=await apiCall(action,{token:getSessionToken(),payload});
    st.sessionId=data.recommendationId||'';st.results=data.recommendations||[];
    if(!options.continueBatch)st.seen=[];
    st.results.forEach(function(r){const id=kind==='tv'?r.tmdbTvId:r.placeId;if(id&&!st.seen.includes(String(id)))st.seen.push(String(id));});
    status.textContent='AI recommendations · '+(data.profileSummary?.ratingCount||0)+' ratings reviewed';
    const d=data.diagnostics||{},diag=document.getElementById(kind+'-rec-diagnostics');
    diag.style.display='block';
    diag.innerHTML='<strong>Recommendation engine:</strong> '+escHtml(d.engine||'Gemini')+'<br><strong>Recommendation batch:</strong> '+escHtml(String(d.validatedCount||0))+' validated · 5 shown · '+escHtml(String(d.backupCount||0))+' backups'+(d.city?'<br><strong>Location:</strong> '+escHtml(d.city):'')+(d.model?'<br><strong>AI model:</strong> '+escHtml(d.model):'');
    renderGenericRecommendations(kind);
  }catch(e){status.textContent=e.message||'Could not generate recommendations.';}
  btn.disabled=false;
}
function renderGenericRecommendations(kind){const st=genericRecommendationState[kind],wrap=document.getElementById(kind+'-rec-results');wrap.innerHTML=st.results.map(function(r,index){let media='';if(kind==='tv')media=r.posterPath?'<img class="recommend-poster" src="https://image.tmdb.org/t/p/w185'+escHtml(r.posterPath)+'" alt="">':'<div class="recommend-poster"></div>';else media='<div class="recommend-poster" style="display:flex;align-items:center;justify-content:center;font-size:30px">🍽️</div>';const title=kind==='tv'?r.title:r.name,meta=kind==='tv'?[r.year,(r.genres||[]).join(' · '),r.tmdbRating?'TMDB '+r.tmdbRating:'',r.ratedScore!==''?'You rated '+Number(r.ratedScore).toFixed(1):'']:[r.city,r.address,r.price,r.googleRating?'Google '+r.googleRating:'',r.ratedScore!==''?'You rated '+Number(r.ratedScore).toFixed(1):''];return '<div class="recommend-card">'+media+'<div><div class="recommend-role">'+escHtml(r.role||'Recommendation')+'</div><div class="recommend-movie">'+escHtml(title||'')+'</div><div class="recommend-meta">'+escHtml(meta.filter(Boolean).join(' · '))+'</div><div class="recommend-reason">'+escHtml(r.explanation||'')+'</div></div><div class="recommend-actions"><button class="recommend-action primary" onclick="saveGenericRecommendation('+JSON.stringify(kind)+','+index+')">'+(r.wishlisted?'On Wishlist':'Add to Wishlist')+'</button><button class="recommend-action" onclick="replaceGenericRecommendation('+JSON.stringify(kind)+','+index+')">Replace</button><button class="recommend-action" onclick="notInterestedGenericRecommendation('+JSON.stringify(kind)+','+index+')">Not Interested</button></div></div>';}).join('');}
async function saveGenericRecommendation(kind,index){
  const st=genericRecommendationState[kind],r=st.results[index],status=document.getElementById(kind+'-rec-status');
  if(!r||r.wishlisted)return;
  try{
    const addAction=kind==='tv'?'addFutureTv':'addFutureRestaurant';
    const addPayload=kind==='tv'
      ? {tmdbTvId:r.tmdbTvId,seriesTitle:r.title,seriesYear:r.year,posterPath:r.posterPath,genres:r.genres||[]}
      : {placeId:r.placeId,name:r.name,address:r.address,city:r.city,cuisine:r.cuisine||'',price:r.price||'',googleRating:r.googleRating||''};
    const feedbackAction=kind==='tv'?'recordTvRecommendationFeedback':'recordRestaurantRecommendationFeedback';
    const recommendedId=kind==='tv'?r.tmdbTvId:r.placeId;
    await Promise.all([
      apiCall(addAction,{token:getSessionToken(),payload:addPayload}),
      apiCall(feedbackAction,{token:getSessionToken(),payload:{recommendationId:st.sessionId,recommendedId:recommendedId,action:'added_to_wishlist'}})
    ]);
    r.wishlisted=true;wishlistCache.delete(wishlistUserCacheKey());
    status.textContent=(kind==='tv'?r.title:r.name)+' was added to your wishlist.';
    renderGenericRecommendations(kind);
    await loadWishlist(true);
  }catch(e){status.textContent=e.message||'Could not add this recommendation.';}
}
async function replaceGenericRecommendation(kind,index){const st=genericRecommendationState[kind],r=st.results[index],status=document.getElementById(kind+'-rec-status');if(!r)return;try{const action=kind==='tv'?'replaceTvRecommendation':'replaceRestaurantRecommendation',id=kind==='tv'?r.tmdbTvId:r.placeId,data=await apiCall(action,{token:getSessionToken(),payload:{recommendationId:st.sessionId,currentId:id,action:'replaced'}});if(data.exhausted){status.textContent='You reviewed all 10. Generating a fresh batch...';await generateGenericRecommendations(kind,{continueBatch:true});return;}st.results[index]=data.recommendation;const nextId=kind==='tv'?data.recommendation.tmdbTvId:data.recommendation.placeId;if(nextId&&!st.seen.includes(String(nextId)))st.seen.push(String(nextId));status.textContent='Recommendation replaced · '+data.remainingBackups+' backups remaining.';renderGenericRecommendations(kind);}catch(e){status.textContent=e.message||'Could not replace this recommendation.';}}


async function notInterestedGenericRecommendation(kind,index){
  const st=genericRecommendationState[kind],r=st.results[index],status=document.getElementById(kind+'-rec-status');if(!r)return;
  try{
    const action=kind==='tv'?'replaceTvRecommendation':'replaceRestaurantRecommendation',id=kind==='tv'?r.tmdbTvId:r.placeId;
    const data=await apiCall(action,{token:getSessionToken(),payload:{recommendationId:st.sessionId,currentId:id,action:'not_interested'}});
    if(data.exhausted){status.textContent='You reviewed all 10. Generating a fresh batch...';await generateGenericRecommendations(kind,{continueBatch:true});return;}
    st.results[index]=data.recommendation;const nextId=kind==='tv'?data.recommendation.tmdbTvId:data.recommendation.placeId;if(nextId&&!st.seen.includes(String(nextId)))st.seen.push(String(nextId));
    status.textContent='Marked not interested · '+data.remainingBackups+' backups remaining.';renderGenericRecommendations(kind);
  }catch(e){status.textContent=e.message||'Could not update this recommendation.';}
}


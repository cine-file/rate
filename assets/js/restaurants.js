// ══════════════════════════════════════════════════════════════
//  LE GUIDE — RESTAURANT RATING SYSTEM
// ══════════════════════════════════════════════════════════════

// ── LE GUIDE STATE ────────────────────────────────────────────
let lgMode = false;          // are we in Le Guide mode?
let lgQuickMode = true;      // quick rating within Le Guide
let lgCurrentPlace = null;   // selected restaurant
let lgScores = {};
let lgNotes = {};
let lgChosenScore10 = null;
let lgRatingDate = "";
let _lgRatingsCache = null;
let _lgRatingsCacheTime = 0;
let _lgStatsTab = 'my';
let _lgStatsData = { ratings: null, summary: null };

// ── MICHELIN STAR SVG ─────────────────────────────────────────
function starSVG(filled){
  const color = filled ? '#C8A45A' : 'rgba(200,164,90,0.25)';
  return `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"
      fill="${color}" stroke="${filled?'#8B6914':'rgba(200,164,90,0.2)'}" stroke-width="0.5"/>
  </svg>`;
}

function renderStars(score10){
  const stars = score10 / 2; // 0-10 → 0-5
  const full  = Math.floor(stars);
  const half  = stars - full >= 0.5 ? 1 : 0;
  const empty = 5 - full - half;
  let html = '';
  for(let i=0;i<full;i++)  html += starSVG(true);
  if(half) html += starSVG(false).replace('rgba(200,164,90,0.25)','url(#half)');
  // use half-filled SVG
  if(half){
    html = html.slice(0, html.lastIndexOf(starSVG(false).replace('rgba(200,164,90,0.25)','url(#half)')));
    html += `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <defs><linearGradient id="hg"><stop offset="50%" stop-color="#C8A45A"/><stop offset="50%" stop-color="rgba(200,164,90,0.25)"/></linearGradient></defs>
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"
        fill="url(#hg)" stroke="#8B6914" stroke-width="0.5"/></svg>`;
  }
  for(let i=0;i<empty;i++) html += starSVG(false);
  return html;
}

// ── NAV MODE SWITCH ───────────────────────────────────────────
function setLgMode(on){
  lgMode = on;
  const nav = document.getElementById('main-nav');
  const filmLinks = document.getElementById('nav-film-links');
  const lgLinks   = document.getElementById('nav-lg-links');
  if(on){
    nav.classList.add('lg-mode');
    filmLinks.style.display = 'none';
    lgLinks.style.display   = 'flex';
    document.getElementById('nav-logo-text').textContent = 'Le Guide';
  } else {
    nav.classList.remove('lg-mode');
    filmLinks.style.display = 'flex';
    lgLinks.style.display   = 'none';
    document.getElementById('nav-logo-text').textContent = 'Cine-file';
  }
}

function startRating(mode){
  if(!currentUser || !getSessionToken()){
    showLogin();
    return;
  }
  if(mode === 'restaurant'){
    CATS = RESTAURANT_CATS;
    setLgMode(true);
    updateNavUser();
    showScreen('lg-search');
    return;
  }
  if(mode === 'tv'){
    activeCategory = 'tv';
    CATS = TV_CATS;
    quickMode = true;
    document.getElementById('tv-quick-mode-toggle').checked = true;
    setLgMode(false);
    updateNavUser();
    showScreen('tv-search');
    return;
  }
  activeCategory = 'film';
  CATS = FILM_CATS;
  setLgMode(false);
  updateNavUser();
  showScreen('search');
}

function goActiveRate(){
  if(activeCategory === 'tv') showScreen('tv-search');
  else showScreen('search');
}

function goBackToActiveSearch(){
  if(activeCategory === 'tv') showScreen('tv-search');
  else showScreen('search');
}

function goActiveStats(){
  if(activeCategory === 'tv') goTvStats();
  else goStats();
}

function lgGoHome(){
  lgMode = false; lgQuickMode = true; lgCurrentPlace = null;
  const toggle = document.getElementById('lg-quick-toggle');
  if(toggle) toggle.checked = true;
  setLgMode(false);
  goHome();
}

// ── LE GUIDE SEARCH ───────────────────────────────────────────
let lgSearchTimer = null;
let lgUserLat = null, lgUserLng = null;

// Try to get user location for biasing
if(navigator.geolocation){
  navigator.geolocation.getCurrentPosition(pos=>{
    lgUserLat = pos.coords.latitude;
    lgUserLng = pos.coords.longitude;
  }, ()=>{});
}

document.addEventListener('DOMContentLoaded', ()=>{
  const inp = document.getElementById('lg-search-input');
  if(inp){
    inp.addEventListener('input', function(){
      const q = this.value.trim();
      clearTimeout(lgSearchTimer);
      if(!q){ closeLgDropdown(); return; }
      document.getElementById('lg-spinner').classList.add('visible');
      lgSearchTimer = setTimeout(()=>lgDoSearch(q), 350);
    });
    inp.addEventListener('blur', ()=>setTimeout(closeLgDropdown, 160));
  }
});

async function lgDoSearch(q){
  try{
    const body = { action:'searchRestaurants', query:q };
    if(lgUserLat) { body.lat = lgUserLat; body.lng = lgUserLng; }
    const res = await lgCall(body);
    if(res && res.results) lgRenderDropdown(res.results);
  }catch(e){ console.error('Restaurant search failed:', e); }
  document.getElementById('lg-spinner').classList.remove('visible');
}

function lgRenderDropdown(results){
  const dd = document.getElementById('lg-dropdown');
  if(!results.length){ dd.classList.remove('open'); return; }
  dd.innerHTML = results.map(r=>`
    <button class="lg-drop-item" onmousedown="lgPickPlace('${escHtml(JSON.stringify(r).replace(/'/g,"\'"))}')">
      ${r.photo ? `<img class="lg-drop-photo" src="${escHtml(r.photo)}" alt="" onerror="this.style.display='none'">` : '<div class="lg-drop-photo"></div>'}
      <div>
        <div class="lg-drop-name">${escHtml(r.name)}</div>
        <div class="lg-drop-addr">${escHtml(r.address||'')}</div>
        <div class="lg-drop-meta">${escHtml(r.cuisine||'')}${r.price?' · '+r.price:''}${r.rating?' · ⭐'+r.rating:''}</div>
      </div>
    </button>`).join('');
  dd.classList.add('open');
}

function closeLgDropdown(){ document.getElementById('lg-dropdown').classList.remove('open'); }

async function lgPickPlace(jsonStr){
  closeLgDropdown();
  let place;
  try{ place = JSON.parse(jsonStr); }catch(e){ return; }
  lgCurrentPlace = place;
  document.getElementById('lg-search-input').value = '';

  // Check already rated
  await lgCheckAlreadyRated(place);
}

function lgToggleQuick(on){ lgQuickMode = on; }

// ── LOAD RESTAURANT INTO SCORE SCREEN ─────────────────────────
function lgLoadPlace(place){
  lgCurrentPlace = place;
  lgScores = {}; lgNotes = {};

  document.getElementById('lg-score-name').textContent = place.name;
  document.getElementById('lg-score-meta').innerHTML = [
    place.address && `<span>${escHtml(place.address)}</span>`,
    place.cuisine && `<span>${escHtml(place.cuisine)}</span>`,
    place.price   && `<span>${escHtml(place.price)}</span>`,
    place.rating  && `<span>Google: ⭐${place.rating}</span>`,
  ].filter(Boolean).join(' · ');

  const photo = document.getElementById('lg-score-photo');
  if(place.photo){ photo.src=place.photo; photo.style.display='block'; }
  else photo.style.display='none';

  // Build scorer rows
  document.getElementById('lg-scorer-body').innerHTML = RESTAURANT_CATS.map(c=>`
    <tr>
      <td class="td-cat" style="color:#c8d0c0">${c.label}</td>
      <td class="tc td-wt" style="color:#8a4a4a">${Math.round(c.w*100)}%</td>
      <td class="td-prompt" style="color:#6a3a3a">${c.prompt}</td>
      <td class="tc">
        <input class="lg-score-inp" id="lg-inp-${c.id}" type="number" min="0" max="100"
          step="0.1" placeholder="—" oninput="lgUpdateTotal()"/>
      </td>
      <td class="tc td-grade" id="lg-grade-${c.id}" style="color:#4a2a2a">—</td>
      <td><textarea class="lg-note-inp" id="lg-note-${c.id}" rows="2" placeholder="Optional..."></textarea></td>
    </tr>`).join('');

  document.getElementById('lg-overall-note').value = '';
  document.getElementById('lg-total-num').textContent = '0.00';
  document.getElementById('lg-total-grade').textContent = '—';

  if(lgQuickMode){
    document.getElementById('lg-quick-name').textContent = place.name;
    document.getElementById('lg-quick-sub').textContent =
      [place.address, place.cuisine, place.price].filter(Boolean).join(' · ');
    document.getElementById('lg-quick-slider').value = 50;
    document.getElementById('lg-quick-note').value = '';
    lgUpdateQuick(50);
    showScreen('lg-quick');
  } else {
    showScreen('lg-score');
  }
}

function lgUpdateTotal(){
  RESTAURANT_CATS.forEach(c=>{
    const v = document.getElementById('lg-inp-'+c.id)?.value;
    const el = document.getElementById('lg-grade-'+c.id);
    if(v!==''&&v!==null&&!isNaN(v)){
      el.textContent=gradeFromRaw(v); el.classList.add('lg-grade-filled');
    } else { el.textContent='—'; el.classList.remove('lg-grade-filled'); }
  });
  const currentValues={};
  RESTAURANT_CATS.forEach(category=>{ currentValues[category.id]=Number(document.getElementById('lg-inp-'+category.id)?.value||0); });
  const t = weightedTotal(RESTAURANT_CATS,currentValues);
  document.getElementById('lg-total-num').textContent = t.toFixed(1);
  document.getElementById('lg-total-grade').textContent = gradeFromRaw(t);
}

// ── LE GUIDE ROUNDING ─────────────────────────────────────────
function lgGoRound(){
  RESTAURANT_CATS.forEach(c=>{
    lgScores[c.id] = Number(document.getElementById('lg-inp-'+c.id)?.value||0);
    lgNotes[c.id]  = document.getElementById('lg-note-'+c.id)?.value||'';
  });
  const raw = weightedTotal(RESTAURANT_CATS,lgScores);
  lgChosenScore10 = scoreToTenth(raw);
  const g   = grade(lgChosenScore10);
  document.getElementById('lg-round-name').textContent = lgCurrentPlace.name.toUpperCase();
  document.getElementById('lg-round-raw-num').textContent = raw.toFixed(1);
  document.getElementById('lg-round-raw-grade').textContent = g;
  document.getElementById('lg-round-options').innerHTML = `
    <div class="lg-round-opt selected">
      <div class="lg-round-num">${lgChosenScore10.toFixed(1)}</div>
      <div class="lg-round-lbl">out of 10</div>
    </div>`;
  document.getElementById('lg-round-confirm').disabled = false;
  showScreen('lg-round');
}

function lgConfirmRound(){
  if(lgChosenScore10===null) return;
  lgRatingDate = new Date().toISOString().slice(0,10);
  lgGenerateCard();
}

// ── QUICK RATING ──────────────────────────────────────────────
function lgUpdateQuick(val){
  const score = (Number(val)/10).toFixed(1);
  document.getElementById('lg-quick-display').textContent = score;
  document.getElementById('lg-quick-grade').textContent = grade(parseFloat(score));
  const pct = Number(val).toFixed(1);
  document.getElementById('lg-quick-slider').style.setProperty('--pct', pct+'%');
}

function lgSubmitQuick(){
  const val = document.getElementById('lg-quick-slider').value;
  lgChosenScore10 = Number((Number(val)/10).toFixed(1));
  lgScores = {}; lgNotes = {};
  lgRatingDate = new Date().toISOString().slice(0,10);
  document.getElementById('lg-overall-note').value = document.getElementById('lg-quick-note').value||'';
  lgGenerateCard();
}

function lgGoEditScores(){
  if(lgQuickMode) showScreen('lg-quick');
  else showScreen('lg-score');
}

// ── GENERATE CARD ─────────────────────────────────────────────
function lgGenerateCard(){
  const raw = lgQuickMode && lgChosenScore10 != null
    ? lgChosenScore10 * 10
    : weightedTotal(RESTAURANT_CATS,lgScores);
  const g   = grade(lgChosenScore10);
  const overallNote = document.getElementById('lg-overall-note')?.value||'';
  const today = new Date().toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'});
  const stars = lgChosenScore10 / 2;

  // Oval
  document.getElementById('lg-oval-stars').innerHTML = renderStars(lgChosenScore10);
  document.getElementById('lg-oval-score').textContent = lgChosenScore10.toFixed(1)+'/10';
  document.getElementById('lg-oval-grade').textContent = g;

  // Name + sub
  document.getElementById('lg-card-name').textContent = lgCurrentPlace.name;
  document.getElementById('lg-card-sub').textContent =
    [lgCurrentPlace.cuisine, lgCurrentPlace.address].filter(Boolean).join(' · ');

  // Info boxes
  const boxes = [];
  if(lgCurrentPlace.rating) boxes.push({val:'⭐ '+lgCurrentPlace.rating, lbl:'Google Rating'});
  if(lgCurrentPlace.price)  boxes.push({val:lgCurrentPlace.price, lbl:'Price Range'});
  if(lgCurrentPlace.city)   boxes.push({val:lgCurrentPlace.city, lbl:'Location'});
  document.getElementById('lg-info-boxes').innerHTML = boxes.map(b=>`
    <div class="lg-info-box">
      <div class="lg-info-box-val">${escHtml(b.val)}</div>
      <div class="lg-info-box-lbl">${b.lbl}</div>
    </div>`).join('');

  // Category table
  const tableEl = document.getElementById('lg-card-table');
  if(lgQuickMode){
    tableEl.style.display='none';
    document.getElementById('lg-card-table-body').innerHTML='';
  } else {
    tableEl.style.display='';
    document.getElementById('lg-card-table-body').innerHTML = RESTAURANT_CATS.map(c=>`
      <tr>
        <td class="lg-ct-name">${c.label}</td>
        <td class="tc lg-ct-dim">${Math.round(c.w*100)}%</td>
        <td class="tc lg-ct-score">${lgScores[c.id]||'—'}</td>
        <td class="tc lg-ct-grade">${lgScores[c.id]?gradeFromRaw(lgScores[c.id]):'—'}</td>
        <td class="lg-ct-note">${escHtml(lgNotes[c.id]||'')}</td>
      </tr>`).join('');
  }

  // Notes
  const notesEl = document.getElementById('lg-card-notes');
  if(overallNote){
    document.getElementById('lg-card-notes-body').textContent = overallNote;
    notesEl.style.display='block';
  } else notesEl.style.display='none';

  document.getElementById('lg-card-date').textContent = today;
  document.getElementById('lg-card-cuisine').textContent = lgCurrentPlace.cuisine||'';
  document.getElementById('lg-sheet-msg').textContent = '';

  showScreen('lg-result');
  lgPushToSheets(raw.toFixed(1), g, overallNote, today);
  lgLoadRankReveal();
}

// ── PUSH TO SHEETS ────────────────────────────────────────────
async function lgPushToSheets(raw100, g, overallNote, today){
  if(!CONFIG.GAS_URL) return;
  const row = {
    action: 'saveRestaurantRating',
    user:   currentUser?.name||'Unknown',
    date:   today,
    name:   lgCurrentPlace.name,
    address:lgCurrentPlace.address||'',
    city:   lgCurrentPlace.city||'',
    cuisine:lgCurrentPlace.cuisine||'',
    price:  lgCurrentPlace.price||'',
    googleRating: lgCurrentPlace.rating||'',
    score10: lgChosenScore10.toFixed(1),
    score100: lgQuickMode ? (lgChosenScore10*10).toFixed(1) : raw100,
    grade:   g,
    stars:   (lgChosenScore10/2).toFixed(1),
    food:          lgQuickMode?'':lgScores.food||'',        foodGrade:    lgQuickMode?'':gradeFromRaw(lgScores.food||0),
    value:         lgQuickMode?'':lgScores.value||'',       valueGrade:   lgQuickMode?'':gradeFromRaw(lgScores.value||0),
    service:       lgQuickMode?'':lgScores.service||'',     serviceGrade: lgQuickMode?'':gradeFromRaw(lgScores.service||0),
    atmosphere:    lgQuickMode?'':lgScores.atmosphere||'',  atmosphereGrade: lgQuickMode?'':gradeFromRaw(lgScores.atmosphere||0),
    craving:       lgQuickMode?'':lgScores.craving||'',     cravingGrade: lgQuickMode?'':gradeFromRaw(lgScores.craving||0),
    notes: overallNote,
    placeId: lgCurrentPlace.placeId||'',
  };
  await lgCall(row);
  const el = document.getElementById('lg-sheet-msg');
  el.textContent='✓ Saved to Le Guide'; el.style.color='#80d080';
  _lgRatingsCache = null;
}

// ── RANK REVEAL ───────────────────────────────────────────────
async function lgLoadRankReveal(){
  const reveal = document.getElementById('lg-rank-reveal');
  const stats  = document.getElementById('lg-rank-stats');
  reveal.style.display='none';
  if(!CONFIG.GAS_URL||!currentUser) return;
  try{
    const ratings = await lgGetRatings();
    if(!ratings||!ratings.length) return;
    const scores10 = ratings.map(r=>storedNumber(r['Score /10'])).filter(value=>value!==null).sort((a,b)=>b-a);
    const myScore  = lgChosenScore10;
    const rank     = scores10.filter(s=>s>myScore).length+1;
    const total    = scores10.length;
    const g        = grade(lgChosenScore10);
    const gCount   = ratings.filter(r=>grade(parseFloat(r['Score /10']||0))===g).length;
    stats.innerHTML=`
      <div class="rank-stat">
        <div class="rank-stat-num">#${rank}</div>
        <div class="rank-stat-lbl">Your rank out of ${total}</div>
      </div>
      <div class="rank-stat">
        <div class="rank-stat-num">${total}</div>
        <div class="rank-stat-lbl">Restaurants rated</div>
      </div>
      <div class="rank-stat">
        <div class="rank-stat-num">${gCount}</div>
        <div class="rank-stat-lbl">${g}'s given</div>
      </div>`;
    reveal.style.display='block';
  }catch(e){ console.error(e); }
}

// ── ALREADY RATED CHECK ───────────────────────────────────────
let _lgPendingPlace = null;

async function lgCheckAlreadyRated(place){
  _lgPendingPlace = place;
  if(!CONFIG.GAS_URL||!currentUser||!getSessionToken()){ lgLoadPlace(place); return; }
  try{
    const ratings = await lgGetRatings();
    const existing = (ratings||[]).find(r=>
      String(r['Name']||'').toLowerCase()===place.name.toLowerCase() &&
      String(r['Address']||'').toLowerCase()===String(place.address||'').toLowerCase()
    );
    if(existing){
      document.getElementById('lg-ar-name').textContent = place.name;
      document.getElementById('lg-ar-score').textContent = parseFloat(existing['Score /10']||0).toFixed(1);
      document.getElementById('lg-ar-grade').textContent = existing['Grade']||'—';
      document.getElementById('lg-ar-date').textContent  = existing['Date']?`Reviewed on ${existing['Date']}`:'';
      document.getElementById('lg-already-rated-modal').style.display='flex';
    } else { lgLoadPlace(place); }
  }catch(e){ lgLoadPlace(place); }
}

function closeLgAlreadyRated(){
  document.getElementById('lg-already-rated-modal').style.display='none';
  _lgPendingPlace=null;
}
function lgProceedToRate(){
  document.getElementById('lg-already-rated-modal').style.display='none';
  if(_lgPendingPlace) lgLoadPlace(_lgPendingPlace);
}

async function lgGetRatings(){
  if(_lgRatingsCache && (Date.now()-_lgRatingsCacheTime)<300000) return _lgRatingsCache;
  const data = await lgCall({action:'getRestaurantRatings'});
  if(Array.isArray(data)){ _lgRatingsCache=data; _lgRatingsCacheTime=Date.now(); }
  return data||[];
}

// ── LE GUIDE STATS ────────────────────────────────────────────
async function lgGoStats(){
  showScreen('lg-stats');
  syncScoreModeButtons();
  const content = document.getElementById('lg-stats-content');
  if(!CONFIG.GAS_URL||!currentUser||!getSessionToken()){
    content.innerHTML=`<div class="stats-empty" style="color:#6a3a3a">Log in to see your restaurant stats.</div>`;
    return;
  }
  content.innerHTML=`<div class="stats-loading" style="color:#6a3a3a">Loading...</div>`;
  try{
    const [ratingsData, summaryData] = await Promise.all([
      lgCall({action:'getRestaurantRatings'}),
      lgCall({action:'getRestaurantSummary'})
    ]);
    _lgStatsData = {ratings: ratingsData||[], summary: summaryData||null};
    populateRestaurantCuisineFilter(_lgStatsData.ratings,_lgStatsData.summary?.rows||[]);
    lgRenderCurrentTab();
  }catch(e){
    content.innerHTML=`<div class="stats-empty" style="color:#6a3a3a">Could not load data.</div>`;
  }
}

function lgSwitchTab(tab){
  _lgStatsTab = tab;
  ['my','group','h2h','individual'].forEach(t=>{
    document.getElementById('lg-tab-'+t).classList.toggle('active',t===tab);
  });
  lgRenderCurrentTab();
}

function lgRenderCurrentTab(){
  populateRestaurantCuisineFilter(_lgStatsData.ratings||[],_lgStatsData.summary?.rows||[]);
  const filteredSummary=filteredRestaurantSummary(_lgStatsData.summary);
  if(_lgStatsTab==='my')    lgRenderMyStats();
  if(_lgStatsTab==='group') renderSummaryGroupStats({
    id:'restaurant', containerId:'lg-stats-content', summary:filteredSummary, itemLabel:'Restaurants', restaurant:true,
    title:function(row){ return String(row.Name || ''); },
    meta:function(row){ return String(row.Address || ''); }
  });
  if(_lgStatsTab==='h2h')   renderSummaryH2H({
    id:'restaurant', containerId:'lg-stats-content', summary:filteredSummary, itemLabel:'Restaurants',
    title:function(row){ return String(row.Name || ''); },
    meta:function(row){ return String(row.Address || ''); }
  });
  if(_lgStatsTab==='individual') renderIndividualRatings({
    id:'restaurant', containerId:'lg-stats-content', summary:filteredSummary, itemLabel:'Restaurants',
    title:function(row){ return String(row.Name || ''); },
    meta:function(row){ return String(row.Address || ''); }
  });
}

function lgRenderMyStats(){
  const container = document.getElementById('lg-stats-content');
  const ratings   = (_lgStatsData.ratings||[]).filter(function(row){ return rowMatchesCuisine(row,_restaurantCuisine); });
  if(!ratings.length){
    container.innerHTML=`<div class="stats-empty" style="color:#6a3a3a">No restaurant ratings yet.</div><div class="stats-danger-zone"><button class="delete-rating-btn" onclick="openDeleteRating('restaurant')">Delete a Rating</button></div>`;
    return;
  }
  const avg = averageScores(ratings.map(ratingDisplayScore));
  const sorted = [...ratings].sort((a,b)=>ratingDisplayScore(b)-ratingDisplayScore(a));
  const top5=sorted.slice(0,5), recent5=[...ratings].slice(-5).reverse();
  const distributionValues=ratings.map(rawScoreForRating).filter(value=>value!==null);
  const catFields={'Food & Taste':'Food','Value':'Value','Service':'Service','Atmosphere':'Atmosphere','Craving Factor':'Craving'};
  const catAvgs={};
  Object.entries(catFields).forEach(([label,col])=>{
    const vals=ratings.map(r=>parseFloat(r[col]||0)).filter(v=>v>0);
    catAvgs[label]=vals.length?(vals.reduce((a,b)=>a+b,0)/vals.length).toFixed(1):'—';
  });
  const cuisineGroups={};
  (_lgStatsData.ratings||[]).forEach(function(r){
    const cuisine=rowCuisine(r)||'Uncategorized';
    if(!cuisineGroups[cuisine]) cuisineGroups[cuisine]=[];
    const score=ratingDisplayScore(r);
    if(Number.isFinite(score)) cuisineGroups[cuisine].push(score);
  });
  const cuisineRankings=Object.keys(cuisineGroups).map(function(cuisine){
    const values=cuisineGroups[cuisine];
    return {cuisine:cuisine,count:values.length,average:averageScores(values)};
  }).sort(function(a,b){ return b.average-a.average || b.count-a.count || a.cuisine.localeCompare(b.cuisine); });
  const restaurantRow=(r,index,ranked=true)=>`<div class="lg-film-row"><div class="lg-film-row-rank">${ranked?'#'+(index+1):''}</div><div style="flex:1"><div class="lg-film-row-title">${escHtml(String(r['Name']||''))}</div><div class="lg-film-row-sub">${escHtml(String(r['Cuisine']||''))}${r['Address']?' · '+escHtml(String(r['Address']||'').split(',')[0]):''}</div></div><div class="lg-film-row-score">${ratingDisplayScore(r).toFixed(1)}</div></div>`;
  container.innerHTML=`
    <div class="stats-section"><div class="stats-section-title" style="border-color:#3a1a1a;color:#8a4a4a">Overview — ${escHtml(currentUser.name)}</div><div class="stats-grid">
      <div class="lg-stat-card"><div class="lg-stat-card-num">${ratings.length}</div><div class="lg-stat-card-lbl">Restaurants Rated</div></div>
      <div class="lg-stat-card"><div class="lg-stat-card-num">${avg.toFixed(1)}</div><div class="lg-stat-card-lbl">Average ${scoreLabel()}</div></div>
      <div class="lg-stat-card"><div class="lg-stat-card-num">${ratingDisplayScore(sorted[0]).toFixed(1)}</div><div class="lg-stat-card-lbl">Highest</div></div>
      <div class="lg-stat-card"><div class="lg-stat-card-num">${ratingDisplayScore(sorted[sorted.length-1]).toFixed(1)}</div><div class="lg-stat-card-lbl">Lowest</div></div>
    </div></div>
    <div class="stats-section"><div class="stats-section-title" style="border-color:#3a1a1a;color:#8a4a4a">Score Distribution</div>${renderDistributionChart(distributionValues,{restaurant:true})}</div>
    <div class="stats-section"><div class="stats-section-title" style="border-color:#3a1a1a;color:#8a4a4a">Top 5 Restaurants</div>${top5.map((r,i)=>restaurantRow(r,i)).join('')}
      ${ratings.length>5?`<button class="view-all-btn" style="border-color:#3a1a1a;color:#8a4a4a" onclick="lgToggleAll(this)">View All ${ratings.length} Ratings ↓</button><div class="all-ratings-wrap" id="lg-all-wrap">${sorted.map((r,i)=>restaurantRow(r,i)).join('')}</div>`:''}
    </div>
    <div class="stats-section"><div class="stats-section-title" style="border-color:#3a1a1a;color:#8a4a4a">Recently Visited</div>${recent5.map((r,i)=>restaurantRow(r,i,false)).join('')}</div>
    <div class="stats-section"><div class="stats-section-title" style="border-color:#3a1a1a;color:#8a4a4a">Food Type Averages</div>
      ${cuisineRankings.length?cuisineRankings.map(function(item,index){ return `<div class="lg-film-row"><div class="lg-film-row-rank">#${index+1}</div><div style="flex:1"><div class="lg-film-row-title">${escHtml(item.cuisine)}</div><div class="lg-film-row-sub">${item.count} ${item.count===1?'rating':'ratings'}</div></div><div class="lg-film-row-score">${item.average.toFixed(1)}</div></div>`; }).join(''):'<div class="stats-empty">No food-type data yet.</div>'}
    </div>
    <div class="stats-section"><div class="stats-section-title" style="border-color:#3a1a1a;color:#8a4a4a">Category Averages</div><div class="cat-bars">${Object.entries(catAvgs).map(([label,val])=>`<div class="cat-bar-row"><div class="cat-bar-label" style="color:#8a6a6a">${label}</div><div class="grade-bar-track" style="background:#1a0608"><div class="lg-grade-bar-fill" style="width:${val==='—'?0:val}%"></div></div><div class="cat-bar-val" style="color:#C41E3A">${val}</div></div>`).join('')}</div></div>
    <div class="stats-danger-zone"><button class="delete-rating-btn" onclick="openDeleteRating('restaurant')">Delete a Rating</button></div>`;
}
function lgToggleAll(btn){
  const wrap = document.getElementById('lg-all-wrap');
  const open = wrap.classList.toggle('open');
  btn.textContent = open ? 'Hide ↑' : `View All Ratings ↓`;
}

// ── SECURE RATING DELETION ───────────────────────────────────
let _deleteState={category:null,pin:'',ratings:[],selected:null};
function deleteCategoryLabel(category){ return category==='film'?'Film':category==='tv'?'TV':'Restaurant'; }
function deleteRatingTitle(category,rating){
  if(category==='film') return String(rating['Title']||'Untitled film');
  if(category==='tv') return String(rating['Series']||'Untitled series')+(rating['Type']==='season'?' — '+String(rating['Season Name']||'Season '+rating['Season']):' — Overall Series');
  return String(rating['Name']||'Unnamed restaurant');
}
function deleteRatingMeta(category,rating){
  if(category==='film') return [rating['Year'],rating['Date']].filter(Boolean).join(' · ');
  if(category==='tv') return [rating['Year'],rating['Date']].filter(Boolean).join(' · ');
  return [rating['Cuisine'],rating['Address'],rating['Date']].filter(Boolean).join(' · ');
}
function deleteRatingsForCategory(category){
  if(category==='film') return _statsData.ratings||[];
  if(category==='tv') return tvStatsData.ratings||[];
  return _lgStatsData.ratings||[];
}
function openDeleteRating(category){
  _deleteState={category:category,pin:'',ratings:deleteRatingsForCategory(category),selected:null};
  const modal=document.getElementById('rating-delete-modal');
  modal.classList.add('open');
  renderDeletePinStep();
}
function closeDeleteRating(event){
  if(event && event.target!==document.getElementById('rating-delete-modal')) return;
  document.getElementById('rating-delete-modal').classList.remove('open');
  _deleteState={category:null,pin:'',ratings:[],selected:null};
}
function renderDeletePinStep(){
  document.getElementById('rating-delete-content').innerHTML=`
    <div class="rating-delete-eyebrow">Protected action</div><div class="rating-delete-title">Delete a Rating</div>
    <div class="rating-delete-copy">Re-enter your four-digit PIN. Nothing will be deleted until you select a rating and confirm it on a separate screen.</div>
    <input class="rating-delete-pin" id="delete-rating-pin" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="off" aria-label="Your PIN" onkeydown="if(event.key==='Enter')verifyDeletePin()"/>
    <div class="rating-delete-error" id="delete-rating-error"></div>
    <div class="rating-delete-actions"><button class="btn-sec" onclick="closeDeleteRating()">Cancel</button><button class="rating-delete-confirm" onclick="verifyDeletePin()">Verify PIN</button></div>`;
  setTimeout(()=>document.getElementById('delete-rating-pin')?.focus(),0);
}
async function verifyDeletePin(){
  const input=document.getElementById('delete-rating-pin');
  const pin=String(input?.value||'').replace(/\D/g,'');
  const error=document.getElementById('delete-rating-error');
  if(pin.length!==4){ error.textContent='Enter your four-digit PIN.'; return; }
  error.textContent='Checking PIN…';
  try{
    const result=await apiCall('verifyUserPin',{token:getSessionToken(),pin:pin});
    if(!result?.ok) throw new Error(result?.error||'Incorrect PIN');
    _deleteState.pin=pin;
    renderDeleteChoiceStep('');
  }catch(e){ error.textContent=e.message||'Incorrect PIN'; input?.select(); }
}
function renderDeleteChoiceStep(query){
  const term=String(query||'').trim().toLowerCase();
  const matches=_deleteState.ratings.filter(rating=>(deleteRatingTitle(_deleteState.category,rating)+' '+deleteRatingMeta(_deleteState.category,rating)).toLowerCase().includes(term));
  document.getElementById('rating-delete-content').innerHTML=`
    <div class="rating-delete-eyebrow">PIN verified</div><div class="rating-delete-title">Choose One Rating</div>
    <div class="rating-delete-copy">Select the exact rating you want to remove. This list only contains ratings owned by ${escHtml(currentUser?.name||'you')}.</div>
    <input class="rating-delete-search" id="delete-rating-search" type="search" placeholder="Search your ${deleteCategoryLabel(_deleteState.category).toLowerCase()} ratings" value="${escHtml(query||'')}" oninput="renderDeleteChoiceStep(this.value)"/>
    <div class="rating-delete-list">${matches.length?matches.map((rating,index)=>`<button class="rating-delete-choice" onclick="selectRatingToDelete(${_deleteState.ratings.indexOf(rating)})"><span><span class="rating-delete-choice-title">${escHtml(deleteRatingTitle(_deleteState.category,rating))}</span><span class="rating-delete-choice-meta">${escHtml(deleteRatingMeta(_deleteState.category,rating))}</span></span><span class="rating-delete-choice-score">${Number(rating['Score /10']||0).toFixed(1)}</span></button>`).join(''):'<div class="stats-empty">No matching ratings.</div>'}</div>
    <div class="rating-delete-actions"><button class="btn-sec" onclick="renderDeletePinStep()">Back</button><button class="btn-sec" onclick="closeDeleteRating()">Cancel</button></div>`;
  const search=document.getElementById('delete-rating-search');
  if(search){ const length=search.value.length; search.focus(); search.setSelectionRange(length,length); }
}
function selectRatingToDelete(index){
  _deleteState.selected=_deleteState.ratings[index];
  const rating=_deleteState.selected;
  document.getElementById('rating-delete-content').innerHTML=`
    <div class="rating-delete-eyebrow">Final confirmation</div><div class="rating-delete-title">Permanently Delete?</div>
    <div class="rating-delete-copy"><strong>${escHtml(deleteRatingTitle(_deleteState.category,rating))}</strong><br>${escHtml(deleteRatingMeta(_deleteState.category,rating))}<br><br>This removes your database row and rebuilds the group summary. It cannot be undone from the website.</div>
    <div class="rating-delete-error" id="delete-rating-error"></div>
    <div class="rating-delete-actions"><button class="btn-sec" onclick="renderDeleteChoiceStep('')">Choose a Different Rating</button><button class="rating-delete-confirm" onclick="confirmDeleteRating()">Permanently Delete</button></div>`;
}
async function confirmDeleteRating(){
  const rating=_deleteState.selected;
  if(!rating) return;
  const error=document.getElementById('delete-rating-error');
  error.textContent='Deleting…';
  const payload={pin:_deleteState.pin};
  let action='';
  if(_deleteState.category==='film'){
    action='deleteRating'; Object.assign(payload,{tmdbId:rating['TMDB ID'],title:rating['Title'],year:rating['Year']});
  }else if(_deleteState.category==='tv'){
    action='deleteTvRating'; Object.assign(payload,{tmdbTvId:rating['TMDB TV ID'],seriesTitle:rating['Series'],entryType:rating['Type'],seasonNumber:rating['Season']});
  }else{
    action='deleteRestaurantRating'; Object.assign(payload,{placeId:rating['Place ID'],name:rating['Name'],address:rating['Address']});
  }
  try{
    const result=await apiCall(action,{token:getSessionToken(),payload:payload});
    if(!result?.ok) throw new Error(result?.error||'Delete failed');
    _ratingsCache=null; tvRatingsCache=[]; _lgRatingsCache=null;
    const deletedCategory=_deleteState.category;
    closeDeleteRating();
    if(deletedCategory==='tv') await goTvStats();
    else if(deletedCategory==='restaurant') await lgGoStats();
    else await goStats();
  }catch(e){ error.textContent=e.message||'Delete failed'; }
}

// ── SHARED API CALL ───────────────────────────────────────────
async function lgCall(body){
  return apiCall(body.action, {...body, token: getSessionToken()});
}


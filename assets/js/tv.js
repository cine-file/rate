// ══════════════════════════════════════════════════════════════
//  TV — SEARCH, SEASON SELECT, AND STATS
// ══════════════════════════════════════════════════════════════
let tvSearchTimer = null;
let tvCurrentSeries = null;
let tvRatingsCache = [];
let tvStatsType = 'season';
let tvStatsTab = 'my';
let tvStatsData = {ratings:[], summary:{rows:[]}};

document.getElementById('tv-search-input').addEventListener('input', function(){
  const query = this.value.trim();
  clearTimeout(tvSearchTimer);
  if(!query){ document.getElementById('tv-dropdown').classList.remove('open'); return; }
  document.getElementById('tv-spinner').classList.add('visible');
  tvSearchTimer = setTimeout(function(){ searchTv(query); }, 320);
});
document.getElementById('tv-search-input').addEventListener('blur', function(){
  setTimeout(function(){ document.getElementById('tv-dropdown').classList.remove('open'); }, 160);
});

async function searchTv(query,advanced=false){
  try{
    const year=advanced ? document.getElementById('tv-advanced-year').value.trim() : '';
    const data = await apiCall('searchTv', {token:getSessionToken(),query:query,advanced:advanced,year:year,pages:3});
    const results = data.results || [];
    const dropdown = document.getElementById('tv-dropdown');
    dropdown.classList.toggle('advanced-results',advanced);
    dropdown.innerHTML = results.length ? results.map(function(show){
      return '<button class="drop-item" onclick="pickTvSeries(' + Number(show.id) + ')">' +
        (show.poster_path ? '<img class="drop-poster" src="https://image.tmdb.org/t/p/w92' + escHtml(show.poster_path) + '" alt="">' : '<div class="drop-poster"></div>') +
        '<div><div class="drop-title">' + escHtml(show.name) + '</div><div class="drop-year">' + escHtml(show.year || '') + (show.original_name&&show.original_name!==show.name?' · '+escHtml(show.original_name):'') + '</div></div></button>';
    }).join('') : '<div class="stats-empty">No matches found. Try removing the year or using an alternate title.</div>';
    dropdown.classList.add('open');
  }catch(e){}
  document.getElementById('tv-spinner').classList.remove('visible');
}

async function pickTvSeries(id){
  document.getElementById('tv-dropdown').classList.remove('open');
  document.getElementById('tv-spinner').classList.add('visible');
  try{
    const values = await Promise.all([
      apiCall('getTvDetails', {token:getSessionToken(), id:id}),
      apiCall('getTvRatings', {token:getSessionToken()})
    ]);
    tvCurrentSeries = values[0];
    tvRatingsCache = Array.isArray(values[1]) ? values[1] : [];
    renderTvSeriesSelect();
    showScreen('tv-select');
  }catch(e){}
  document.getElementById('tv-spinner').classList.remove('visible');
}

function renderTvSeriesSelect(){
  const series = tvCurrentSeries;
  if(!series) return;
  document.getElementById('tv-select-title').textContent = series.seriesTitle;
  document.getElementById('tv-select-meta').textContent = [series.seriesYear,series.creator && 'Created by ' + series.creator,series.imdb && 'IMDb: ' + series.imdb].filter(Boolean).join(' · ');
  const poster = document.getElementById('tv-select-poster');
  if(series.poster){ poster.src='https://image.tmdb.org/t/p/w200' + series.poster; poster.style.display='block'; }
  else poster.style.display='none';
  const seasons = tvRatingsCache.filter(function(r){ return String(r['TMDB TV ID'])===String(series.id) && r['Type']==='season'; });
  const average = seasons.length ? seasons.reduce(function(sum,r){ return sum + Number(r['Score /10']||0); },0) / seasons.length : null;
  const manual = tvRatingsCache.find(function(r){ return String(r['TMDB TV ID'])===String(series.id) && r['Type']==='overall'; });
  document.getElementById('tv-overall-option').innerHTML =
    '<div class="wishlist-item"><div class="wishlist-item-main"><div class="wishlist-item-title">Overall Series</div><div class="wishlist-item-meta">' +
    (manual ? 'Your manual overall rating: ' + Number(manual['Score /10']).toFixed(1) : (average !== null ? 'Season-average placeholder: ' + average.toFixed(1) : 'No seasons rated yet')) +
    '</div></div><button class="wishlist-add" onclick="startTvRating(\'overall\')">' + (manual ? 'Re-rate' : 'Rate Overall') + '</button></div>';
  document.getElementById('tv-season-options').innerHTML = (series.seasons || []).map(function(season){
    const rated = tvRatingsCache.find(function(r){ return String(r['TMDB TV ID'])===String(series.id) && r['Type']==='season' && String(r['Season'])===String(season.seasonNumber); });
    return '<div class="wishlist-item"><div class="wishlist-item-main"><div class="wishlist-item-title">' + escHtml(season.seasonName) + '</div><div class="wishlist-item-meta">' +
      [season.year,season.episodeCount && season.episodeCount + ' episodes',rated && 'Your rating: ' + Number(rated['Score /10']).toFixed(1)].filter(Boolean).join(' · ') +
      '</div></div><button class="wishlist-add" onclick="startTvRating(\'season\',' + Number(season.seasonNumber) + ')">' + (rated ? 'Re-rate' : 'Rate Season') + '</button></div>';
  }).join('') || '<div class="stats-empty">No standard seasons are available for this series.</div>';
}

function startTvRating(entryType, seasonNumber){
  const series = tvCurrentSeries;
  if(!series) return;
  const season = (series.seasons || []).find(function(s){ return Number(s.seasonNumber)===Number(seasonNumber); });
  const existing = tvRatingsCache.find(function(r){
    return String(r['TMDB TV ID'])===String(series.id) && r['Type']===entryType &&
      (entryType==='overall' || String(r['Season'])===String(seasonNumber));
  });
  const seasonRatings = tvRatingsCache.filter(function(r){ return String(r['TMDB TV ID'])===String(series.id) && r['Type']==='season'; });
  const suggested = entryType==='overall' && !existing && seasonRatings.length
    ? seasonRatings.reduce(function(sum,r){ return sum+Number(r['Score /10']||0); },0)/seasonRatings.length : null;
  const item = {
    id:series.id, tmdbTvId:series.id, entryType:entryType, seriesTitle:series.seriesTitle, seriesYear:series.seriesYear,
    seasonNumber:entryType==='overall' ? '' : season.seasonNumber,
    seasonName:entryType==='overall' ? 'Overall Series' : season.seasonName,
    episodeCount:entryType==='overall' ? '' : season.episodeCount,
    title:series.seriesTitle + (entryType==='overall' ? ' — Overall' : ' — ' + season.seasonName),
    year:entryType==='overall' ? series.seriesYear : (season.year || series.seriesYear),
    director:series.creator, creator:series.creator, genres:series.genres || [], imdb:series.imdb || '',
    poster:entryType==='overall' ? series.poster : (season.poster || series.poster), suggestedScore10:suggested
  };
  _pendingMovie = item;
  if(existing){
    document.getElementById('ar-title').textContent = item.title;
    document.getElementById('ar-score').textContent = Number(existing['Score /10']||0).toFixed(1);
    document.getElementById('ar-grade').textContent = grade(Number(existing['Score /10']||0));
    document.getElementById('ar-date').textContent = existing['Date'] ? 'Rated on ' + existing['Date'] : '';
    document.getElementById('already-rated-modal').style.display='flex';
  } else loadMovie(item);
}

async function pushTvToSheets(raw100, ratingGrade, overallNote, today){
  tvRatingsCache = [];
  const row = {
    date:today, entryType:currentMovie.entryType, seriesTitle:currentMovie.seriesTitle, seriesYear:currentMovie.seriesYear,
    seasonNumber:currentMovie.seasonNumber, seasonName:currentMovie.seasonName, episodeCount:currentMovie.episodeCount,
    creator:currentMovie.creator, genres:(currentMovie.genres || []).join(' · '), imdb:currentMovie.imdb || '',
    tmdbTvId:currentMovie.tmdbTvId, posterPath:currentMovie.poster || '', score10:chosenScore10.toFixed(1),
    score100:quickMode ? (chosenScore10*10).toFixed(1) : raw100, grade:ratingGrade,
    plot:quickMode?'':scores.plot||'', plotGrade:quickMode?'':gradeFromRaw(scores.plot||0), plotNotes:quickMode?'':notes.plot||'',
    entertainment:quickMode?'':scores.entertainment||'', entGrade:quickMode?'':gradeFromRaw(scores.entertainment||0), entNotes:quickMode?'':notes.entertainment||'',
    acting:quickMode?'':scores.acting||'', actingGrade:quickMode?'':gradeFromRaw(scores.acting||0), actingNotes:quickMode?'':notes.acting||'',
    visuals:quickMode?'':scores.visuals||'', visualsGrade:quickMode?'':gradeFromRaw(scores.visuals||0), visualsNotes:quickMode?'':notes.visuals||'',
    pacing:quickMode?'':scores.pacing||'', pacingGrade:quickMode?'':gradeFromRaw(scores.pacing||0), pacingNotes:quickMode?'':notes.pacing||'',
    emotional:quickMode?'':scores.emotional||'', emotionalGrade:quickMode?'':gradeFromRaw(scores.emotional||0), emotionalNotes:quickMode?'':notes.emotional||'',
    notes:overallNote
  };
  try{
    await apiCall('saveTvRating', {token:getSessionToken(), payload:row});
    document.getElementById('sheet-msg').textContent='✓ Added to Google Sheets';
    document.getElementById('sheet-msg').className='sheet-msg';
  }catch(e){
    document.getElementById('sheet-msg').textContent=e.message || 'Sheets sync failed';
    document.getElementById('sheet-msg').className='sheet-msg err';
  }
}

async function goTvStats(){
  showScreen('tv-stats');
  syncScoreModeButtons();
  const content=document.getElementById('tv-stats-content');
  if(!CONFIG.GAS_URL || !currentUser || !getSessionToken()){
    content.innerHTML='<div class="stats-empty">Connect Google Sheets and log in to see your TV stats.</div>';
    return;
  }
  content.innerHTML='<div class="stats-loading">Loading your TV ratings...</div>';
  try{
    const data=await Promise.all([apiCall('getTvRatings',{token:getSessionToken()}),apiCall('getTvSummary',{token:getSessionToken()})]);
    tvStatsData={ratings:data[0]||[],summary:data[1]||{rows:[]}};
    populateTvGenreFilter();
    renderTvStats();
  }catch(e){ content.innerHTML='<div class="stats-empty">Could not load TV ratings.</div>'; }
}

function setTvStatsType(type){
  tvStatsType=type;
  document.getElementById('tv-type-season').classList.toggle('active',type==='season');
  document.getElementById('tv-type-overall').classList.toggle('active',type==='overall');
  populateTvGenreFilter();
  renderTvStats();
}

function switchTvStatsTab(tab){
  tvStatsTab=tab;
  ['my','group','h2h','individual'].forEach(function(name){
    document.getElementById('tv-tab-'+name).classList.toggle('active',name===tab);
  });
  renderTvStats();
}

function renderTvStats(){
  const content=document.getElementById('tv-stats-content');
  const ratings=(tvStatsData.ratings||[]).filter(function(r){ return r['Type']===tvStatsType && rowMatchesGenre(r,_statsGenres.tv); });
  const summary={rows:(tvStatsData.summary?.rows || []).filter(function(row){ return row['Type']===tvStatsType && rowMatchesGenre(row,_statsGenres.tv); })};
  const label=tvStatsType==='season'?'Seasons':'Overall Shows';
  const title=function(row){ return String(row['Series'] || '') + (tvStatsType==='season' ? ' — '+String(row['Season Name'] || 'Season '+row['Season']) : ''); };
  const meta=function(row){ return String(row['Year'] || ''); };
  if(tvStatsTab==='group') return renderSummaryGroupStats({id:'tv-'+tvStatsType,containerId:'tv-stats-content',summary:summary,itemLabel:label,title:title,meta:meta});
  if(tvStatsTab==='h2h') return renderSummaryH2H({id:'tv-'+tvStatsType,containerId:'tv-stats-content',summary:summary,itemLabel:label,title:title,meta:meta});
  if(tvStatsTab==='individual') return renderIndividualRatings({id:'tv-'+tvStatsType,containerId:'tv-stats-content',summary:summary,itemLabel:label,title:title,meta:meta});
  if(!ratings.length){ content.innerHTML='<div class="stats-empty">No ' + label.toLowerCase() + ' rated yet.</div><div class="stats-danger-zone"><button class="delete-rating-btn" onclick="openDeleteRating(\'tv\')">Delete a Rating</button></div>'; return; }
  const sorted=ratings.slice().sort(function(a,b){ return ratingDisplayScore(b)-ratingDisplayScore(a); });
  const avg=averageScores(ratings.map(ratingDisplayScore));
  const distributionValues=ratings.map(rawScoreForRating).filter(function(value){ return value!==null; });
  const categories={'Story & Concept':'Plot','Entertainment Value':'Entertainment','Performances & Cast':'Acting','Production & Direction':'Visuals','Pacing':'Pacing','Impact':'Emotional'};
  const categoryAverages=Object.entries(categories).map(function(entry){
    const values=ratings.map(function(r){ return Number(r[entry[1]] || 0); }).filter(function(value){ return value>0; });
    return {label:entry[0], value:values.length ? averageScores(values) : null};
  });
  const allId='tv-all-ratings-'+tvStatsType;
  const rowTitle=function(r){ return escHtml(r['Series'])+(r['Type']==='season'?' — '+escHtml(r['Season Name'] || 'Season '+r['Season']):''); };
  const rowHtml=function(r,index){ return '<div class="film-row"><div class="film-row-rank">#'+(index+1)+'</div><div class="film-row-title">'+rowTitle(r)+'</div><div class="film-row-year">'+escHtml(r['Year'] || '')+'</div><div class="film-row-score">'+ratingDisplayScore(r).toFixed(1)+'</div></div>'; };
  const recent=ratings.slice().reverse().slice(0,5);
  content.innerHTML=`
    <div class="stats-section"><div class="stats-section-title">Overview — ${escHtml(currentUser.name)}</div><div class="stats-grid">
      <div class="stat-card"><div class="stat-card-num">${ratings.length}</div><div class="stat-card-lbl">${escHtml(label)} Rated</div></div>
      <div class="stat-card"><div class="stat-card-num">${avg.toFixed(1)}</div><div class="stat-card-lbl">Average ${scoreLabel()}</div></div>
      <div class="stat-card"><div class="stat-card-num">${ratingDisplayScore(sorted[0]).toFixed(1)}</div><div class="stat-card-lbl">Highest</div></div>
      <div class="stat-card"><div class="stat-card-num">${ratingDisplayScore(sorted[sorted.length-1]).toFixed(1)}</div><div class="stat-card-lbl">Lowest</div></div>
    </div></div>
    <div class="stats-section"><div class="stats-section-title">Score Distribution</div>${renderDistributionChart(distributionValues)}</div>
    <div class="stats-section"><div class="stats-section-title">Your Top 5 ${escHtml(label)}</div><div class="film-list">${sorted.slice(0,5).map(rowHtml).join('')}</div>
      ${sorted.length>5?'<button class="view-all-btn" data-label="View All '+sorted.length+' '+escHtml(label)+' ↓" onclick="toggleNamedRatings(\''+allId+'\',this)">View All '+sorted.length+' '+escHtml(label)+' ↓</button><div class="all-ratings-wrap" id="'+allId+'"><div class="film-list">'+sorted.map(rowHtml).join('')+'</div></div>':''}
    </div>
    <div class="stats-section"><div class="stats-section-title">Recently Rated</div><div class="film-list">${recent.map(function(r){ return '<div class="film-row"><div class="film-row-title">'+rowTitle(r)+'</div><div class="film-row-year">'+escHtml(r['Date']||r['Year']||'')+'</div><div class="film-row-score">'+ratingDisplayScore(r).toFixed(1)+'</div></div>'; }).join('')}</div></div>
    <div class="stats-section"><div class="stats-section-title">Category Averages</div><div class="cat-bars">${categoryAverages.map(function(entry){ return '<div class="cat-bar-row"><div class="cat-bar-label">'+escHtml(entry.label)+'</div><div class="cat-bar-track"><div class="cat-bar-fill" style="width:'+(entry.value===null?0:entry.value)+'%"></div></div><div class="cat-bar-val">'+(entry.value===null?'—':entry.value.toFixed(1))+'</div></div>'; }).join('')}</div></div>
    <div class="stats-danger-zone"><button class="delete-rating-btn" onclick="openDeleteRating('tv')">Delete a Rating</button></div>`;
}
function toggleNamedRatings(id,button){
  const wrap=document.getElementById(id);
  const open=wrap.classList.toggle('open');
  button.textContent=open ? 'Hide ↑' : button.dataset.label;
}


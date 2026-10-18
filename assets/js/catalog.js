// ── GAMES + BOOKS ─────────────────────────────────────────────
// Both categories reuse the shared score/card screens and only differ in their
// provider, labels, and rating categories.
const CATALOG_CONFIG = {
  game: {
    singular:'Game', plural:'Games', icon:'🎮', searchAction:'searchGames', detailsAction:'getGameDetails',
    ratingsAction:'getGameRatings', summaryAction:'getGameSummary', saveAction:'saveGameRating',
    futureGetAction:'getFutureGames', futureAddAction:'addFutureGame', futureDeleteAction:'deleteFutureGame',
    externalLabel:'Steam', creatorLabel:'Developer', cats:GAME_CATS
  },
  book: {
    singular:'Book', plural:'Books', icon:'📚', searchAction:'searchBooks', detailsAction:'getBookDetails',
    ratingsAction:'getBookRatings', summaryAction:'getBookSummary', saveAction:'saveBookRating',
    futureGetAction:'getFutureBooks', futureAddAction:'addFutureBook', futureDeleteAction:'deleteFutureBook',
    externalLabel:'Google Books', creatorLabel:'Author', cats:BOOK_CATS
  }
};

let catalogSearchRequest=0;
let catalogRatingsCache={game:null,book:null};
let catalogStatsKind='game';
let catalogStatsTab='my';
let catalogStatsData={ratings:[],summary:{rows:[]}};
let _catalogRenderedRatings=[];

function catalogConfig(kind=activeCategory){ return CATALOG_CONFIG[kind] || null; }

function startCatalogRating(kind){
  const config=catalogConfig(kind);
  if(!config) return;
  activeCategory=kind;
  clearTimeout(searchTimer);
  catalogSearchRequest++;
  document.getElementById('search-input').value='';
  document.getElementById('dropdown').classList.remove('open');
  document.getElementById('setup-notice').style.display='none';
  CATS=config.cats;
  quickMode=true;
  document.getElementById('quick-mode-toggle').checked=true;
  document.getElementById('search-eyebrow').textContent='Rate '+config.singular;
  document.getElementById('search-title').textContent='Find a '+config.singular;
  document.getElementById('search-sub').textContent='Search for the '+config.singular.toLowerCase()+' you just finished.';
  document.getElementById('search-input').placeholder='Type a '+config.singular.toLowerCase()+' title...';
  document.querySelector('.search-icon').textContent=config.icon;
  document.getElementById('movie-year-filter-wrap').style.display='none';
  document.querySelector('.advanced-search-toggle').style.display='none';
  document.getElementById('movie-advanced-panel').classList.remove('open');
  setLgMode(false);
  updateNavUser();
  showScreen('search');
}

async function catalogSearch(query){
  const config=catalogConfig();
  if(!config) return;
  const kind=activeCategory,request=++catalogSearchRequest;
  const isCurrent=()=>activeCategory===kind && request===catalogSearchRequest;
  const spinner=document.getElementById('spinner');
  spinner.classList.add('visible');
  try{
    const data=await apiCall(config.searchAction,{token:getSessionToken(),query:query});
    if(!isCurrent()) return;
    renderCatalogDropdown(data.results||[]);
  }catch(error){
    if(!isCurrent()) return;
    const dropdown=document.getElementById('dropdown');
    dropdown.innerHTML='<div class="stats-empty">'+escHtml(error.message||'Could not search '+config.plural.toLowerCase()+'. Try again shortly.')+'</div>';
    dropdown.classList.add('open');
  }
  if(isCurrent()) spinner.classList.remove('visible');
}

function renderCatalogDropdown(items){
  const dropdown=document.getElementById('dropdown');
  if(!items.length){ dropdown.innerHTML='<div class="stats-empty">No matches found. Try an alternate title.</div>'; dropdown.classList.add('open'); return; }
  dropdown.innerHTML=items.map(function(item,index){
    return '<button class="drop-item" type="button" data-catalog-index="'+index+'"><div class="drop-poster">'+(item.posterUrl?'<img class="drop-poster" src="'+escHtml(item.posterUrl)+'" alt="">':'')+'</div><div><div class="drop-title">'+escHtml(item.title||'')+'</div><div class="drop-year">'+escHtml(item.year||'')+(item.creator?' · '+escHtml(item.creator):'')+'</div></div></button>';
  }).join('');
  items.forEach(function(item,index){
    const button=dropdown.querySelector('[data-catalog-index="'+index+'"]');
    button.addEventListener('pointerdown',function(event){ event.preventDefault(); });
    button.addEventListener('click',function(){ pickCatalogItem(item.id); });
  });
  dropdown.classList.add('open');
}

async function pickCatalogItem(id){
  const config=catalogConfig();
  if(!config) return;
  document.getElementById('dropdown').classList.remove('open');
  document.getElementById('spinner').classList.add('visible');
  const kind=activeCategory;
  try{
    const item=await apiCall(config.detailsAction,{token:getSessionToken(),id:id});
    if(activeCategory!==kind) return;
    item.catalogKind=activeCategory;
    item.poster=item.posterUrl ? 'catalog' : '';
    await checkCatalogAlreadyRated(item);
  }catch(error){
    if(activeCategory===kind){
      const dropdown=document.getElementById('dropdown');
      dropdown.innerHTML='<div class="stats-empty">'+escHtml(error.message||'Could not load this item.')+'</div>';
      dropdown.classList.add('open');
    }
  }
  document.getElementById('spinner').classList.remove('visible');
}

async function checkCatalogAlreadyRated(item){
  const config=catalogConfig();
  const kind=activeCategory,token=getSessionToken();
  _pendingMovie=item;
  let ratings=catalogRatingsCache[activeCategory];
  if(!ratings){
    try{ ratings=await apiCall(config.ratingsAction,{token:token}); catalogRatingsCache[kind]=Array.isArray(ratings)?ratings:[]; }catch(error){ ratings=[]; }
  }
  if(activeCategory!==kind || token!==getSessionToken()) return;
  const existing=(ratings||[]).find(function(row){ return String(row['Source ID']||'')===String(item.id||'') || (String(row.Title||'').toLowerCase()===String(item.title||'').toLowerCase() && String(row.Year||'')===String(item.year||'')); });
  if(!existing){ loadMovie(item); return; }
  document.getElementById('ar-title').textContent=item.title;
  document.getElementById('ar-score').textContent=Number(existing['Score /10']||0).toFixed(1);
  document.getElementById('ar-grade').textContent=grade(Number(existing['Score /10']||0));
  document.getElementById('ar-date').textContent=existing.Date?'Rated on '+existing.Date:'';
  document.getElementById('already-rated-modal').style.display='flex';
}

async function pushCatalogToSheets(raw100,ratingGrade,overallNote,today){
  const config=catalogConfig();
  if(!config || !getSessionToken()) return;
  const payload={
    date:today,title:currentMovie.title,year:currentMovie.year||'',creator:currentMovie.director||'',genres:(currentMovie.genres||[]).join(' · '),
    sourceId:currentMovie.id||currentMovie.sourceId||'',posterUrl:currentMovie.posterUrl||'',externalScore:currentMovie.externalScore||'',externalLabel:currentMovie.externalLabel||config.externalLabel,externalCount:currentMovie.externalCount||'',
    score10:chosenScore10.toFixed(1),score100:quickMode?(chosenScore10*10).toFixed(1):raw100,grade:ratingGrade,notes:overallNote
  };
  config.cats.forEach(function(category,index){
    const key='category'+(index+1);
    payload[key]=quickMode?'':(scores[category.id]??'');
    payload[key+'Grade']=quickMode?'':gradeFromRaw(scores[category.id]||0);
    payload[key+'Notes']=quickMode?'':(notes[category.id]||'');
  });
  catalogRatingsCache[activeCategory]=null;
  try{
    await apiCall(config.saveAction,{token:getSessionToken(),payload:payload});
    const message=document.getElementById('sheet-msg'); message.textContent='✓ Added to Google Sheets'; message.className='sheet-msg';
  }catch(error){
    const message=document.getElementById('sheet-msg'); message.textContent=error.message||'Sheets sync failed'; message.className='sheet-msg err';
  }
}

async function goCatalogStats(kind=activeCategory){
  const config=catalogConfig(kind);
  if(!config) return;
  catalogStatsKind=kind;
  showScreen('catalog-stats');
  syncScoreModeButtons();
  document.getElementById('catalog-stats-eyebrow').textContent='My '+config.plural;
  document.getElementById('catalog-stats-title').textContent=config.plural;
  const content=document.getElementById('catalog-stats-content');
  content.innerHTML='<div class="stats-loading">Loading your '+config.plural.toLowerCase()+'...</div>';
  try{
    const values=await Promise.all([apiCall(config.ratingsAction,{token:getSessionToken()}),apiCall(config.summaryAction,{token:getSessionToken()})]);
    catalogStatsData={ratings:values[0]||[],summary:values[1]||{rows:[]}};
    renderCatalogStats();
  }catch(error){ content.innerHTML='<div class="stats-empty">Could not load your '+config.plural.toLowerCase()+'.</div>'; }
}

function switchCatalogStatsTab(tab){
  catalogStatsTab=tab;
  ['my','group','h2h','individual'].forEach(function(name){ document.getElementById('catalog-tab-'+name).classList.toggle('active',name===tab); });
  renderCatalogStats();
}

function renderCatalogStats(){
  const config=catalogConfig(catalogStatsKind), content=document.getElementById('catalog-stats-content');
  if(!config) return;
  const summary=catalogStatsData.summary||{rows:[]};
  const title=function(row){ return String(row.Title||''); };
  const meta=function(row){ return [row.Year,row.Creator].filter(Boolean).join(' · '); };
  if(catalogStatsTab==='group') return renderSummaryGroupStats({id:catalogStatsKind,containerId:'catalog-stats-content',summary:summary,itemLabel:config.plural,title:title,meta:meta});
  if(catalogStatsTab==='h2h') return renderSummaryH2H({id:catalogStatsKind,containerId:'catalog-stats-content',summary:summary,itemLabel:config.plural,title:title,meta:meta});
  if(catalogStatsTab==='individual') return renderIndividualRatings({id:catalogStatsKind,containerId:'catalog-stats-content',summary:summary,itemLabel:config.plural,title:title,meta:meta});
  const ratings=catalogStatsData.ratings||[];
  if(!ratings.length){ content.innerHTML='<div class="stats-empty">No '+config.plural.toLowerCase()+' rated yet.</div>'; return; }
  _catalogRenderedRatings=ratings.slice();
  const sorted=ratings.slice().sort(function(a,b){ return ratingDisplayScore(b)-ratingDisplayScore(a); });
  const avg=averageScores(ratings.map(ratingDisplayScore));
  const categoryAverages=config.cats.map(function(category,index){ const values=ratings.map(function(row){ return storedNumber(row['Category '+(index+1)]); }).filter(function(value){ return value!==null; }); return {label:category.label,value:averageScores(values)}; });
  const row=function(item,index){ const itemIndex=_catalogRenderedRatings.indexOf(item); return '<div class="film-row" role="button" tabindex="0" data-catalog-rating-index="'+itemIndex+'" onclick="showCatalogRating(Number(this.dataset.catalogRatingIndex))"><div class="film-row-rank">#'+(index+1)+'</div><div class="film-row-title">'+escHtml(item.Title||'')+'</div><div class="film-row-year">'+escHtml([item.Year,item.Creator].filter(Boolean).join(' · '))+'</div><div class="film-row-score">'+ratingDisplayScore(item).toFixed(1)+'</div></div>'; };
  content.innerHTML='<div class="stats-section"><div class="stats-section-title">Overview — '+escHtml(displayUserName(currentUser?.name))+'</div><div class="stats-grid"><div class="stat-card"><div class="stat-card-num">'+ratings.length+'</div><div class="stat-card-lbl">'+escHtml(config.plural)+' Rated</div></div><div class="stat-card"><div class="stat-card-num">'+avg.toFixed(1)+'</div><div class="stat-card-lbl">Average '+scoreLabel()+'</div></div><div class="stat-card"><div class="stat-card-num">'+ratingDisplayScore(sorted[0]).toFixed(1)+'</div><div class="stat-card-lbl">Highest</div></div><div class="stat-card"><div class="stat-card-num">'+ratingDisplayScore(sorted[sorted.length-1]).toFixed(1)+'</div><div class="stat-card-lbl">Lowest</div></div></div></div><div class="stats-section"><div class="stats-section-title">Score Distribution</div>'+renderDistributionChart(ratings.map(rawScoreForRating).filter(function(value){ return value!==null; }))+'</div><div class="stats-section"><div class="stats-section-title">Your Top 5 '+escHtml(config.plural)+'</div><div class="film-list">'+sorted.slice(0,5).map(row).join('')+'</div>'+(sorted.length>5?'<button class="view-all-btn" data-label="View All '+sorted.length+' '+escHtml(config.plural)+' ↓" onclick="toggleNamedRatings(\'catalog-all-ratings\',this)">View All '+sorted.length+' '+escHtml(config.plural)+' ↓</button><div class="all-ratings-wrap" id="catalog-all-ratings"><div class="film-list">'+sorted.map(row).join('')+'</div></div>':'')+'</div><div class="stats-section"><div class="stats-section-title">Category Averages</div><div class="cat-bars">'+categoryAverages.map(function(entry){ return '<div class="cat-bar-row"><div class="cat-bar-label">'+escHtml(entry.label)+'</div><div class="cat-bar-track"><div class="cat-bar-fill" style="width:'+(entry.value===null?0:entry.value)+'%"></div></div><div class="cat-bar-val">'+(entry.value===null?'—':entry.value.toFixed(1))+'</div></div>'; }).join('')+'</div></div>';
}

function showCatalogRating(index){
  const config=catalogConfig(catalogStatsKind),rating=_catalogRenderedRatings[index];
  if(!config || !rating) return;
  const group=(catalogStatsData.summary?.rows||[]).find(function(row){ return String(row['Source ID']||'')===String(rating['Source ID']||'') || (String(row.Title||'').toLowerCase()===String(rating.Title||'').toLowerCase() && String(row.Year||'')===String(rating.Year||'')); });
  const others=Object.entries(group?.userScores||{}).filter(function(entry){ return entry[0]!==currentUser?.name; }).map(function(entry){ return displayUserName(entry[0])+' '+Number(entry[1]).toFixed(1); });
  const lines=config.cats.map(function(category,index){ const value=storedNumber(rating['Category '+(index+1)]); return value===null?null:{label:category.label,value:value.toFixed(1)}; }).filter(Boolean);
  openRatingDetail({eyebrow:'Your rating',title:rating.Title||'',meta:[rating.Year,rating.Creator,rating.Date&&'Rated '+rating.Date],score:ratingDisplayScore(rating),grade:grade(storedNumber(rating['Score /10'])||0),lines:lines,comment:rating['Overall Notes']||'',secondaryBoxes:[{label:rating['External Label']||config.externalLabel,value:rating['External Score']||'—'},{label:'Other ratings',value:others.length?others.join(' · '):'No one else has rated it yet'}]});
}

// ── SEARCH ───────────────────────────────────────────────────
let searchTimer=null;
function toggleAdvancedSearch(kind){
  const panel=document.getElementById(kind==='tv'?'tv-advanced-panel':'movie-advanced-panel');
  panel?.classList.toggle('open');
}
function runAdvancedMovieSearch(){
  const query=document.getElementById('search-input').value.trim();
  if(!query) return document.getElementById('search-input').focus();
  doSearch(query,true);
}
function runAdvancedTvSearch(){
  const query=document.getElementById('tv-search-input').value.trim();
  if(!query) return document.getElementById('tv-search-input').focus();
  searchTv(query,true);
}

document.getElementById("search-input").addEventListener("input",function(){
  const q=this.value.trim();
  clearTimeout(searchTimer);
  if(!q){closeDropdown();return;}
  document.getElementById("spinner").classList.add("visible");
  searchTimer=setTimeout(()=>doSearch(q),320);
});
document.getElementById("search-input").addEventListener("blur",()=>{
  setTimeout(closeDropdown,160);
});

async function doSearch(q,advanced=false){
  if(!CONFIG.GAS_URL){
    document.getElementById("setup-notice").style.display="block";
    document.getElementById("spinner").classList.remove("visible");
    return;
  }
  document.getElementById("spinner").classList.add("visible");
  try{
    const year=advanced ? document.getElementById('movie-advanced-year').value.trim() : '';
    const data = await apiCall("searchMovies", {token:getSessionToken(),query:q,advanced:advanced,year:year,pages:3});
    document.getElementById("setup-notice").style.display="none";
    renderDropdown((data.results || data || []),advanced);
  }catch(e){
    console.error(e);
    const notice = document.getElementById("setup-notice");
    notice.style.display="block";
    notice.innerHTML = `<strong>Movie search failed</strong><br><br>${escHtml(e.message || "Could not reach the backend.")}<br><br><button class="demo-btn" onclick="loadDemo()">Try Demo with "Good Will Hunting" →</button>`;
    closeDropdown();
  }
  document.getElementById("spinner").classList.remove("visible");
}

function renderDropdown(results,advanced=false){
  const dd=document.getElementById("dropdown");
  dd.classList.toggle('advanced-results',advanced);
  if(!results.length){
    dd.innerHTML='<div class="stats-empty">No matches found. Try removing the year or using an alternate title.</div>';
    dd.classList.add("open");
    return;
  }
  dd.innerHTML=results.map(r=>`
    <button class="drop-item" onclick="pickMovie(${Number(r.id)})">
      ${r.poster_path?`<img class="drop-poster" src="https://image.tmdb.org/t/p/w92${r.poster_path}" alt="">`:`<div class="drop-poster"></div>`}
      <div><div class="drop-title">${escHtml(r.title)}</div><div class="drop-year">${escHtml(r.year || (r.release_date||'').slice(0,4))}${r.original_title&&r.original_title!==r.title?' · '+escHtml(r.original_title):''}</div></div>
    </button>`).join("");
  dd.classList.add("open");
}
function closeDropdown(){document.getElementById("dropdown").classList.remove("open");}

async function pickMovie(id){
  closeDropdown();
  document.getElementById("spinner").classList.add("visible");
  try{
    const movie = await apiCall("getMovieDetails", {token: getSessionToken(), id});
    await checkAlreadyRated(movie);
  }catch(e){ console.error(e); }
  document.getElementById("spinner").classList.remove("visible");
}

let _pendingMovie = null;
let _ratingsCache = null;      // in-memory cache of user's ratings
let _ratingsCacheTime = 0;     // when cache was last filled
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Pre-fetch and cache ratings in background after login
async function prefetchRatings(){
  if(!getSessionToken() || !currentUser) return;
  try{
    const data = await apiCall("getRatings", {token: getSessionToken()});
    if(Array.isArray(data)){
      _ratingsCache = data;
      _ratingsCacheTime = Date.now();
    }
  }catch(e){ console.log("Prefetch failed:", e); }
}

async function checkAlreadyRated(movie){
  _pendingMovie = movie;
  if(!CONFIG.GAS_URL || !currentUser){
    loadMovie(movie); return;
  }

  let ratings = null;

  // Use cache if fresh — never block the user waiting for a network call
  if(_ratingsCache && (Date.now() - _ratingsCacheTime) < CACHE_TTL){
    ratings = _ratingsCache;
  } else {
    // Race the fetch against a 4-second timeout
    // Either way, never leave the user staring at a spinner
    document.getElementById("spinner").classList.add("visible");
    try{
      const fetchPromise = apiCall("getRatings", {token: getSessionToken()}).catch(()=>null);

      const timeoutPromise = new Promise(res=>setTimeout(()=>res(null), 4000));

      const data = await Promise.race([fetchPromise, timeoutPromise]);

      if(Array.isArray(data)){
        ratings = data;
        _ratingsCache = data;
        _ratingsCacheTime = Date.now();
      }
    }catch(e){
      console.log("Already-rated check failed:", e);
    }
    document.getElementById("spinner").classList.remove("visible");
  }

  if(!ratings){
    // Could not check — just load the movie, don't block
    loadMovie(movie);
    return;
  }

  const existing = ratings.find(r=>String(r["Title"]||"").toLowerCase()===movie.title.toLowerCase());
  if(existing){
    document.getElementById("ar-title").textContent = movie.title;
    const sc = parseFloat(existing["Score /10"]||0);
    const raw100 = parseFloat(existing["Raw /100"]||0);
    document.getElementById("ar-score").textContent = sc.toFixed(1);
    document.getElementById("ar-grade").textContent = raw100 ? gradeFromRaw(raw100) : existing["Grade"]||"—";
    document.getElementById("ar-date").textContent = existing["Date"] ? `Rated on ${existing["Date"]}` : "";
    document.getElementById("already-rated-modal").style.display="flex";
  } else {
    loadMovie(movie);
  }
}

function closeAlreadyRated(){
  document.getElementById("already-rated-modal").style.display="none";
  _pendingMovie=null;
}

function proceedToRate(){
  document.getElementById("already-rated-modal").style.display="none";
  if(_pendingMovie) loadMovie(_pendingMovie);
}

function loadDemo(){
  loadMovie({
    id:1252, title:"Good Will Hunting", year:"1997",
    director:"Gus Van Sant", rt:"94%", imdb:"8.4",
    poster:"/bABCfKlHv5ApMakME4XQRBF4mbo.jpg",
    genres:["Drama","Romance"],
  });
}

// ── LOAD MOVIE INTO SCORE SCREEN ─────────────────────────────
function loadMovie(movie){
  currentMovie=movie; scores={}; notes={};
  const isTv = activeCategory === 'tv';
  document.getElementById("search-input").value="";
  document.getElementById('quick-note').placeholder = isTv ? 'Any thoughts on the season or series...' : 'Any thoughts on the film...';
  document.getElementById('overall-note').placeholder = isTv ? 'Final thoughts on the season or series...' : 'Final thoughts on the film...';
  document.getElementById('quick-note-label').textContent = 'Notes (optional)';
  document.getElementById('rating-stamp-subject').textContent = isTv
    ? 'The Following Television Rating Has Been Officially Reviewed By'
    : 'The Following Film Has Been Officially Reviewed By';
  document.getElementById('re-rate-button').textContent = isTv ? 'Re-rate This TV Entry' : 'Re-rate This Film';
  document.getElementById("score-title").textContent=movie.title;
  document.getElementById("score-meta").innerHTML=
    [movie.year,
     movie.director&&`Dir. ${movie.director}`,
     (movie.rt&&movie.rt!=="—")&&`RT Audience: ${movie.rt}`,
     (movie.imdb&&movie.imdb!=="—")&&`IMDb: ${movie.imdb}`]
    .filter(Boolean).map(s=>`<span>${escHtml(s)}</span>`).join(" · ");
  const poster=document.getElementById("score-poster");
  if(movie.poster){poster.src=`https://image.tmdb.org/t/p/w200${movie.poster}`;poster.style.display="block";}
  else poster.style.display="none";
  document.getElementById("scorer-body").innerHTML=CATS.map(c=>`
    <tr>
      <td class="td-cat">${c.label}</td>
      <td class="tc td-wt">${Math.round(c.w*100)}%</td>
      <td class="td-prompt">${c.prompt}</td>
      <td class="tc">
        <input class="score-inp" id="inp-${c.id}" type="number" min="0" max="100"
          step="0.1" placeholder="—" oninput="updateTotal()"/>
      </td>
      <td class="tc td-grade" id="grade-${c.id}">—</td>
      <td><textarea class="note-inp" id="note-${c.id}" rows="2" placeholder="Optional..."></textarea></td>
    </tr>`).join("");
  document.getElementById("overall-note").value="";
  document.getElementById("total-num").textContent="0.00";
  document.getElementById("total-grade").textContent="—";
  if(quickMode){
    // Set up quick rating screen
    document.getElementById('quick-title').textContent = movie.title;
    document.getElementById('quick-sub').textContent =
      [movie.year, movie.director && `Dir. ${movie.director}`,
       (movie.rt&&movie.rt!=='—') && `RT: ${movie.rt}`,
       movie.imdb && `IMDb: ${movie.imdb}`].filter(Boolean).join(' · ');
    const suggested = currentMovie.suggestedScore10 == null ? 5 : Number(currentMovie.suggestedScore10);
    document.getElementById('quick-slider').value = Math.max(0,Math.min(100,Math.round(suggested*10)));
    document.getElementById('quick-note').value = '';
    updateQuickScore(document.getElementById('quick-slider').value);
    showScreen('quick');
  } else {
    showScreen("score");
  }
}

function updateTotal(){
  CATS.forEach(c=>{
    const v=document.getElementById("inp-"+c.id)?.value;
    const el=document.getElementById("grade-"+c.id);
    if(v!==""&&v!==null&&!isNaN(v)){el.textContent=gradeFromRaw(v);el.classList.add("filled");}
    else{el.textContent="—";el.classList.remove("filled");}
  });
  const t=calcTotal();
  document.getElementById("total-num").textContent=t.toFixed(1);
  document.getElementById("total-grade").textContent=gradeFromRaw(t);
}

// ── ROUNDING SCREEN ───────────────────────────────────────────
function goRound(){
  CATS.forEach(c=>{
    scores[c.id]=Number(document.getElementById("inp-"+c.id)?.value||0);
    notes[c.id] =document.getElementById("note-"+c.id)?.value||"";
  });
  const raw=calcTotal();
  chosenScore10=scoreToTenth(raw);
  const g  =grade(chosenScore10);
  document.getElementById("round-movie-name").textContent=currentMovie.title.toUpperCase();
  document.getElementById("round-raw-num").textContent=raw.toFixed(1);
  document.getElementById("round-raw-grade").textContent=g;
  document.getElementById("round-options").innerHTML=`
    <div class="round-opt selected">
      <div class="round-opt-num">${chosenScore10.toFixed(1)}</div>
      <div class="round-opt-label">out of 10</div>
    </div>`;
  document.getElementById("round-confirm").disabled=false;
  showScreen("round");
}

function confirmRound(){
  if(chosenScore10===null) return;
  ratingDate=new Date().toISOString().slice(0,10);
  generateCard();
}

// ── GENERATE CARD ─────────────────────────────────────────────
function generateCard(){
  const raw=quickMode && chosenScore10 != null
    ? chosenScore10 * 10
    : weightedTotal(CATS,scores);
  const g  =grade(chosenScore10);
  const overallNote=document.getElementById("overall-note").value||"";
  const today=new Date().toLocaleDateString("en-US",{year:"numeric",month:"long",day:"numeric"});

  document.getElementById("card-title").textContent=currentMovie.title;
  document.getElementById("card-sub").textContent=
    [currentMovie.year,currentMovie.director&&`Directed by ${currentMovie.director}`].filter(Boolean).join(" · ");

  // Score boxes: /10 score (big), raw/100, grade, RT, IMDb
  document.getElementById("score-boxes").innerHTML=`
    <div class="sbox" style="min-width:120px">
      <div class="sbox-num">${chosenScore10.toFixed(1)}</div>
      <div class="sbox-lbl">out of 10</div>
    </div>
    <div class="sbox">
      <div class="sbox-num" style="font-size:32px">${raw.toFixed(1)}</div>
      <div class="sbox-lbl">raw /100</div>
    </div>
    <div class="sbox">
      <div class="sbox-num">${g}</div>
      <div class="sbox-lbl">Grade</div>
    </div>
    ${(currentMovie.rt&&currentMovie.rt!=="—"&&currentMovie.rt!=="")?`
    <div class="sbox">
      <div class="sbox-logo-wrap">
        <svg viewBox="0 0 100 100" class="sbox-logo" xmlns="http://www.w3.org/2000/svg">
          <circle cx="50" cy="50" r="48" fill="#FA320A"/>
          <text x="50" y="66" text-anchor="middle" font-size="52" font-family="Arial Black,sans-serif" fill="white" font-weight="900">RT</text>
        </svg>
      </div>
      <div class="sbox-rt-num">${escHtml(currentMovie.rt)}</div>
      <div class="sbox-lbl">RT Audience</div>
    </div>`:""}
    ${(currentMovie.imdb&&currentMovie.imdb!=="")?`
    <div class="sbox">
      <div class="sbox-logo-wrap">
        <svg viewBox="0 0 120 40" class="sbox-logo-wide" xmlns="http://www.w3.org/2000/svg">
          <rect width="120" height="40" rx="5" fill="#F5C518"/>
          <text x="60" y="29" text-anchor="middle" font-size="22" font-family="Arial Black,sans-serif" fill="black" font-weight="900">IMDb</text>
        </svg>
      </div>
      <div class="sbox-rt-num">${escHtml(currentMovie.imdb)}</div>
      <div class="sbox-lbl">IMDb Rating</div>
    </div>`:""}
    ${currentMovie.poster?`<img class="card-poster" src="https://image.tmdb.org/t/p/w185${currentMovie.poster}" alt="${escHtml(currentMovie.title)}">`:""}
  `;

  // Show/hide category table based on mode
  const cardTableWrap = document.querySelector('.card-table');
  if(quickMode){
    if(cardTableWrap) cardTableWrap.style.display='none';
    document.getElementById("card-table-body").innerHTML='';
  } else {
    if(cardTableWrap) cardTableWrap.style.display='';
    document.getElementById("card-table-body").innerHTML=CATS.map(c=>`
      <tr>
        <td class="ct-name">${c.label}</td>
        <td class="tc ct-dim">${Math.round(c.w*100)}%</td>
        <td class="tc ct-score">${scores[c.id]||"—"}</td>
        <td class="tc ct-grade">${scores[c.id]?gradeFromRaw(scores[c.id]):"—"}</td>
        <td class="ct-note">${escHtml(notes[c.id]||"")}</td>
      </tr>`).join("");
  }

  const notesBlock=document.getElementById("card-notes");
  if(overallNote){document.getElementById("card-notes-body").textContent=overallNote;notesBlock.style.display="block";}
  else notesBlock.style.display="none";
  // Hide the divider rule above category table in quick mode
  const rules=document.querySelectorAll('.mpaa-rule');
  if(rules.length>=3) rules[2].style.display = quickMode ? 'none' : '';

  document.getElementById("card-date").textContent=today;
  document.getElementById("card-genres").textContent=(currentMovie.genres||[]).join(" · ");
  document.getElementById("sheet-msg").textContent="";
  showScreen("result");

  // Push to sheets and load rank
  pushToSheets(raw.toFixed(1), g, overallNote, today);
  loadRankReveal();
}

// ── GOOGLE SHEETS ─────────────────────────────────────────────
function pushToSheets(raw100, g, overallNote, today){
  if(activeCategory === 'tv') return pushTvToSheets(raw100, g, overallNote, today);
  _ratingsCache = null;
  if(!CONFIG.GAS_URL || !getSessionToken()) return;
  const row={
    date:    today,
    title:   currentMovie.title,
    year:    currentMovie.year||"",
    director:currentMovie.director||"",
    rt:      currentMovie.rt||"",
    imdb:    currentMovie.imdb||"",
    tmdbId:  currentMovie.id||"",
    posterPath: currentMovie.poster||currentMovie.poster_path||"",
    genres:  (currentMovie.genres||[]).join(" · "),
    runtimeMinutes: currentMovie.runtimeMinutes||currentMovie.runtime||"",
    score10: chosenScore10.toFixed(1),
    score100: quickMode ? (chosenScore10*10).toFixed(1) : raw100,
    grade:   g,
    plot:         quickMode?"":scores.plot||"",         plotGrade:    quickMode?"":gradeFromRaw(scores.plot||0),     plotNotes:    quickMode?"":notes.plot||"",
    entertainment:quickMode?"":scores.entertainment||"",entGrade:     quickMode?"":gradeFromRaw(scores.entertainment||0),entNotes: quickMode?"":notes.entertainment||"",
    acting:       quickMode?"":scores.acting||"",       actingGrade:  quickMode?"":gradeFromRaw(scores.acting||0),   actingNotes:  quickMode?"":notes.acting||"",
    visuals:      quickMode?"":scores.visuals||"",      visualsGrade: quickMode?"":gradeFromRaw(scores.visuals||0),  visualsNotes: quickMode?"":notes.visuals||"",
    pacing:       quickMode?"":scores.pacing||"",       pacingGrade:  quickMode?"":gradeFromRaw(scores.pacing||0),  pacingNotes:  quickMode?"":notes.pacing||"",
    emotional:    quickMode?"":scores.emotional||"",    emotionalGrade:quickMode?"":gradeFromRaw(scores.emotional||0),emotionalNotes:quickMode?"":notes.emotional||"",
    notes: overallNote,
  };
  apiCall("saveRating", {token: getSessionToken(), payload: row})
    .then(()=>{
      const el=document.getElementById("sheet-msg");
      el.textContent="✓ Added to Google Sheets"; el.className="sheet-msg";
    })
    .catch((e)=>{
      const el=document.getElementById("sheet-msg");
      el.textContent=e.message || "Sheets sync failed"; el.className="sheet-msg err";
    });
}

// ── RANK REVEAL ───────────────────────────────────────────────
async function loadRankReveal(){
  const reveal=document.getElementById("rank-reveal");
  const stats =document.getElementById("rank-stats");
  if(activeCategory === 'tv'){
    reveal.style.display='none';
    return;
  }
  reveal.style.display="none";
  if(!CONFIG.GAS_URL||!currentUser) return;
  try{
    // Fetch personal ratings + summary tab in parallel
    const [ratings, summary] = await Promise.all([
      apiCall("getRatings", {token: getSessionToken()}),
      apiCall("getSummary", {token: getSessionToken()})
    ]);

    if(!ratings||!ratings.length) return;

    // Personal rank stats
    const scores10=ratings.map(r=>storedNumber(r["Score /10"])).filter(value=>value!==null).sort((a,b)=>b-a);
    const myScore =chosenScore10;
    const rank    =scores10.filter(s=>s>myScore).length+1;
    const total   =scores10.length;
    const g       =grade(chosenScore10);
    const gradeCount=ratings.filter(r=>grade(parseFloat(r["Score /10"]||0))===g).length;

    // Group average for this film from summary tab
    let groupHtml = "";
    if(summary && summary.rows){
      const filmRow = summary.rows.find(r=>r.Title===currentMovie.title);
      if(filmRow && filmRow.scores && filmRow.scores.length > 0){
        const groupAvg = (filmRow.scores.reduce((a,b)=>a+b,0)/filmRow.scores.length).toFixed(1);
        const groupCount = filmRow.scores.length;
        const diff = (myScore - parseFloat(groupAvg)).toFixed(1);
        const diffStr = diff > 0 ? `+${diff}` : `${diff}`;
        const diffColor = diff > 0 ? "#80d080" : diff < 0 ? "#d08080" : "#8a9a8a";
        groupHtml = `
          <div class="rank-stat">
            <div class="rank-stat-num">${groupAvg}</div>
            <div class="rank-stat-lbl">Group avg (${groupCount} ${groupCount===1?"rating":"ratings"})</div>
          </div>
          <div class="rank-stat">
            <div class="rank-stat-num" style="color:${diffColor}">${diffStr}</div>
            <div class="rank-stat-lbl">vs group avg</div>
          </div>`;
      }
    }

    stats.innerHTML=`
      <div class="rank-stat">
        <div class="rank-stat-num">#${rank}</div>
        <div class="rank-stat-lbl">Your rank out of ${total} films</div>
      </div>
      <div class="rank-stat">
        <div class="rank-stat-num">${total}</div>
        <div class="rank-stat-lbl">Total films rated</div>
      </div>
      <div class="rank-stat">
        <div class="rank-stat-num">${gradeCount}</div>
        <div class="rank-stat-lbl">${g}'s you've given</div>
      </div>
      ${groupHtml}`;
    reveal.style.display="block";
  }catch(e){ console.error(e); }
}

// ── STATS PAGE ────────────────────────────────────────────────
// ── STATS STATE ──────────────────────────────────────────────────
let _statsData = { ratings: null, summary: null };
let _statsTab = 'my';
let _scoreMode = localStorage.getItem('cf_score_mode') || '10'; // '10' or 'raw'
const _statsGenres = {
  film: localStorage.getItem('cf_film_genre') || '',
  tv: localStorage.getItem('cf_tv_genre') || ''
};
let _restaurantCuisine=localStorage.getItem('cf_restaurant_cuisine') || '';
function normalizeCuisine(value){ return String(value||'').trim(); }
function rowCuisine(row){ return normalizeCuisine(row?.Cuisine ?? row?.cuisine ?? ''); }
function rowMatchesCuisine(row,cuisine){ return !cuisine || rowCuisine(row).toLowerCase()===String(cuisine).toLowerCase(); }
function collectCuisines(rows){
  const names=new Map();
  (rows||[]).forEach(function(row){ const name=rowCuisine(row); if(name && !names.has(name.toLowerCase())) names.set(name.toLowerCase(),name); });
  return [...names.values()].sort(function(a,b){ return a.localeCompare(b); });
}
function filteredRestaurantSummary(summary){ return {rows:(summary?.rows||[]).filter(function(row){ return rowMatchesCuisine(row,_restaurantCuisine); })}; }
function populateRestaurantCuisineFilter(ratings,summaryRows){
  const select=document.getElementById('restaurant-cuisine-filter');
  const summary=document.getElementById('restaurant-cuisine-summary');
  if(!select) return;
  const cuisines=collectCuisines([...(ratings||[]),...(summaryRows||[])]);
  const canonical=cuisines.find(function(name){ return name.toLowerCase()===String(_restaurantCuisine).toLowerCase(); });
  if(_restaurantCuisine && !canonical){ _restaurantCuisine=''; localStorage.removeItem('cf_restaurant_cuisine'); }
  else if(canonical) _restaurantCuisine=canonical;
  select.innerHTML='<option value="">All Food Types</option>'+cuisines.map(function(name){ return '<option value="'+escHtml(name)+'">'+escHtml(name)+'</option>'; }).join('');
  select.value=_restaurantCuisine;
  if(summary) summary.textContent=_restaurantCuisine ? 'Showing '+_restaurantCuisine : 'Showing all food types';
}
function setRestaurantCuisine(value){
  _restaurantCuisine=String(value||'');
  if(_restaurantCuisine) localStorage.setItem('cf_restaurant_cuisine',_restaurantCuisine); else localStorage.removeItem('cf_restaurant_cuisine');
  lgRenderCurrentTab();
}

function splitGenres(value){
  if(Array.isArray(value)) return value.map(function(item){ return String(item||'').trim(); }).filter(Boolean);
  return String(value||'').split(/\s*[·,;|]\s*/).map(function(item){ return item.trim(); }).filter(Boolean);
}
function rowGenres(row){
  return splitGenres(row?.Genres ?? row?.Genre ?? row?.genres ?? '');
}
function rowMatchesGenre(row,genre){
  if(!genre) return true;
  const target=String(genre).toLowerCase();
  return rowGenres(row).some(function(item){ return item.toLowerCase()===target; });
}
function collectGenres(rows){
  const names=new Map();
  (rows||[]).forEach(function(row){
    rowGenres(row).forEach(function(name){
      const key=name.toLowerCase();
      if(!names.has(key)) names.set(key,name);
    });
  });
  return [...names.values()].sort(function(a,b){ return a.localeCompare(b); });
}
function filteredSummaryByGenre(summary,genre){
  return {rows:(summary?.rows||[]).filter(function(row){ return rowMatchesGenre(row,genre); })};
}
function populateGenreFilter(kind,ratings,summaryRows){
  const select=document.getElementById(kind+'-genre-filter');
  const summary=document.getElementById(kind+'-genre-summary');
  if(!select) return;
  const genres=collectGenres([...(ratings||[]),...(summaryRows||[])]);
  if(_statsGenres[kind]){
    const canonical=genres.find(function(name){ return name.toLowerCase()===_statsGenres[kind].toLowerCase(); });
    if(canonical) _statsGenres[kind]=canonical;
    else{
      _statsGenres[kind]='';
      localStorage.removeItem('cf_'+kind+'_genre');
    }
  }
  select.innerHTML='<option value="">All Genres</option>'+genres.map(function(name){ return '<option value="'+escHtml(name)+'" '+(name===_statsGenres[kind]?'selected':'')+'>'+escHtml(name)+'</option>'; }).join('');
  select.value=_statsGenres[kind] || '';
  if(summary) summary.textContent=_statsGenres[kind] ? 'Showing '+_statsGenres[kind] : 'Showing all genres';
}
function setStatsGenre(kind,value){
  if(kind!=='film' && kind!=='tv') return;
  _statsGenres[kind]=String(value||'');
  if(_statsGenres[kind]) localStorage.setItem('cf_'+kind+'_genre',_statsGenres[kind]);
  else localStorage.removeItem('cf_'+kind+'_genre');
  const summary=document.getElementById(kind+'-genre-summary');
  if(summary) summary.textContent=_statsGenres[kind] ? 'Showing '+_statsGenres[kind] : 'Showing all genres';
  if(kind==='tv') renderTvStats();
  else renderCurrentTab();
}
function getFilteredFilmRatings(){
  return (_statsData.ratings||[]).filter(function(row){ return rowMatchesGenre(row,_statsGenres.film); });
}
function getFilteredFilmSummary(){
  return filteredSummaryByGenre(_statsData.summary,_statsGenres.film);
}
function populateFilmGenreFilter(){
  populateGenreFilter('film',_statsData.ratings||[],_statsData.summary?.rows||[]);
}
function populateTvGenreFilter(){
  const ratings=(tvStatsData.ratings||[]).filter(function(row){ return row['Type']===tvStatsType; });
  const rows=(tvStatsData.summary?.rows||[]).filter(function(row){ return row['Type']===tvStatsType; });
  populateGenreFilter('tv',ratings,rows);
}

function switchStatsTab(tab){
  _statsTab = tab;
  ['my','group','h2h','individual'].forEach(t=>{
    document.getElementById('tab-'+t).classList.toggle('active', t===tab);
  });
  renderCurrentTab();
}

function syncScoreModeButtons(){
  document.querySelectorAll('.score-mode-btn[data-mode]').forEach(button=>{
    button.classList.toggle('active',button.dataset.mode===_scoreMode);
  });
}
function setScoreMode(mode){
  _scoreMode = mode==='raw' ? 'raw' : '10';
  localStorage.setItem('cf_score_mode', _scoreMode);
  syncScoreModeButtons();
  const active=document.querySelector('.screen.active')?.id;
  if(active==='screen-tv-stats') renderTvStats();
  else if(active==='screen-lg-stats') lgRenderCurrentTab();
  else renderCurrentTab();
}

function scoreLabel(){ return _scoreMode==='raw' ? '/100' : '/10'; }

async function goStats(){
  showScreen("stats");
  syncScoreModeButtons();
  const content=document.getElementById("stats-content");
  if(!CONFIG.GAS_URL||!currentUser||!getSessionToken()){
    content.innerHTML=`<div class="stats-empty">Connect Google Sheets and log in to see your stats.<br><br><button class="btn-pri" onclick="promptAdminPin()">Go to Settings →</button></div>`;
    return;
  }
  content.innerHTML=`<div class="stats-loading">Loading your ratings...</div>`;
  try{
    const [ratings, summary] = await Promise.all([
      apiCall("getRatings", {token: getSessionToken()}),
      apiCall("getSummary", {token: getSessionToken()})
    ]);
    if(!ratings||!ratings.length){
      content.innerHTML=`<div class="stats-empty">No ratings yet for ${currentUser.name}. Rate your first film!</div>`;
      return;
    }
    _statsData = {ratings, summary};
    populateFilmGenreFilter();
    renderCurrentTab();
  }catch(e){
    content.innerHTML=`<div class="stats-empty">Could not load ratings. Check your GAS URL in Settings.</div>`;
  }
}

function renderCurrentTab(){
  const ratings=getFilteredFilmRatings();
  const summary=getFilteredFilmSummary();
  if(_statsTab==='my')    renderMyStats(ratings, summary);
  if(_statsTab==='group') renderGroupStats(summary);
  if(_statsTab==='h2h')   renderH2H(summary);
  if(_statsTab==='individual') renderIndividualRatings({
    id:'film', containerId:'stats-content', summary:summary, itemLabel:'Films',
    title:function(row){ return String(row.Title || ''); },
    meta:function(row){ return String(row.Year || ''); }
  });
}

function toggleStatsRows(className, btn){
  const rows=document.querySelectorAll('.'+className);
  const open=[...rows].some(row=>row.classList.contains('open'));
  rows.forEach(row=>row.classList.toggle('open',!open));
  btn.textContent=open ? btn.dataset.label : 'Show Less ↑';
}

function closeRatingDetail(event){
  if(event && event.target!==document.getElementById('rating-detail-modal')) return;
  document.getElementById('rating-detail-modal').classList.remove('open');
}

function openRatingDetail({eyebrow,title,meta,score,grade: ratingGrade,lines,secondaryBoxes=[]}){
  document.getElementById('rating-detail-eyebrow').textContent=eyebrow;
  document.getElementById('rating-detail-title').textContent=title;
  document.getElementById('rating-detail-meta').textContent=meta.filter(Boolean).join(' · ');
  document.getElementById('rating-detail-scores').innerHTML=`
    <div class="rating-detail-score-box"><div class="rating-detail-score">${Number(score).toFixed(1)}</div><div class="rating-detail-label">${_scoreMode==='raw'?'out of 100':'out of 10'}</div></div>
    <div class="rating-detail-score-box"><div class="rating-detail-grade">${escHtml(ratingGrade)}</div><div class="rating-detail-label">Grade</div></div>`;
  document.querySelectorAll('#rating-detail-modal .rating-detail-secondary').forEach(el=>el.remove());
  document.getElementById('rating-detail-scores').insertAdjacentHTML('afterend', secondaryBoxes.length ? `
    <div class="rating-detail-secondary">${secondaryBoxes.map(box=>`
      <div class="rating-detail-score-box"><div class="rating-detail-secondary-value">${escHtml(box.value)}</div><div class="rating-detail-label">${escHtml(box.label)}</div></div>
    `).join('')}</div>` : '');
  document.getElementById('rating-detail-list').innerHTML=lines.map(line=>`
    <div class="rating-detail-line"><span>${escHtml(line.label)}</span><strong>${escHtml(line.value)}</strong></div>`).join('');
  document.getElementById('rating-detail-modal').classList.add('open');
}

function showMyRatedFilm(title){
  const rating=(_statsData.ratings||[]).find(r=>String(r['Title']||'').toLowerCase()===String(title||'').toLowerCase());
  if(!rating) return;
  const score10=parseFloat(rating['Score /10']||0);
  const score=ratingDisplayScore(rating);
  const lines=[
    ['Plot & Concept','Plot'],['Entertainment Value','Entertainment'],['Acting & Characters','Acting'],
    ['Visuals & Production','Visuals'],['Pacing','Pacing'],['Emotional Impact','Emotional']
  ].filter(([,key])=>rating[key]!==''&&rating[key]!=null&&Number(rating[key])>0)
   .map(([label,key])=>({label,value:Number(rating[key]).toFixed(1)}));
  if(rating['Overall Notes']) lines.push({label:'Notes',value:String(rating['Overall Notes'])});
  const group=(_statsData.summary?.rows||[]).find(r=>String(r.Title||'').toLowerCase()===String(title||'').toLowerCase());
  const others=Object.entries(group?.userScores||{})
    .filter(([name])=>name!==currentUser?.name)
    .map(([name,value])=>name+' '+Number(value).toFixed(1));
  openRatingDetail({
    eyebrow:'Your rating', title:String(rating['Title']||''),
    meta:[rating['Year'],rating['Date']&&`Rated ${rating['Date']}`],
    score, grade:grade(score10), lines,
    secondaryBoxes:[
      {label:'IMDb',value:String(rating['IMDb']||'—')},
      {label:'RT Audience',value:String(rating['RT Audience']||'—')},
      {label:'Other ratings',value:others.length?others.join(' · '):'No one else has rated it yet'}
    ]
  });
}

function searchMyRatedFilm(query){
  const holder=document.getElementById('my-film-search-results');
  if(!holder) return;
  const term=String(query||'').trim().toLowerCase();
  if(!term){ holder.innerHTML=''; return; }
  const matches=getFilteredFilmRatings().filter(function(r){ return String(r['Title']||'').toLowerCase().includes(term); }).slice(0,8);
  holder.innerHTML=matches.length ? matches.map(function(r){ return `
    <button class="stats-search-result" data-title="${escHtml(String(r['Title']||''))}" onclick="showMyRatedFilm(this.dataset.title)">
      <span class="stats-search-result-title">${escHtml(String(r['Title']||''))}${r['Year']?' ('+escHtml(String(r['Year']))+')':''}</span>
      <span class="stats-search-result-score">${ratingDisplayScore(r).toFixed(1)}</span>
    </button>`; }).join('') : '<div class="stats-empty">You have not rated a matching film in this genre.</div>';
}

function showGroupFilm(title){
  const row=(getFilteredFilmSummary().rows||[]).find(r=>String(r.Title||'').toLowerCase()===String(title||'').toLowerCase());
  if(!row) return;
  const scores=summaryDisplayScores(row);
  const avg=scores.length?scores.reduce((a,b)=>a+b,0)/scores.length:0;
  const mine=summaryUserDisplayScore(row,currentUser?.name);
  const mine10=row.userScores?.[currentUser?.name];
  const average10=averageScores(row.scores||[])||0;
  const lines=[];
  if(mine!=null) lines.push({label:'Your rating',value:Number(mine).toFixed(1)});
  lines.push({label:'Group average',value:avg.toFixed(1)});
  if(row.imdb) lines.push({label:'IMDb',value:String(row.imdb)});
  if(row.rt) lines.push({label:'RT Audience',value:String(row.rt)});
  Object.keys(row.userScores||{}).sort().forEach(name=>{
    if(name!==currentUser?.name){
      const value=summaryUserDisplayScore(row,name);
      if(value!=null) lines.push({label:name,value:Number(value).toFixed(1)});
    }
  });
  openRatingDetail({
    eyebrow:'Group rating', title:String(row.Title||''), meta:[row.Year, `${scores.length} rating${scores.length===1?'':'s'}`],
    score:mine!=null?Number(mine):avg, grade:grade(mine10!=null?Number(mine10):average10), lines
  });
}

function searchGroupFilm(query){
  const holder=document.getElementById('group-film-search-results');
  if(!holder) return;
  const term=String(query||'').trim().toLowerCase();
  if(!term){ holder.innerHTML=''; return; }
  const matches=(getFilteredFilmSummary().rows||[]).filter(function(r){ return String(r.Title||'').toLowerCase().includes(term); }).slice(0,8);
  holder.innerHTML=matches.length ? matches.map(function(r){
    const scores=summaryDisplayScores(r);
    const avg=scores.length?scores.reduce(function(a,b){ return a+b; },0)/scores.length:0;
    return `<button class="stats-search-result" data-title="${escHtml(String(r.Title||''))}" onclick="showGroupFilm(this.dataset.title)">
      <span class="stats-search-result-title">${escHtml(String(r.Title||''))}${r.Year?' ('+escHtml(String(r.Year))+')':''}</span>
      <span class="stats-search-result-score">${avg.toFixed(1)}</span>
    </button>`;
  }).join('') : '<div class="stats-empty">No matching film in this genre has been rated by the group.</div>';
}

// ── MY STATS TAB ──────────────────────────────────────────────────
function renderMyStats(ratings, summary){
  const container = document.getElementById('stats-content');
  const useRaw = _scoreMode==='raw';
  if(!ratings.length){
    const genre=_statsGenres.film ? ' in '+escHtml(_statsGenres.film) : '';
    container.innerHTML=`<div class="stats-empty">You have no film ratings${genre}.</div><div class="stats-danger-zone"><button class="delete-rating-btn" onclick="openDeleteRating('film')">Delete a Rating</button></div>`;
    return;
  }

  const scoreVals = ratings.map(r=>useRaw ? rawScoreForRating(r) : storedNumber(r["Score /10"])).filter(value=>value!==null);
  const avg = (scoreVals.reduce((a,b)=>a+b,0)/scoreVals.length)||0;

  const distributionValues=ratings.map(rawScoreForRating).filter(value=>value!==null);

  const catFields={
    "Plot & Concept":"Plot","Entertainment Value":"Entertainment",
    "Acting & Characters":"Acting","Visuals & Production":"Visuals",
    "Pacing":"Pacing","Emotional Impact":"Emotional"
  };
  const catAvgs={};
  Object.entries(catFields).forEach(([label,col])=>{
    const vals=ratings.map(r=>parseFloat(r[col]||0)).filter(v=>v>0);
    catAvgs[label]=vals.length?(vals.reduce((a,b)=>a+b,0)/vals.length).toFixed(1):"—";
  });

  const sorted=[...ratings].sort((a,b)=>{
    const aS = useRaw ? parseFloat(b["Raw /100"]||0) : parseFloat(b["Score /10"]||0);
    const bS = useRaw ? parseFloat(a["Raw /100"]||0) : parseFloat(a["Score /10"]||0);
    return aS - bS;
  });
  const top5=sorted.slice(0,5);
  const recent5=[...ratings].slice(-5).reverse();
  const scoreL = scoreLabel();

  container.innerHTML=`
    <!-- Overview -->
    <div class="stats-section">
      <div class="stats-section-title">Overview — ${escHtml(currentUser.name)}</div>
      <div class="stats-grid">
        <div class="stat-card"><div class="stat-card-num">${ratings.length}</div><div class="stat-card-lbl">Films Rated</div></div>
        <div class="stat-card"><div class="stat-card-num">${avg.toFixed(useRaw?1:1)}</div><div class="stat-card-lbl">Avg ${scoreL}</div></div>
        <div class="stat-card"><div class="stat-card-num">${sorted[0] ? (useRaw?parseFloat(sorted[0]["Raw /100"]):parseFloat(sorted[0]["Score /10"])).toFixed(1) : "—"}</div><div class="stat-card-lbl">Highest</div></div>
        <div class="stat-card"><div class="stat-card-num">${sorted[sorted.length-1] ? (useRaw?parseFloat(sorted[sorted.length-1]["Raw /100"]):parseFloat(sorted[sorted.length-1]["Score /10"])).toFixed(1) : "—"}</div><div class="stat-card-lbl">Lowest</div></div>
      </div>
    </div>

    <!-- Score Distribution -->
    <div class="stats-section">
      <div class="stats-section-title">Score Distribution</div>
      ${renderDistributionChart(distributionValues)}
    </div>

    <!-- Top 5 + View All -->
    <div class="stats-section">
      <div class="stats-section-title">Your Top 5 Films</div>
      <div class="film-list">
        ${top5.map((r,i)=>`
          <div class="film-row" role="button" tabindex="0" data-title="${escHtml(String(r["Title"]||""))}" onclick="showMyRatedFilm(this.dataset.title)">
            <div class="film-row-rank">#${i+1}</div>
            <div class="film-row-title">${escHtml(String(r["Title"]||""))}</div>
            <div class="film-row-year">${r["Year"]||""}</div>
            <div class="film-row-score">${(useRaw?parseFloat(r["Raw /100"]||0):parseFloat(r["Score /10"]||0)).toFixed(1)}</div>
          </div>`).join("")}
      </div>
      <button class="view-all-btn" onclick="toggleAllRatings(this)">View All ${ratings.length} Ratings ↓</button>
      <div class="all-ratings-wrap" id="all-ratings-wrap">
        <div class="all-ratings-count">${ratings.length} films · best to worst · showing ${scoreL}</div>
        <div class="film-list">
          ${sorted.map((r,i)=>`
            <div class="film-row" role="button" tabindex="0" data-title="${escHtml(String(r["Title"]||""))}" onclick="showMyRatedFilm(this.dataset.title)">
              <div class="film-row-rank">#${i+1}</div>
              <div class="film-row-title">${escHtml(String(r["Title"]||""))}</div>
              <div class="film-row-year">${r["Year"]||""}</div>
              <div class="film-row-score">${(useRaw?parseFloat(r["Raw /100"]||0):parseFloat(r["Score /10"]||0)).toFixed(1)}</div>
            </div>`).join("")}
        </div>
      </div>
    </div>

    <!-- Recent 5 -->
    <div class="stats-section">
      <div class="stats-section-title">Recently Rated</div>
      <div class="film-list">
        ${recent5.map(r=>`
          <div class="film-row" role="button" tabindex="0" data-title="${escHtml(String(r["Title"]||""))}" onclick="showMyRatedFilm(this.dataset.title)">
            <div class="film-row-title">${escHtml(String(r["Title"]||""))}</div>
            <div class="film-row-year">${r["Year"]||""}</div>
            <div class="film-row-score">${(useRaw?parseFloat(r["Raw /100"]||0):parseFloat(r["Score /10"]||0)).toFixed(1)}</div>
          </div>`).join("")}
      </div>
    </div>

    <!-- Category Averages -->
    <div class="stats-section">
      <div class="stats-section-title">Category Averages</div>
      <div class="cat-bars">
        ${Object.entries(catAvgs).map(([label,val])=>`
          <div class="cat-bar-row">
            <div class="cat-bar-label">${label}</div>
            <div class="cat-bar-track"><div class="cat-bar-fill" style="width:${val==="—"?0:val}%"></div></div>
            <div class="cat-bar-val">${val}</div>
          </div>`).join("")}
      </div>
    </div>

    <div class="stats-section">
      <div class="stats-section-title">Find a Rated Film</div>
      <input class="stats-search" id="my-film-search" type="search" placeholder="Search your rated films" oninput="searchMyRatedFilm(this.value)"/>
      <div class="stats-search-results" id="my-film-search-results"></div>
    </div>
    <div class="stats-danger-zone"><button class="delete-rating-btn" onclick="openDeleteRating('film')">Delete a Rating</button></div>`;
}

// ── GROUP TAB ─────────────────────────────────────────────────────
function renderGroupStats(summary){
  const container = document.getElementById('stats-content');
  if(!summary||!summary.rows||!summary.rows.length){
    container.innerHTML=`<div class="stats-empty">No group data yet. Rate some films with your friends!</div>`;
    return;
  }

  const rated = summary.rows.filter(r=>summaryDisplayScores(r).length>=2);
  if(!rated.length){
    container.innerHTML=`<div class="stats-empty">No films rated by multiple people yet.</div>`;
    return;
  }

  // Sort by group average
  const sorted = [...rated].sort((a,b)=>{
    const aScores=summaryDisplayScores(a), bScores=summaryDisplayScores(b);
    const aAvg=aScores.reduce((x,y)=>x+y,0)/aScores.length;
    const bAvg=bScores.reduce((x,y)=>x+y,0)/bScores.length;
    return bAvg-aAvg;
  });

  // Group averages per user
  const userTotals={};
  summary.rows.forEach(r=>{
    if(r.userScores) Object.entries(r.userScores).forEach(([u,s])=>{
      if(!userTotals[u]) userTotals[u]={sum:0,count:0};
      const display=summaryUserDisplayScore(r,u);
      userTotals[u].sum+=display==null?0:display;
      userTotals[u].count++;
    });
  });
  const userAvgs = Object.entries(userTotals)
    .map(([u,d])=>({name:u, avg:(d.sum/d.count).toFixed(2)}))
    .sort((a,b)=>parseFloat(b.avg)-parseFloat(a.avg));

  // Variance calc for consensus/controversy
  function variance(scores){
    const mean=scores.reduce((a,b)=>a+b,0)/scores.length;
    return scores.reduce((s,x)=>s+Math.pow(x-mean,2),0)/scores.length;
  }

  const withVar = rated.map(r=>({...r, var:variance(summaryDisplayScores(r))}));
  const mostControversial = [...withVar].sort((a,b)=>b.var-a.var).slice(0,5);
  const mostConsensus = [...withVar].filter(r=>r.scores.length>=2).sort((a,b)=>a.var-b.var).slice(0,5);

  // Get all users from summary headers
  const allUsers = [...new Set(summary.rows.flatMap(r=>Object.keys(r.userScores||{})))];
  const distributionValues=groupDistributionValues(summary);

  container.innerHTML=`
    <!-- Group member averages -->
    <div class="stats-section">
      <div class="stats-section-title">Average Rating by Person — ${scoreLabel()}</div>
      <div class="stats-grid">
        ${userAvgs.map(u=>`
          <div class="stat-card">
            <div class="stat-card-num">${u.avg}</div>
            <div class="stat-card-lbl">${escHtml(u.name)}</div>
          </div>`).join("")}
      </div>
    </div>

    <div class="stats-section">
      <div class="stats-section-title">Group Rating Distribution — ${distributionValues.length} Individual Ratings</div>
      ${renderDistributionChart(distributionValues)}
    </div>

    <div class="stats-section">
      <div class="stats-section-title">Find a Group Rating</div>
      <input class="stats-search" id="group-film-search" type="search" placeholder="Search films rated by the group" oninput="searchGroupFilm(this.value)"/>
      <div class="stats-search-results" id="group-film-search-results"></div>
    </div>

    <!-- Group Rankings table -->
    <div class="stats-section">
      <div class="stats-section-title">Group Rankings — ${sorted.length} Films</div>
      <div style="overflow-x:auto">
        <table class="group-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Film</th>
              <th class="tc">Group Avg</th>
              ${allUsers.map(u=>`<th class="tc">${escHtml(u)}</th>`).join("")}
            </tr>
          </thead>
          <tbody>
            ${sorted.map((r,i)=>{
              const avg=averageScores(summaryDisplayScores(r)).toFixed(1);
              return `<tr class="${i>=5?'group-ranking-extra stats-extra-row':''}">
                <td style="color:#3d6a3d;font-family:'Bebas Neue',sans-serif;font-size:16px">#${i+1}</td>
                <td class="film-title-cell">${escHtml(String(r.Title||""))}<br><span style="font-size:11px;color:#3d6a3d;font-weight:normal">${r.Year||""}</span></td>
                <td class="tc" style="color:#ffffff;font-size:20px">${avg}</td>
                ${allUsers.map(u=>{
                  const value=summaryUserDisplayScore(r,u);
                  return value!=null ? `<td class="tc">${Number(value).toFixed(1)}</td>`
                           : `<td class="tc empty">—</td>`;
                }).join("")}
              </tr>`;
            }).join("")}
          </tbody>
        </table>
      </div>
      ${sorted.length>5?'<button class="view-all-btn" data-label="View All '+sorted.length+' Films ↓" onclick="toggleStatsRows(\'group-ranking-extra\',this)">View All '+sorted.length+' Films ↓</button>':''}
    </div>

    <!-- Most Controversial -->
    <div class="stats-section">
      <div class="stats-section-title">🔥 Most Controversial</div>
      <div class="film-list">
        ${mostControversial.map(r=>{
          const avg=averageScores(summaryDisplayScores(r)).toFixed(1);
          const displayScores=summaryDisplayScores(r);
          const spread=(Math.max(...displayScores)-Math.min(...displayScores)).toFixed(1);
          return `<div class="film-row">
            <div class="film-row-title">${escHtml(String(r.Title||""))}</div>
            <div class="film-row-year">Avg ${avg}</div>
            <div class="film-row-score" style="font-size:13px;color:#d08040">±${spread}</div>
          </div>`;
        }).join("")}
      </div>
    </div>

    <!-- Most Consensus -->
    <div class="stats-section">
      <div class="stats-section-title">🤝 Most Agreement</div>
      <div class="film-list">
        ${mostConsensus.map(r=>{
          const avg=averageScores(summaryDisplayScores(r)).toFixed(1);
          const displayScores=summaryDisplayScores(r);
          const spread=(Math.max(...displayScores)-Math.min(...displayScores)).toFixed(1);
          return `<div class="film-row">
            <div class="film-row-title">${escHtml(String(r.Title||""))}</div>
            <div class="film-row-year">Avg ${avg}</div>
            <div class="film-row-score" style="font-size:13px;color:#4a9a4a">±${spread}</div>
          </div>`;
        }).join("")}
      </div>
    </div>`;
}

// ── HEAD TO HEAD TAB ──────────────────────────────────────────────
function renderH2H(summary){
  const container = document.getElementById('stats-content');
  if(!summary||!summary.rows||!summary.rows.length){
    container.innerHTML=`<div class="stats-empty">No group data available.</div>`;
    return;
  }

  const allUsers = [...new Set(summary.rows.flatMap(r=>Object.keys(r.userScores||{})))];
  if(allUsers.length<2){
    container.innerHTML=`<div class="stats-empty">Need at least 2 users with ratings for head to head.</div>`;
    return;
  }

  const u1 = allUsers[0];
  const u2 = allUsers[1];

  container.innerHTML=`
    <div class="h2h-select-row">
      <select class="h2h-select" id="h2h-user1" onchange="updateH2H()">
        ${allUsers.map(u=>`<option value="${escHtml(u)}" ${u===u1?'selected':''}>${escHtml(u)}</option>`).join("")}
      </select>
      <div class="h2h-vs">VS</div>
      <select class="h2h-select" id="h2h-user2" onchange="updateH2H()">
        ${allUsers.map(u=>`<option value="${escHtml(u)}" ${u===u2?'selected':''}>${escHtml(u)}</option>`).join("")}
      </select>
    </div>
    <div id="h2h-results"></div>`;

  updateH2H();
}

function updateH2H(){
  const u1=document.getElementById('h2h-user1')?.value;
  const u2=document.getElementById('h2h-user2')?.value;
  const results=document.getElementById('h2h-results');
  if(!results||!u1||!u2||u1===u2){ if(results) results.innerHTML='<div class="stats-empty">Please select two different users.</div>'; return; }
  const summary=getFilteredFilmSummary();
  if(!summary) return;
  const both=summary.rows.filter(row=>summaryUserDisplayScore(row,u1)!=null&&summaryUserDisplayScore(row,u2)!=null);
  if(!both.length){ results.innerHTML=`<div class="stats-empty">No films rated by both ${escHtml(u1)} and ${escHtml(u2)} yet.</div>`; return; }
  const score1=row=>summaryUserDisplayScore(row,u1);
  const score2=row=>summaryUserDisplayScore(row,u2);
  const s1=both.map(score1),s2=both.map(score2);
  const avg1=averageScores(s1).toFixed(2),avg2=averageScores(s2).toFixed(2);
  const u1Higher=both.filter(row=>score1(row)>score2(row)).length;
  const u2Higher=both.filter(row=>score2(row)>score1(row)).length;
  const tied=both.length-u1Higher-u2Higher;
  const byDiff=both.slice().sort((a,b)=>Math.abs(score2(b)-score1(b))-Math.abs(score2(a)-score1(a)));
  const byAgreement=byDiff.slice().reverse();
  results.innerHTML=`
    <div class="h2h-stat-row"><div class="h2h-stat"><div class="h2h-stat-num">${avg1}</div><div class="h2h-stat-lbl">${escHtml(u1)} avg ${scoreLabel()}</div></div><div class="h2h-stat"><div class="h2h-stat-num">${both.length}</div><div class="h2h-stat-lbl">Films both rated</div></div><div class="h2h-stat"><div class="h2h-stat-num">${avg2}</div><div class="h2h-stat-lbl">${escHtml(u2)} avg ${scoreLabel()}</div></div></div>
    <div class="h2h-stat-row"><div class="h2h-stat"><div class="h2h-stat-num">${u1Higher}</div><div class="h2h-stat-lbl">${escHtml(u1)} rated higher</div></div><div class="h2h-stat"><div class="h2h-stat-num">${tied}</div><div class="h2h-stat-lbl">Tied</div></div><div class="h2h-stat"><div class="h2h-stat-num">${u2Higher}</div><div class="h2h-stat-lbl">${escHtml(u2)} rated higher</div></div></div>
    <div class="stats-section"><div class="stats-section-title">🔥 Biggest Disagreements</div><div class="film-list">${byDiff.map((row,index)=>{const one=score1(row),two=score2(row),diff=Math.abs(one-two);return `<div class="film-row ${index>=5?'h2h-diff-extra':''}"${index>=5?' style="display:none"':''}><div class="film-row-title">${escHtml(String(row.Title||''))}</div><div class="film-row-year">${escHtml(u1)}: ${one.toFixed(1)} · ${escHtml(u2)}: ${two.toFixed(1)}</div><div class="film-row-score">Δ${diff.toFixed(1)}</div></div>`;}).join('')}</div>${byDiff.length>5?'<button class="view-all-btn" data-label="View All '+byDiff.length+' Films ↓" onclick="toggleH2HList(\'h2h-diff-extra\',this)">View All '+byDiff.length+' Films ↓</button>':''}</div>
    <div class="stats-section"><div class="stats-section-title">🤝 Most Agreement</div><div class="film-list">${byAgreement.map((row,index)=>{const one=score1(row),two=score2(row);return `<div class="film-row ${index>=5?'h2h-agreement-extra':''}"${index>=5?' style="display:none"':''}><div class="film-row-title">${escHtml(String(row.Title||''))}</div><div class="film-row-year">${escHtml(u1)}: ${one.toFixed(1)} · ${escHtml(u2)}: ${two.toFixed(1)}</div><div class="film-row-score">${one.toFixed(1)}</div></div>`;}).join('')}</div>${byAgreement.length>5?'<button class="view-all-btn" data-label="View All '+byAgreement.length+' Films ↓" onclick="toggleH2HList(\'h2h-agreement-extra\',this)">View All '+byAgreement.length+' Films ↓</button>':''}</div>
    <div class="stats-section"><div class="stats-section-title">All ${both.length} Films Both Rated</div><div style="overflow-x:auto"><table class="group-table"><thead><tr><th>Film</th><th class="tc">${escHtml(u1)}</th><th class="tc">${escHtml(u2)}</th><th class="tc">Diff</th></tr></thead><tbody>${both.slice().sort((a,b)=>((score1(b)+score2(b))/2)-((score1(a)+score2(a))/2)).map((row,index)=>{const one=score1(row),two=score2(row),diff=one-two;return `<tr class="${index>=5?'h2h-both-extra stats-extra-row':''}"><td class="film-title-cell">${escHtml(String(row.Title||''))}</td><td class="tc">${one.toFixed(1)}</td><td class="tc">${two.toFixed(1)}</td><td class="tc">${diff>0?'+':''}${diff.toFixed(1)}</td></tr>`;}).join('')}</tbody></table></div>${both.length>5?'<button class="view-all-btn" data-label="View All '+both.length+' Films ↓" onclick="toggleStatsRows(\'h2h-both-extra\',this)">View All '+both.length+' Films ↓</button>':''}</div>`;
}

function toggleH2HList(className, btn){
  const rows=document.querySelectorAll('.'+className);
  const open=[...rows].some(row=>row.style.display!=='none');
  rows.forEach(row=>row.style.display=open?'none':'flex');
  btn.textContent=open ? btn.dataset.label : 'Show Less ↑';
}

// ── TOGGLE ALL RATINGS ───────────────────────────────────────────
function toggleAllRatings(btn){
  const wrap = document.getElementById('all-ratings-wrap');
  const isOpen = wrap.classList.toggle('open');
  btn.textContent = isOpen
    ? 'Hide ↑'
    : btn.textContent.replace('Hide ↑','') || 'View All Ratings ↓';
  if(isOpen) wrap.scrollIntoView({behavior:'smooth', block:'start'});
}

// ── SHARED GROUP, COMPARISON, AND INDIVIDUAL STATS ──────────────
const _individualContexts = {};
const _comparisonContexts = {};

function summaryUsers(summary){
  return [...new Set((summary?.rows || []).flatMap(function(row){ return Object.keys(row.userScores || {}); }))].sort();
}

function renderIndividualRatings(options){
  const container = document.getElementById(options.containerId);
  const users = summaryUsers(options.summary);
  if(!users.length){
    container.innerHTML='<div class="stats-empty">No '+options.itemLabel.toLowerCase()+' have been rated yet.</div>';
    return;
  }
  const prior = _individualContexts[options.id] || {};
  _individualContexts[options.id] = {...options, selectedUser:users.includes(prior.selectedUser) ? prior.selectedUser : (users.includes(currentUser?.name) ? currentUser.name : users[0])};
  container.innerHTML=`
    <div class="stats-section">
      <div class="stats-section-title">Individual ${escHtml(options.itemLabel)} Ratings</div>
      <div class="h2h-select-row">
        <select class="h2h-select" id="individual-user-${options.id}" onchange="updateIndividualRatings('${options.id}')">
          ${users.map(function(user){ return '<option value="'+escHtml(user)+'" '+(user===_individualContexts[options.id].selectedUser?'selected':'')+'>'+escHtml(user)+'</option>'; }).join('')}
        </select>
        <input class="stats-search" id="individual-search-${options.id}" type="search" placeholder="Search this person's ratings" oninput="updateIndividualRatings('${options.id}')"/>
      </div>
      <div class="film-list" id="individual-results-${options.id}"></div>
    </div>`;
  updateIndividualRatings(options.id);
}

function updateIndividualRatings(id){
  const context = _individualContexts[id];
  if(!context) return;
  const user = document.getElementById('individual-user-'+id)?.value || context.selectedUser;
  const query = (document.getElementById('individual-search-'+id)?.value || '').trim().toLowerCase();
  context.selectedUser = user;
  const all = (context.summary?.rows || []).filter(function(row){ return summaryUserDisplayScore(row,user) != null; })
    .map(function(row){ return {row:row, score:summaryUserDisplayScore(row,user)}; })
    .sort(function(a,b){ return b.score-a.score; });
  const matches = query ? all.filter(function(entry){
    return (context.title(entry.row)+' '+context.meta(entry.row)).toLowerCase().includes(query);
  }) : all;
  const result = document.getElementById('individual-results-'+id);
  if(!result) return;
  if(!matches.length){
    result.innerHTML='<div class="stats-empty">'+(query ? escHtml(user)+' has not rated a matching item.' : escHtml(user)+' has no ratings yet.')+'</div>';
    return;
  }
  result.innerHTML=matches.map(function(entry,index){
    return `<div class="film-row"><div class="film-row-rank">#${index+1}</div><div class="film-row-title">${escHtml(context.title(entry.row))}</div><div class="film-row-year">${escHtml(context.meta(entry.row))}</div><div class="film-row-score">${entry.score.toFixed(1)}</div></div>`;
  }).join('');
}

function renderSummaryGroupStats(options){
  const container = document.getElementById(options.containerId);
  const allRows=(options.summary?.rows || []);
  const rows = allRows.filter(function(row){ return summaryDisplayScores(row).length >= 2; });
  if(!rows.length){
    container.innerHTML='<div class="stats-empty">No '+options.itemLabel.toLowerCase()+' have been rated by multiple people yet.</div>';
    return;
  }
  const users = summaryUsers(options.summary);
  const distributionValues=groupDistributionValues(options.summary);
  const ranked = rows.slice().sort(function(a,b){ return averageScores(summaryDisplayScores(b))-averageScores(summaryDisplayScores(a)); });
  const userAverages = users.map(function(user){
    const values=allRows.map(function(row){ return summaryUserDisplayScore(row,user); }).filter(function(value){ return value!=null; });
    return {user:user, average:averageScores(values)};
  }).filter(function(entry){ return entry.average !== null; }).sort(function(a,b){ return b.average-a.average; });
  const variance=function(values){ const mean=averageScores(values); return values.reduce(function(sum,value){ return sum+Math.pow(value-mean,2); },0)/values.length; };
  const withVariance=rows.map(function(row){ return {row:row,variance:variance(summaryDisplayScores(row))}; });
  const controversial=withVariance.slice().sort(function(a,b){ return b.variance-a.variance; }).slice(0,5);
  const consensus=withVariance.slice().sort(function(a,b){ return a.variance-b.variance; }).slice(0,5);
  const rankingRows=ranked.map(function(row,index){ return '<div class="film-row"><div class="film-row-rank">#'+(index+1)+'</div><div class="film-row-title">'+escHtml(options.title(row))+'</div><div class="film-row-year">'+escHtml(options.meta(row))+'</div><div class="film-row-score">'+averageScores(summaryDisplayScores(row)).toFixed(1)+'</div></div>'; }).join('');
  const varianceRows=function(entries,agreement){ return entries.map(function(entry){ return '<div class="film-row"><div class="film-row-title">'+escHtml(options.title(entry.row))+'</div><div class="film-row-year">'+escHtml(options.meta(entry.row))+'</div><div class="film-row-score">'+(agreement?'σ ':'σ ')+Math.sqrt(entry.variance).toFixed(1)+'</div></div>'; }).join(''); };
  container.innerHTML=`
    <div class="stats-section"><div class="stats-section-title">Average Rating by Person — ${scoreLabel()}</div><div class="stats-grid">
      ${userAverages.map(function(entry){ return '<div class="stat-card"><div class="stat-card-num">'+entry.average.toFixed(1)+'</div><div class="stat-card-lbl">'+escHtml(entry.user)+'</div></div>'; }).join('')}
    </div></div>
    <div class="stats-section"><div class="stats-section-title">Group Rating Distribution — ${distributionValues.length} Individual Ratings</div>${renderDistributionChart(distributionValues,{restaurant:!!options.restaurant})}</div>
    <div class="stats-section"><div class="stats-section-title">Group Rankings — ${ranked.length} ${escHtml(options.itemLabel)}</div><div class="film-list">${ranked.slice(0,5).map(function(row,index){ return '<div class="film-row"><div class="film-row-rank">#'+(index+1)+'</div><div class="film-row-title">'+escHtml(options.title(row))+'</div><div class="film-row-year">'+escHtml(options.meta(row))+'</div><div class="film-row-score">'+averageScores(summaryDisplayScores(row)).toFixed(1)+'</div></div>'; }).join('')}</div>
      ${ranked.length>5?'<button class="view-all-btn" data-label="View All '+ranked.length+' '+escHtml(options.itemLabel)+' ↓" onclick="toggleSummaryRanking(\''+options.id+'\',this)">View All '+ranked.length+' '+escHtml(options.itemLabel)+' ↓</button><div class="all-ratings-wrap" id="summary-ranking-'+options.id+'"><div class="film-list">'+rankingRows+'</div></div>':''}
    </div>
    <div class="stats-section"><div class="stats-section-title">Most Controversial</div><div class="film-list">${varianceRows(controversial,false)}</div></div>
    <div class="stats-section"><div class="stats-section-title">Strongest Consensus</div><div class="film-list">${varianceRows(consensus,true)}</div></div>`;
}
function averageScores(scores){
  const values=(scores || []).map(Number).filter(Number.isFinite);
  return values.length ? values.reduce(function(sum,value){ return sum+value; },0)/values.length : null;
}

function toggleSummaryRanking(id, button){
  const wrap=document.getElementById('summary-ranking-'+id);
  const open=wrap.classList.toggle('open');
  button.textContent=open ? 'Hide ↑' : button.dataset.label;
}

function renderSummaryH2H(options){
  const container=document.getElementById(options.containerId);
  const users=summaryUsers(options.summary);
  if(users.length<2){
    container.innerHTML='<div class="stats-empty">Need at least two people with ratings for head to head.</div>';
    return;
  }
  _comparisonContexts[options.id]={...options,users:users};
  container.innerHTML=`<div class="h2h-select-row">
    <select class="h2h-select" id="comparison-user1-${options.id}" onchange="updateSummaryH2H('${options.id}')">${users.map(function(user,index){ return '<option value="'+escHtml(user)+'" '+(!index?'selected':'')+'>'+escHtml(user)+'</option>'; }).join('')}</select>
    <div class="h2h-vs">VS</div>
    <select class="h2h-select" id="comparison-user2-${options.id}" onchange="updateSummaryH2H('${options.id}')">${users.map(function(user,index){ return '<option value="'+escHtml(user)+'" '+(index===1?'selected':'')+'>'+escHtml(user)+'</option>'; }).join('')}</select>
  </div><div id="comparison-results-${options.id}"></div>`;
  updateSummaryH2H(options.id);
}

function updateSummaryH2H(id){
  const context=_comparisonContexts[id];
  const u1=document.getElementById('comparison-user1-'+id)?.value;
  const u2=document.getElementById('comparison-user2-'+id)?.value;
  const target=document.getElementById('comparison-results-'+id);
  if(!target || !u1 || !u2 || u1===u2){
    if(target) target.innerHTML='<div class="stats-empty">Select two different users.</div>';
    return;
  }
  const both=(context.summary?.rows || []).filter(function(row){ return summaryUserDisplayScore(row,u1)!=null && summaryUserDisplayScore(row,u2)!=null; });
  if(!both.length){ target.innerHTML='<div class="stats-empty">No '+context.itemLabel.toLowerCase()+' rated by both users yet.</div>'; return; }
  const score1=function(row){ return summaryUserDisplayScore(row,u1); };
  const score2=function(row){ return summaryUserDisplayScore(row,u2); };
  const average1=averageScores(both.map(score1));
  const average2=averageScores(both.map(score2));
  const byDifference=both.slice().sort(function(a,b){ return Math.abs(score1(b)-score2(b))-Math.abs(score1(a)-score2(a)); });
  const byAgreement=byDifference.slice().reverse();
  function rowsHtml(rows,showDifference){ return rows.slice(0,5).map(function(row){ const one=score1(row); const two=score2(row); const delta=Math.abs(one-two); return '<div class="film-row"><div class="film-row-title">'+escHtml(context.title(row))+'</div><div class="film-row-year">'+escHtml(u1)+': '+one.toFixed(1)+' · '+escHtml(u2)+': '+two.toFixed(1)+'</div><div class="film-row-score">'+(showDifference?'Δ'+delta.toFixed(1):one.toFixed(1))+'</div></div>'; }).join(''); }
  const tableRows=both.slice().sort(function(a,b){ return ((score1(b)+score2(b))/2)-((score1(a)+score2(a))/2); }).map(function(row,index){ const one=score1(row),two=score2(row),diff=one-two; return '<tr class="'+(index>=5?'comparison-extra-'+id+' stats-extra-row':'')+'"><td class="film-title-cell">'+escHtml(context.title(row))+'</td><td class="tc">'+one.toFixed(1)+'</td><td class="tc">'+two.toFixed(1)+'</td><td class="tc">'+(diff>0?'+':'')+diff.toFixed(1)+'</td></tr>'; }).join('');
  target.innerHTML=`<div class="h2h-stat-row"><div class="h2h-stat"><div class="h2h-stat-num">${average1.toFixed(1)}</div><div class="h2h-stat-lbl">${escHtml(u1)} avg ${scoreLabel()}</div></div><div class="h2h-stat"><div class="h2h-stat-num">${both.length}</div><div class="h2h-stat-lbl">${escHtml(context.itemLabel)} both rated</div></div><div class="h2h-stat"><div class="h2h-stat-num">${average2.toFixed(1)}</div><div class="h2h-stat-lbl">${escHtml(u2)} avg ${scoreLabel()}</div></div></div>
  <div class="stats-section"><div class="stats-section-title">Biggest Disagreements</div><div class="film-list">${rowsHtml(byDifference,true)}</div></div>
  <div class="stats-section"><div class="stats-section-title">Most Agreement</div><div class="film-list">${rowsHtml(byAgreement,false)}</div></div>
  <div class="stats-section"><div class="stats-section-title">All ${both.length} ${escHtml(context.itemLabel)} Both Rated</div><div style="overflow-x:auto"><table class="group-table"><thead><tr><th>${escHtml(context.itemLabel.slice(0,-1)||'Item')}</th><th class="tc">${escHtml(u1)}</th><th class="tc">${escHtml(u2)}</th><th class="tc">Diff</th></tr></thead><tbody>${tableRows}</tbody></table></div>${both.length>5?'<button class="view-all-btn" data-label="View All '+both.length+' '+escHtml(context.itemLabel)+' ↓" onclick="toggleStatsRows(\'comparison-extra-'+id+'\',this)">View All '+both.length+' '+escHtml(context.itemLabel)+' ↓</button>':''}</div>`;
}


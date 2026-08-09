// ── QUICK RATING MODE ────────────────────────────────────────────────
let quickMode = true;

function toggleQuickMode(checked){
  quickMode = checked;
}

function goEditScores(){
  if(quickMode) showScreen('quick');
  else showScreen('score');
}

function updateQuickScore(val){
  const score = (Number(val)/10).toFixed(1);
  document.getElementById('quick-score-display').textContent = score;
  document.getElementById('quick-score-grade').textContent = grade(parseFloat(score));
  const pct = Number(val).toFixed(1);
  document.getElementById('quick-slider').style.setProperty('--pct', pct+'%');
}

function submitQuickRating(){
  const val = document.getElementById('quick-slider').value;
  chosenScore10 = Number((Number(val)/10).toFixed(1));
  scores = {}; notes = {};
  ratingDate = new Date().toISOString().slice(0,10);
  // Store note so generateCard can access it
  document.getElementById('overall-note').value = document.getElementById('quick-note').value || '';
  generateCard();
}

// ── CATEGORY DEFINITIONS ─────────────────────────────────────
const FILM_CATS = [
  {id:"plot",          label:"Plot & Concept",       w:0.20, prompt:"Did the story itself interest you? Was it original, did it make sense, was the ending satisfying?"},
  {id:"entertainment", label:"Entertainment Value",  w:0.25, prompt:"How engaged were you while watching? Attention, boredom, rewatchability, recommendability."},
  {id:"acting",        label:"Acting & Characters",  w:0.18, prompt:"How much did you care about the people in the movie? Performances, chemistry, believability."},
  {id:"visuals",       label:"Visuals & Production", w:0.15, prompt:"How good was it technically? Cinematography, effects, sound, music, atmosphere."},
  {id:"pacing",        label:"Pacing",               w:0.12, prompt:"Did the movie move at the right speed?"},
  {id:"emotional",     label:"Emotional Impact",     w:0.10, prompt:"How much did the movie make you feel something? Fear, laughs, tension, sadness, awe."},
];

const TV_CATS = [
  {id:"plot",          label:"Story & Concept",        w:0.20, prompt:"How strong was the season or series story, premise, and payoff?"},
  {id:"entertainment", label:"Entertainment Value",    w:0.25, prompt:"How engaging, memorable, and worth continuing was it?"},
  {id:"acting",        label:"Performances & Cast",    w:0.18, prompt:"How effective were the performances, characters, and chemistry?"},
  {id:"visuals",       label:"Production & Direction", w:0.15, prompt:"How good were the visuals, music, direction, and technical work?"},
  {id:"pacing",        label:"Pacing",                 w:0.12, prompt:"Did the season or series use its episodes well?"},
  {id:"emotional",     label:"Impact",                 w:0.10, prompt:"How much did it make you feel, think, or want to discuss it?"}
];

// Restaurant categories ready to drop in when needed
const RESTAURANT_CATS = [
  {id:"food",      label:"Food & Taste",    w:0.35, prompt:"How good was the food? Flavor, quality, seasoning, memorability."},
  {id:"value",     label:"Value",           w:0.20, prompt:"Was it worth the price?"},
  {id:"service",   label:"Service",         w:0.18, prompt:"How was the service? Fast, friendly, attentive, mistakes?"},
  {id:"atmosphere",label:"Atmosphere",      w:0.18, prompt:"Did you enjoy being there? Vibe, decor, noise level, comfort, cleanliness."},
  {id:"craving",   label:"Craving Factor",  w:0.10, prompt:"How badly do you want to go back? Would you recommend to others?"},
];

let CATS = FILM_CATS; // active category set

// ── HELPERS ──────────────────────────────────────────────────
function grade(s) {
  s = Number(s);
  if(!isFinite(s)) return "F";
  if(s >= 10)return"S";
  if(s >= 9.5)return"A+"; if(s >= 9.0)return"A";  if(s >= 8.5)return"A-";
  if(s >= 8.0)return"B+"; if(s >= 7.5)return"B";  if(s >= 7.0)return"B-";
  if(s >= 6.5)return"C+"; if(s >= 6.0)return"C";  if(s >= 5.5)return"C-";
  if(s >= 5.0)return"D+"; if(s >= 4.5)return"D";  if(s >= 4.0)return"D-";
  return"F";
}
function gradeFromRaw(raw){ return grade(Number(raw)/10); }
function weightedTotal(categories, values){
  const weightTotal=(categories||[]).reduce((sum,category)=>sum+Number(category.w||0),0) || 1;
  const weighted=(categories||[]).reduce((sum,category)=>sum+Number(values[category.id]||0)*Number(category.w||0),0);
  return weighted/weightTotal;
}
function calcTotal(){
  const values={};
  CATS.forEach(category=>{ values[category.id]=Number(document.getElementById("inp-"+category.id)?.value||0); });
  return weightedTotal(CATS,values);
}
function escHtml(s){
  return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}
function scoreToTenth(raw){
  const score=Number(raw||0)/10;
  return Math.round((score+Number.EPSILON)*10)/10;
}
function storedNumber(value){
  if(value===null || value===undefined || String(value).trim()==='') return null;
  const number=Number(value);
  return Number.isFinite(number) ? number : null;
}
function rawScoreForRating(rating){
  const raw=storedNumber(rating?.['Raw /100']);
  if(raw!==null) return raw;
  const score10=storedNumber(rating?.['Score /10']);
  return score10===null ? null : score10*10;
}
function ratingDisplayScore(rating){
  if(_scoreMode==='raw') return rawScoreForRating(rating) ?? 0;
  return storedNumber(rating?.['Score /10']) ?? 0;
}
function summaryUserDisplayScore(row,user){
  if(_scoreMode==='raw'){
    const raw=storedNumber(row?.userRawScores?.[user]);
    if(raw!==null) return raw;
    const score10=storedNumber(row?.userScores?.[user]);
    return score10===null ? null : score10*10;
  }
  return storedNumber(row?.userScores?.[user]);
}
function summaryDisplayScores(row){
  const source=_scoreMode==='raw' && Array.isArray(row?.rawScores) && row.rawScores.length ? row.rawScores : row?.scores;
  const values=(source||[]).map(Number).filter(Number.isFinite);
  return _scoreMode==='raw' && source===row?.scores ? values.map(value=>value*10) : values;
}
function groupDistributionValues(summary){
  const values=[];
  (summary?.rows||[]).forEach(function(row){
    const users=Object.keys(row?.userScores||{});
    users.forEach(function(user){
      const raw=storedNumber(row?.userRawScores?.[user]);
      const score10=storedNumber(row?.userScores?.[user]);
      const normalizedRaw=raw!==null ? raw : (score10===null ? null : score10*10);
      if(normalizedRaw!==null && Number.isFinite(Number(normalizedRaw))) values.push(Number(normalizedRaw));
    });
  });
  return values;
}
let _distributionPopupTimer=null;
function showDistributionCount(event,count){
  const bar=event.currentTarget;
  const wrap=bar?.closest('.distribution-chart-wrap');
  if(!wrap) return;
  let popup=wrap.querySelector('.distribution-popup');
  if(!popup){
    popup=document.createElement('div');
    popup.className='distribution-popup';
    wrap.appendChild(popup);
  }
  popup.textContent=String(count);
  const wrapRect=wrap.getBoundingClientRect();
  const barRect=bar.getBoundingClientRect();
  const x=event.clientX ? event.clientX-wrapRect.left : barRect.left-wrapRect.left+(barRect.width/2);
  const y=event.clientY ? event.clientY-wrapRect.top : barRect.top-wrapRect.top;
  popup.style.left=Math.max(18,Math.min(wrapRect.width-18,x))+'px';
  popup.style.top=Math.max(40,y)+'px';
  popup.classList.add('visible');
  clearTimeout(_distributionPopupTimer);
  _distributionPopupTimer=setTimeout(function(){ popup.classList.remove('visible'); },1400);
}
function distributionBarKeydown(event,count){
  if(event.key==='Enter' || event.key===' '){
    event.preventDefault();
    showDistributionCount(event,count);
  }
}
function renderDistributionChart(values,{restaurant=false}={}){
  const rawScores=(values||[]).map(Number).filter(Number.isFinite).map(function(value){ return Math.max(0,Math.min(100,value)); });
  if(!rawScores.length) return '<div class="stats-empty">No score distribution is available yet.</div>';
  const useRaw=_scoreMode==='raw';
  const maxScore=useRaw ? 100 : 10;
  const binSize=useRaw ? 5 : 0.5;
  const minSpan=useRaw ? 20 : 2;
  const scores=rawScores.map(function(value){ return useRaw ? value : value/10; });
  const lowest=Math.min.apply(null,scores);
  let axisMin=Math.floor(lowest/(useRaw?10:1))*(useRaw?10:1)-binSize;
  axisMin=Math.max(0,axisMin);
  axisMin=Math.min(axisMin,maxScore-minSpan);
  axisMin=Math.floor(axisMin/binSize)*binSize;
  const binCount=Math.max(1,Math.round((maxScore-axisMin)/binSize));
  const counts=Array.from({length:binCount},function(){ return 0; });
  scores.forEach(function(value){
    const index=Math.min(binCount-1,Math.max(0,Math.floor((value-axisMin)/binSize)));
    counts[index]++;
  });
  const average=scores.reduce(function(sum,value){ return sum+value; },0)/scores.length;
  const width=760,height=290,left=48,right=18,top=24,bottom=48;
  const chartWidth=width-left-right, chartHeight=height-top-bottom;
  const maxCount=Math.max.apply(null,counts.concat([1]));
  const x=function(value){ return left+((value-axisMin)/(maxScore-axisMin))*chartWidth; };
  const y=function(count){ return top+chartHeight-(count/maxCount)*chartHeight; };
  const barWidth=chartWidth/binCount;
  const yTicks=[...new Set([0,Math.ceil(maxCount/3),Math.ceil(maxCount*2/3),maxCount])].sort(function(a,b){ return a-b; });
  const majorStep=useRaw ? 10 : 1;
  const xTicks=[];
  for(let value=Math.ceil(axisMin/majorStep)*majorStep; value<=maxScore+0.0001; value+=majorStep) xTicks.push(Number(value.toFixed(1)));
  if(!xTicks.length || xTicks[0]!==axisMin) xTicks.unshift(Number(axisMin.toFixed(1)));
  const axisTitle=useRaw ? 'Score /100 · 5-point bins' : 'Score /10 · 0.5-point bins';
  const rangeText=`Distribution shown from ${axisMin.toFixed(useRaw?0:1)}–${maxScore.toFixed(useRaw?0:1)}`;
  return `<div class="distribution-chart-wrap${restaurant?' restaurant':''}">
    <svg class="distribution-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Score distribution from ${axisMin} to ${maxScore} with an average of ${average.toFixed(1)}">
      ${yTicks.map(function(tick){ return `<line class="distribution-grid" x1="${left}" y1="${y(tick)}" x2="${width-right}" y2="${y(tick)}"></line><text class="distribution-label" x="${left-9}" y="${y(tick)+4}" text-anchor="end">${tick}</text>`; }).join('')}
      ${xTicks.map(function(value){ return `<text class="distribution-label" x="${x(value)}" y="${height-22}" text-anchor="middle">${value}</text>`; }).join('')}
      <line class="distribution-axis" x1="${left}" y1="${top+chartHeight}" x2="${width-right}" y2="${top+chartHeight}"></line>
      <line class="distribution-axis" x1="${left}" y1="${top}" x2="${left}" y2="${top+chartHeight}"></line>
      ${counts.map(function(count,index){
        const barHeight=count ? Math.max(2,top+chartHeight-y(count)) : 0;
        const barY=top+chartHeight-barHeight;
        const low=axisMin+index*binSize;
        const high=Math.min(maxScore,low+binSize);
        const interaction=count ? `tabindex="0" role="button" aria-label="${count} ratings from ${low.toFixed(useRaw?0:1)} to ${high.toFixed(useRaw?0:1)}" onclick="showDistributionCount(event,${count})" onkeydown="distributionBarKeydown(event,${count})"` : 'aria-hidden="true"';
        return `<rect class="distribution-bar" ${interaction} data-count="${count}" x="${left+index*barWidth+2}" y="${barY}" width="${Math.max(1,barWidth-4)}" height="${barHeight}" rx="2"></rect>`;
      }).join('')}
      <line class="distribution-average" x1="${x(average)}" y1="${top-4}" x2="${x(average)}" y2="${top+chartHeight}"></line>
      <text class="distribution-average-label" x="${Math.min(width-right-4,Math.max(left+4,x(average)+6))}" y="${top+9}">AVG ${average.toFixed(1)}</text>
      <text class="distribution-axis-title" x="${left+chartWidth/2}" y="${height-4}" text-anchor="middle">${axisTitle}</text>
      <text class="distribution-axis-title" transform="translate(12 ${top+chartHeight/2}) rotate(-90)" text-anchor="middle">Number of ratings</text>
    </svg>
    <div class="distribution-popup" aria-live="polite"></div>
    <div class="distribution-note">${rangeText}. Click a bar to see its count. The dashed line marks the average.</div>
  </div>`;
}

// ── STATE ────────────────────────────────────────────────────
let currentMovie  = null;
let scores        = {};
let notes         = {};
let chosenScore10 = null;
let ratingDate    = "";
let currentUser   = null; // {name}
let activeCategory = 'film';

// ── PERSISTENCE ──────────────────────────────────────────────
// ── USER / SESSION STORAGE ───────────────────────────────────
let _usersCache = [];
let sessionToken = null;
let adminToken = null;

async function apiCall(action, payload = {}){
  if(!CONFIG.GAS_URL) throw new Error("Apps Script backend URL is not configured.");
  const res = await fetch(CONFIG.GAS_URL, {
    method: "POST",
    headers: {"Content-Type": "text/plain;charset=utf-8"},
    body: JSON.stringify({action, ...payload})
  });
  const text = await res.text();
  if(!text || text.trim().startsWith("<")) throw new Error("Backend returned an HTML/error page.");
  const data = JSON.parse(text);
  if(data.error) throw new Error(data.error);
  if(data.ok === false) throw new Error(data.error || "Backend request failed.");
  return data.result !== undefined ? data.result : data;
}

function getUsers(){ return _usersCache || []; }
function setCachedUsers(users){ _usersCache = Array.isArray(users) ? users : []; }
function getStoredSession(){
  try{ return JSON.parse(localStorage.getItem("cf_session")||"null"); }
  catch(e){ return null; }
}
function setStoredSession(token, user){
  if(token && user) localStorage.setItem("cf_session", JSON.stringify({token, user}));
  else localStorage.removeItem("cf_session");
}
function setSavedUser(user){
  if(user) setStoredSession(sessionToken, user);
  else setStoredSession(null, null);
}
function getSessionToken(){ return sessionToken || getStoredSession()?.token || ""; }
async function syncUsersFromSheets(){
  if(!CONFIG.GAS_URL) return;
  try{
    const data = await apiCall("getUsers");
    setCachedUsers(data.users || data || []);
  }catch(e){
    console.log("Could not sync users:", e.message);
    setCachedUsers([]);
  }
}
function getStoredConfig(){
  try{ return JSON.parse(localStorage.getItem("cf_config")||"{}"); }
  catch(e){ return {}; }
}
function saveStoredConfig(c){ localStorage.setItem("cf_config", JSON.stringify(c)); }
function applyStoredConfig(){
  const c = getStoredConfig();
  if(c.GAS_URL) CONFIG.GAS_URL = c.GAS_URL;
}

// ── USER THEME ───────────────────────────────────────────────
const THEME_KEY = "cf_theme";
const THEME_CLASSES = ["theme-classic","theme-cream","theme-gold"];
function normalizeTheme(theme){
  return ["classic","cream","gold"].includes(theme) ? theme : "classic";
}
function getStoredTheme(){
  try{ return normalizeTheme(localStorage.getItem(THEME_KEY) || "gold"); }
  catch(e){ return "gold"; }
}
function applyTheme(theme){
  theme = normalizeTheme(theme);
  document.body.classList.remove(...THEME_CLASSES);
  document.body.classList.add("theme-"+theme);
  const sel = document.getElementById("theme-select");
  if(sel) sel.value = theme;
}
function setTheme(theme){
  theme = normalizeTheme(theme);
  try{ localStorage.setItem(THEME_KEY, theme); }catch(e){}
  applyTheme(theme);
}

function goHome(){
  if(!currentUser || !getSessionToken()){
    showLogin();
    return;
  }
  quickMode = true;
  lgQuickMode = true;
  const toggle = document.getElementById('quick-mode-toggle');
  if(toggle) toggle.checked = true;
  const lgToggle = document.getElementById('lg-quick-toggle');
  if(lgToggle) lgToggle.checked = true;
  showScreen("home");
  window.clearTimeout(window.recentActivityLoadTimer);
  window.recentActivityLoadTimer=window.setTimeout(loadRecentActivity,600);
}

function showLogin(){
  setLgMode(false);
  showScreen("pin");
  renderPinScreen();
}

function switchUser(){
  setSavedUser(null);
  sessionToken = null;
  currentUser = null;
  adminToken = null;
  showLogin();
}

// ── HOME ─────────────────────────────────────────────────────
// ── PIN SCREEN ───────────────────────────────────────────────
let pinSelected = null;
let pinEntered  = "";

function renderPinScreen(){
  pinSelected = null; pinEntered = "";
  const users = getUsers().slice().sort((a,b)=>String(a.name).localeCompare(String(b.name), undefined, {sensitivity:"base"}));
  const list  = document.getElementById("pin-user-list");
  document.getElementById("pin-entry").style.display = "none";
  document.getElementById("pin-error").textContent = "";
  syncPinInput();
  if(!users.length){
    list.innerHTML = `<div style="color:#3d6a3d;font-size:13px;font-style:italic;padding:8px 0">No users yet — go to Settings to add users.</div>
      <button class="btn-pri" style="margin-top:12px" onclick="promptAdminPin()">Go to Settings →</button>`;
    return;
  }
  list.innerHTML = users.map(u=>`
    <button class="user-btn" onclick='selectPinUser(${JSON.stringify(u.name)})'>${escHtml(u.name)}</button>`).join("");
}

function selectPinUser(name){
  pinSelected = name; pinEntered = "";
  document.querySelectorAll(".user-btn").forEach(b=>{
    b.classList.toggle("selected", b.textContent===name);
  });
  document.getElementById("pin-entry").style.display = "block";
  document.getElementById("pin-entry-label").textContent = `Enter PIN for ${name}`;
  document.getElementById("pin-error").textContent = "";
  updatePinDots();
  focusPinInput();
}

function pinKey(k){
  if(pinEntered.length >= 4) return;
  pinEntered += k;
  updatePinDots();
  focusPinInput();
  if(pinEntered.length === 4) checkPin();
}
function pinBack(){ pinEntered = pinEntered.slice(0,-1); updatePinDots(); focusPinInput(); }
function pinClear(){ pinEntered = ""; updatePinDots(); focusPinInput(); }
function updatePinDots(){
  syncPinInput();
  for(let i=0;i<4;i++){
    document.getElementById("pd"+i).classList.toggle("filled", i < pinEntered.length);
  }
}

function syncPinInput(){
  const input = document.getElementById("pin-mobile-input");
  if(input && input.value !== pinEntered) input.value = pinEntered;
}

function focusPinInput(){
  const input = document.getElementById("pin-mobile-input");
  if(!input) return;
  input.value = pinEntered;
  input.focus({preventScroll:true});
}

function handlePinInput(value){
  pinEntered = String(value || "").replace(/\D/g,"").slice(0,4);
  updatePinDots();
  if(pinEntered.length === 4) checkPin();
}

function bindPinInput(){
  const input = document.getElementById("pin-mobile-input");
  if(!input || input.dataset.bound) return;
  input.dataset.bound = "1";
  input.addEventListener("input", e=>handlePinInput(e.target.value));
  input.addEventListener("keydown", e=>{
    if(e.key === "Backspace" && !input.value){
      pinBack();
      e.preventDefault();
    }
  });
}

async function checkPin(){
  const user = getUsers().find(u=>u.name===pinSelected);
  if(!user) return;
  try{
    document.getElementById("pin-error").textContent = "";
    const data = await apiCall("login", {username: pinSelected, name: pinSelected, pin: pinEntered});
    sessionToken = data.token;
    currentUser = data.user || {name: data.username || pinSelected};
    setSavedUser(currentUser);
    updateNavUser();
    goHome();
    prefetchRatings();
  }catch(e){
    document.getElementById("pin-error").textContent = e.message || "Incorrect PIN. Try again.";
    pinEntered = "";
    updatePinDots();
  }
}

function updateNavUser(){
  document.getElementById("nav-user-name").textContent = currentUser?.name || "";
}

// ── SETTINGS — USERS ─────────────────────────────────────────
function renderSettingsUsers(){
  const users = getUsers();
  document.getElementById("settings-user-list").innerHTML = users.length
    ? users.map((u,i)=>`
        <div class="user-row">
          <div class="user-row-name">${escHtml(u.name)}</div>
          <div class="user-row-pin">PIN: ••••</div>
          <button class="user-row-del" onclick="deleteUser(${i})">Remove</button>
        </div>`).join("")
    : `<div style="color:#3d6a3d;font-size:13px;font-style:italic">No users yet.</div>`;
}

async function addUser(){
  const name = document.getElementById("new-user-name").value.trim();
  const pin  = document.getElementById("new-user-pin").value.trim();
  const msg  = document.getElementById("settings-msg");
  if(!adminToken){ msg.textContent="Admin session expired. Reopen Settings."; msg.className="settings-msg err"; return; }
  if(!name){ msg.textContent="Please enter a name."; msg.className="settings-msg err"; return; }
  if(!/^\d{4}$/.test(pin)){ msg.textContent="PIN must be exactly 4 digits."; msg.className="settings-msg err"; return; }
  try{
    await apiCall("addUser", {adminToken, name, pin});
    await syncUsersFromSheets();
    document.getElementById("new-user-name").value="";
    document.getElementById("new-user-pin").value="";
    msg.textContent=`✓ ${name} added.`; msg.className="settings-msg";
    renderSettingsUsers();
  }catch(e){
    msg.textContent=e.message || "Could not add user."; msg.className="settings-msg err";
  }
}

async function deleteUser(i){
  const users = getUsers();
  const removed = users[i];
  if(!removed || !adminToken) return;
  try{
    await apiCall("deleteUser", {adminToken, name: removed.name});
    await syncUsersFromSheets();
    document.getElementById("settings-msg").textContent=`Removed ${removed.name}.`;
    document.getElementById("settings-msg").className="settings-msg";
    renderSettingsUsers();
  }catch(e){
    document.getElementById("settings-msg").textContent=e.message || "Could not remove user.";
    document.getElementById("settings-msg").className="settings-msg err";
  }
}

// ── SETTINGS — CONFIG ─────────────────────────────────────────
async function loadConfigFields(){
  const c = getStoredConfig();
  document.getElementById("cfg-gas").value = c.GAS_URL || CONFIG.GAS_URL || "";
  const msg = document.getElementById("config-msg");
  if(!CONFIG.GAS_URL){ msg.textContent="Backend URL is not configured."; msg.className="settings-msg err"; return; }
  try{
    const status = await apiCall("getDeploymentStatus", {adminToken});
    const missing = [];
    if(!status.hasSheetId) missing.push("SHEET_ID");
    if(!status.hasAdminPin) missing.push("ADMIN_PIN");
    if(!status.hasTmdbKey) missing.push("TMDB_API_KEY");
    if(!status.hasPlacesKey) missing.push("GOOGLE_PLACES_KEY");
    msg.textContent = missing.length ? `Missing script properties: ${missing.join(", ")}` : "Backend is configured.";
    msg.className = missing.length ? "settings-msg err" : "settings-msg";
  }catch(e){
    msg.textContent = e.message || "Could not reach backend.";
    msg.className = "settings-msg err";
  }
}
function saveConfig(){
  const c = {GAS_URL: document.getElementById("cfg-gas").value.trim()};
  saveStoredConfig(c);
  applyStoredConfig();
  settingsLoaded = false;
  const msg = document.getElementById("config-msg");
  msg.textContent="Backend URL saved to this device."; msg.className="settings-msg";
  syncUsersFromSheets();
}


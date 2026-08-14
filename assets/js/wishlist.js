// ── WISHLIST ─────────────────────────────────────────────────
let wishlistMode = 'film';
let wishlistSearchTimer = null;
let wishlistResults = [];
let wishlistItems = [];
let wishlistSearchRequest = 0;
const wishlistCache = new Map();
const wishlistSearchCache = new Map();

function wishlistUserCacheKey(){
  const user = currentUser && (currentUser.name || currentUser.username || currentUser);
  return wishlistMode + '|' + String(user || '').trim().toLowerCase();
}

function goWishlist(mode){
  wishlistMode = ['film','restaurant','tv'].includes(mode) ? mode : 'film';
  showScreen('wishlist');
  renderWishlistMode();
  loadWishlist();
}

function renderWishlistMode(){
  const films = wishlistMode === 'film';
  const tv = wishlistMode === 'tv';
  document.getElementById('wishlist-title').textContent = films ? 'Film Wishlist' : (tv ? 'TV Wishlist' : 'Restaurant Wishlist');
  document.getElementById('wishlist-sub').textContent = films ? 'Search for films you want to watch.' : (tv ? 'Search for series you want to watch.' : 'Search for restaurants you want to try.');
  document.getElementById('wishlist-search-icon').textContent = films ? '🎬' : (tv ? '📺' : '🍽️');
  document.getElementById('wishlist-search-input').placeholder = films ? 'Search for a film to save...' : (tv ? 'Search for a series to save...' : 'Search for a restaurant to save...');
  document.getElementById('wishlist-list-title').textContent = films ? 'Your Saved Films' : (tv ? 'Your Saved Series' : 'Your Saved Restaurants');
  document.getElementById('wishlist-search-input').value = '';
  document.getElementById('wishlist-dropdown').classList.remove('open');
  document.getElementById('wishlist-msg').textContent = '';
  document.getElementById('film-recommendation-section').style.display = films ? 'block' : 'none';
  document.getElementById('tv-recommendation-section').style.display = tv ? 'block' : 'none';
  document.getElementById('restaurant-recommendation-section').style.display = (!films && !tv) ? 'block' : 'none';
  document.getElementById('restaurant-wishlist-location').style.display = (!films && !tv) ? 'block' : 'none';
  if(!films) document.getElementById('recommend-panel').classList.remove('open');
  if(!tv) document.getElementById('tv-recommend-panel').classList.remove('open');
  if(films||tv) document.getElementById('restaurant-recommend-panel').classList.remove('open');
  if(!films && !tv) prepareRestaurantLocation();
}

async function loadWishlist(force){
  const list = document.getElementById('wishlist-items');
  if(!currentUser || !getSessionToken()){
    list.innerHTML = '<div class="stats-empty">Log in to view your wishlist.</div>';
    return;
  }
  const cacheKey = wishlistUserCacheKey();
  const cached = wishlistCache.get(cacheKey);
  if(!force && cached && Date.now() - cached.savedAt < 30000){
    wishlistItems = cached.items;
    renderWishlistItems();
    return;
  }
  list.innerHTML = '<div class="stats-loading">Loading your saved items...</div>';
  try{
    const action = wishlistMode === 'film' ? 'getFutureFilms' : (wishlistMode === 'tv' ? 'getFutureTv' : 'getFutureRestaurants');
    const data = await apiCall(action, {token:getSessionToken()});
    wishlistItems = Array.isArray(data) ? data : [];
    wishlistCache.set(cacheKey, {items:wishlistItems, savedAt:Date.now()});
    renderWishlistItems();
  }catch(e){
    list.innerHTML = '<div class="stats-empty">Could not load your wishlist.</div>';
  }
}

function renderWishlistItems(){
  const list = document.getElementById('wishlist-items');
  const films = wishlistMode === 'film';
  const tv = wishlistMode === 'tv';
  if(!wishlistItems.length){
    list.innerHTML = '<div class="stats-empty">No saved ' + (films ? 'films' : (tv ? 'series' : 'restaurants')) + ' yet.</div>';
    return;
  }
  list.innerHTML = wishlistItems.map(function(item, index){
    const title = films ? item['Title'] : (tv ? item['Series'] : item['Name']);
    const meta = films
      ? [item['Year'], item['Director'] && 'Dir. ' + item['Director'], item['Movie length'], item['IMDb'] && 'IMDb ' + item['IMDb'], item['RT Audience'] && 'RT ' + item['RT Audience']].filter(Boolean).join(' · ')
      : (tv ? [item['Year'], item['Creator'] && 'Created by ' + item['Creator'], item['IMDb'] && 'IMDb ' + item['IMDb']].filter(Boolean).join(' · ') : [item['Cuisine'], item['Address'], item['Google Rating'] && 'Google ' + item['Google Rating']].filter(Boolean).join(' · '));
    const average = item['Group Average'];
    const count = Number(item['Group Rating Count'] || 0);
    return '<div class="wishlist-item">' +
      '<div class="wishlist-item-main"><div class="wishlist-item-title">' + escHtml(String(title || '')) + '</div><div class="wishlist-item-meta">' + escHtml(meta) + '</div></div>' +
      '<div class="wishlist-item-score">' + (average === '' || average == null ? '—' : Number(average).toFixed(1)) + '<span>' + (count ? 'group avg (' + count + ')' : 'not rated yet') + '</span></div>' +
      '<button class="wishlist-remove" onclick="removeWishlistItem(' + index + ')">Remove</button>' +
    '</div>';
  }).join('');
}

async function removeWishlistItem(index){
  const item = wishlistItems[index];
  if(!item) return;
  try{
    const action = wishlistMode === 'film' ? 'deleteFutureFilm' : (wishlistMode === 'tv' ? 'deleteFutureTv' : 'deleteFutureRestaurant');
    await apiCall(action, {token:getSessionToken(), payload:item});
    wishlistItems.splice(index, 1);
    wishlistCache.set(wishlistUserCacheKey(), {items:wishlistItems, savedAt:Date.now()});
    renderWishlistItems();
  }catch(e){
    const msg = document.getElementById('wishlist-msg');
    msg.textContent = e.message || 'Could not remove saved item.';
    msg.className = 'settings-msg err';
  }
}

async function searchWishlist(query){
  const dropdown = document.getElementById('wishlist-dropdown');
  const spinner = document.getElementById('wishlist-spinner');
  if(!query){ dropdown.classList.remove('open'); return; }
  const request = ++wishlistSearchRequest;
  const location = wishlistMode === 'restaurant' ? restaurantSearchPayload(query) : null;
  const cacheKey = wishlistMode + '|' + query.toLowerCase() + '|' + JSON.stringify(location || {});
  const cached = wishlistSearchCache.get(cacheKey);
  if(cached && Date.now() - cached.savedAt < 120000){
    wishlistResults = cached.items;
    renderWishlistResults();
    return;
  }
  spinner.classList.add('visible');
  try{
    const action = wishlistMode === 'film' ? 'searchMovies' : (wishlistMode === 'tv' ? 'searchTv' : 'searchRestaurants');
    const data = await apiCall(action, {token:getSessionToken(), ...(location || {query:query})});
    if(request !== wishlistSearchRequest) return;
    wishlistResults = (data.results || data || []).slice(0, 7);
    wishlistSearchCache.set(cacheKey, {items:wishlistResults, savedAt:Date.now()});
    renderWishlistResults();
  }catch(e){
    dropdown.classList.remove('open');
  }
  if(request === wishlistSearchRequest) spinner.classList.remove('visible');
}

function renderWishlistResults(){
  const dropdown = document.getElementById('wishlist-dropdown');
  const films = wishlistMode === 'film';
  const tv = wishlistMode === 'tv';
  if(!wishlistResults.length){ dropdown.classList.remove('open'); return; }
  dropdown.innerHTML = wishlistResults.map(function(item, index){
    const title = films ? item.title : (tv ? item.name : item.name);
    const meta = films ? (item.year || String(item.release_date || '').slice(0,4)) : (tv ? item.year : [item.cuisine, item.address].filter(Boolean).join(' · '));
    return '<button class="wishlist-result" onclick="addWishlistResult(' + index + ', this)"><span class="wishlist-result-title">' + escHtml(String(title || '')) + '<br><small>' + escHtml(String(meta || '')) + '</small></span><span class="wishlist-add">Save</span></button>';
  }).join('');
  dropdown.classList.add('open');
}

async function addWishlistResult(index, button){
  const item = wishlistResults[index];
  if(!item) return;
  const dropdown = document.getElementById('wishlist-dropdown');
  const msg = document.getElementById('wishlist-msg');
  dropdown.classList.remove('open');
  if(button){ button.disabled = true; button.querySelector('.wishlist-add').textContent = 'Saving...'; }
  msg.textContent = 'Saving...'; msg.className = 'settings-msg';
  try{
    let payload = item;
    let action = 'addFutureFilm';
    if(wishlistMode === 'film'){
      payload = await apiCall('getMovieDetails', {token:getSessionToken(), id:item.id});
    } else if(wishlistMode === 'tv'){
      action = 'addFutureTv';
      payload = await apiCall('getTvDetails', {token:getSessionToken(), id:item.id});
    } else {
      action = 'addFutureRestaurant';
    }
    await apiCall(action, {token:getSessionToken(), payload:payload});
    wishlistCache.delete(wishlistUserCacheKey());
    msg.textContent = 'Saved to your wishlist.'; msg.className = 'settings-msg';
    document.getElementById('wishlist-search-input').value = '';
    await loadWishlist(true);
  }catch(e){
    msg.textContent = e.message || 'Could not save item.'; msg.className = 'settings-msg err';
    if(button){ button.disabled = false; button.querySelector('.wishlist-add').textContent = 'Save'; }
  }
}

document.getElementById('wishlist-search-input').addEventListener('input', function(){
  const query = this.value.trim();
  clearTimeout(wishlistSearchTimer);
  if(!query){ document.getElementById('wishlist-dropdown').classList.remove('open'); return; }
  wishlistSearchTimer = setTimeout(function(){ searchWishlist(query); }, 320);
});
document.getElementById('wishlist-search-input').addEventListener('blur', function(){
  setTimeout(function(){ document.getElementById('wishlist-dropdown').classList.remove('open'); }, 160);
});



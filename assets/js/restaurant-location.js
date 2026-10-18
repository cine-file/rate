// ── RESTAURANT SEARCH AREA ────────────────────────────────────
// Search area is deliberately stored in the browser, per signed-in user.
// It is only sent to Apps Script when a Restaurant search or recommendation is requested.
const RESTAURANT_LOCATION_STORAGE_PREFIX = 'cine-file.restaurant-location.';
const US_STATES = Object.entries({AL:'Alabama',AK:'Alaska',AZ:'Arizona',AR:'Arkansas',CA:'California',CO:'Colorado',CT:'Connecticut',DE:'Delaware',DC:'District of Columbia',FL:'Florida',GA:'Georgia',HI:'Hawaii',ID:'Idaho',IL:'Illinois',IN:'Indiana',IA:'Iowa',KS:'Kansas',KY:'Kentucky',LA:'Louisiana',ME:'Maine',MD:'Maryland',MA:'Massachusetts',MI:'Michigan',MN:'Minnesota',MS:'Mississippi',MO:'Missouri',MT:'Montana',NE:'Nebraska',NV:'Nevada',NH:'New Hampshire',NJ:'New Jersey',NM:'New Mexico',NY:'New York',NC:'North Carolina',ND:'North Dakota',OH:'Ohio',OK:'Oklahoma',OR:'Oregon',PA:'Pennsylvania',RI:'Rhode Island',SC:'South Carolina',SD:'South Dakota',TN:'Tennessee',TX:'Texas',UT:'Utah',VT:'Vermont',VA:'Virginia',WA:'Washington',WV:'West Virginia',WI:'Wisconsin',WY:'Wyoming',AS:'American Samoa',GU:'Guam',MP:'Northern Mariana Islands',PR:'Puerto Rico',VI:'US Virgin Islands'}).sort((a,b)=>a[1].localeCompare(b[1]));
let restaurantSearchArea = { city:'', region:'', country:'United States', lat:null, lng:null };
let restaurantLocationRevision = 0;

function restaurantCountry(value){
  const country=cleanRestaurantLocationValue(value);
  return !country || /^(us|usa|u\.s\.?a?\.?|united states(?: of america)?)$/i.test(country) ? 'United States' : country;
}

function restaurantState(value){
  const term=cleanRestaurantLocationValue(value).toLowerCase();
  const state=US_STATES.find(([code,name])=>code.toLowerCase()===term || name.toLowerCase()===term);
  return state ? state[0] : '';
}

function restaurantCoordinate(value,max){
  if(value==null || String(value).trim()==='') return null;
  const number=Number(value);
  return Number.isFinite(number) && Math.abs(number)<=max ? number : null;
}

function configureRestaurantState(select,country,value){
  const us=restaurantCountry(country)==='United States';
  select.disabled=!us;
  select.innerHTML=us ? '<option value="">All states</option>'+US_STATES.map(([code,name])=>'<option value="'+code+'">'+name+'</option>').join('') : '<option value="">N/A</option>';
  select.value=us ? restaurantState(value) : '';
}

function restaurantLocationUserKey(){
  const user = currentUser && (currentUser.name || currentUser.username || currentUser);
  return String(user || 'anonymous').trim().toLowerCase();
}

function cleanRestaurantLocationValue(value){
  return String(value || '').trim().slice(0, 80);
}

function restaurantLocationStorageKey(){
  return RESTAURANT_LOCATION_STORAGE_PREFIX + restaurantLocationUserKey();
}

function loadRestaurantSearchArea(){
  try{
    const saved = JSON.parse(localStorage.getItem(restaurantLocationStorageKey()) || '{}');
    restaurantSearchArea = {
      city:cleanRestaurantLocationValue(saved.city),
      region:restaurantCountry(saved.country)==='United States' ? restaurantState(saved.region) : '',
      country:restaurantCountry(saved.country),
      lat:restaurantCoordinate(saved.lat,90),
      lng:restaurantCoordinate(saved.lng,180)
    };
  }catch(e){
    restaurantSearchArea = { city:'', region:'', country:'United States', lat:null, lng:null };
  }
}

function saveRestaurantSearchArea(){
  try{ localStorage.setItem(restaurantLocationStorageKey(), JSON.stringify(restaurantSearchArea)); }
  catch(e){}
}

function restaurantAreaLabel(){
  return [restaurantSearchArea.city, restaurantSearchArea.region, restaurantSearchArea.country].filter(Boolean).join(', ');
}

function setRestaurantLocationStatus(message, isError){
  document.querySelectorAll('[data-restaurant-location-status]').forEach(function(node){
    node.textContent = message || '';
    node.classList.toggle('error', !!isError);
  });
}

function syncRestaurantLocationInputs(){
  document.querySelectorAll('[data-restaurant-location-field]').forEach(function(input){
    const field = input.dataset.restaurantLocationField;
    if(field==='region') configureRestaurantState(input,restaurantSearchArea.country,restaurantSearchArea.region);
    else if(field) input.value = restaurantSearchArea[field] || '';
  });
}

function prepareRestaurantLocation(){
  loadRestaurantSearchArea();
  syncRestaurantLocationInputs();
  setRestaurantLocationStatus('');
}

function updateRestaurantSearchArea(field, value){
  if(!['city','region','country'].includes(field)) return;
  restaurantLocationRevision++;
  restaurantSearchArea[field] = field==='country' ? restaurantCountry(value) : cleanRestaurantLocationValue(value);
  restaurantSearchArea.region=restaurantSearchArea.country==='United States' ? restaurantState(restaurantSearchArea.region) : '';
  restaurantSearchArea.lat = null;
  restaurantSearchArea.lng = null;
  saveRestaurantSearchArea();
  syncRestaurantLocationInputs();
  setRestaurantLocationStatus('');
  refreshRestaurantSearch();
}

function refreshRestaurantSearch(){
  lgSearchRequest++;
  wishlistSearchRequest++;
  clearTimeout(lgSearchTimer);
  clearTimeout(wishlistSearchTimer);
  closeLgDropdown();
  if(wishlistMode==='restaurant') document.getElementById('wishlist-dropdown').classList.remove('open');
  const query=document.getElementById('lg-search-input').value.trim();
  if(query.length>=2 && document.getElementById('screen-lg-search').classList.contains('active')) lgSearchTimer=setTimeout(()=>lgDoSearch(query),400);
  const savedQuery=document.getElementById('wishlist-search-input').value.trim();
  if(savedQuery.length>=2 && wishlistMode==='restaurant' && document.getElementById('screen-wishlist').classList.contains('active')) wishlistSearchTimer=setTimeout(()=>searchWishlist(savedQuery),400);
}

function requestRestaurantLocation(){
  if(!navigator.geolocation){
    setRestaurantLocationStatus('Location is unavailable in this browser. Enter the area manually.', true);
    return;
  }
  setRestaurantLocationStatus('Getting your location...');
  const revision=++restaurantLocationRevision;
  const userKey=restaurantLocationUserKey();
  const isCurrent=()=>revision===restaurantLocationRevision && userKey===restaurantLocationUserKey();
  navigator.geolocation.getCurrentPosition(async function(position){
    if(!isCurrent()) return;
    const lat=Number(position.coords.latitude),lng=Number(position.coords.longitude);
    try{
      const data = await apiCall('reverseGeocode', {
        token:getSessionToken(), lat:lat, lng:lng
      });
      if(!isCurrent()) return;
      restaurantSearchArea.city = cleanRestaurantLocationValue(data.city);
      restaurantSearchArea.country = restaurantCountry(data.country);
      restaurantSearchArea.region = restaurantSearchArea.country==='United States' ? restaurantState(data.region) : '';
      restaurantSearchArea.lat=lat; restaurantSearchArea.lng=lng;
      saveRestaurantSearchArea();
      syncRestaurantLocationInputs();
      setRestaurantLocationStatus(restaurantAreaLabel() || 'Location shared.');
      refreshRestaurantSearch();
    }catch(e){
      if(isCurrent()) setRestaurantLocationStatus('Could not identify your city. Enter the area manually.', true);
    }
  }, function(){
    if(!isCurrent()) return;
    setRestaurantLocationStatus('Location was not shared. Enter the area manually.', true);
  }, { enableHighAccuracy:false, timeout:10000, maximumAge:300000 });
}

function restaurantSearchPayload(query){
  return {
    query:query,
    city:restaurantSearchArea.city,
    region:restaurantSearchArea.region,
    country:restaurantSearchArea.country,
    lat:restaurantSearchArea.lat,
    lng:restaurantSearchArea.lng
  };
}

function restaurantRecommendationLocationPayload(){
  return {
    city:restaurantSearchArea.city,
    region:restaurantSearchArea.region,
    country:restaurantSearchArea.country
  };
}

document.addEventListener('DOMContentLoaded', function(){
  document.querySelectorAll('[data-restaurant-location-controls]').forEach(function(host){
    host.innerHTML='<label>City <small>e.g. Chicago</small><input data-restaurant-location-field="city" type="text" placeholder="Any city" autocomplete="address-level2"></label>'+
      '<label>State <small>e.g. Illinois</small><select data-restaurant-location-field="region" autocomplete="address-level1"></select></label>'+
      '<label>Country <small>e.g. United States</small><input data-restaurant-location-field="country" type="text" list="restaurant-countries" autocomplete="country-name"></label>';
  });
  document.querySelectorAll('[data-restaurant-location-field]').forEach(function(input){
    input.addEventListener(input.dataset.restaurantLocationField==='city' ? 'input' : 'change', function(){
      updateRestaurantSearchArea(input.dataset.restaurantLocationField, input.value);
    });
  });
  const country=document.getElementById('manual-restaurant-country');
  country.addEventListener('change',function(){
    country.value=restaurantCountry(country.value);
    const state=document.getElementById('manual-restaurant-region');
    configureRestaurantState(state,country.value,state.value);
  });
  syncRestaurantLocationInputs();
});

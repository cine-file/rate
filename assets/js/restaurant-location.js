// ── RESTAURANT SEARCH AREA ────────────────────────────────────
// Search area is deliberately stored in the browser, per signed-in user.
// It is only sent to Apps Script when a Restaurant search or recommendation is requested.
const RESTAURANT_LOCATION_STORAGE_PREFIX = 'cine-file.restaurant-location.';
let restaurantSearchArea = { city:'', region:'', country:'', lat:null, lng:null };

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
      region:cleanRestaurantLocationValue(saved.region),
      country:cleanRestaurantLocationValue(saved.country),
      lat:Number.isFinite(Number(saved.lat)) ? Number(saved.lat) : null,
      lng:Number.isFinite(Number(saved.lng)) ? Number(saved.lng) : null
    };
  }catch(e){
    restaurantSearchArea = { city:'', region:'', country:'', lat:null, lng:null };
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
    if(field) input.value = restaurantSearchArea[field] || '';
  });
}

function prepareRestaurantLocation(){
  loadRestaurantSearchArea();
  syncRestaurantLocationInputs();
  setRestaurantLocationStatus('');
}

function updateRestaurantSearchArea(field, value){
  if(!['city','region','country'].includes(field)) return;
  restaurantSearchArea[field] = cleanRestaurantLocationValue(value);
  restaurantSearchArea.lat = null;
  restaurantSearchArea.lng = null;
  saveRestaurantSearchArea();
  syncRestaurantLocationInputs();
  setRestaurantLocationStatus('');
}

function requestRestaurantLocation(){
  if(!navigator.geolocation){
    setRestaurantLocationStatus('Location is unavailable in this browser. Enter the area manually.', true);
    return;
  }
  setRestaurantLocationStatus('Getting your location...');
  navigator.geolocation.getCurrentPosition(async function(position){
    restaurantSearchArea.lat = Number(position.coords.latitude);
    restaurantSearchArea.lng = Number(position.coords.longitude);
    saveRestaurantSearchArea();
    try{
      const data = await apiCall('reverseGeocode', {
        token:getSessionToken(), lat:restaurantSearchArea.lat, lng:restaurantSearchArea.lng
      });
      restaurantSearchArea.city = cleanRestaurantLocationValue(data.city);
      restaurantSearchArea.region = cleanRestaurantLocationValue(data.region);
      restaurantSearchArea.country = cleanRestaurantLocationValue(data.country);
      saveRestaurantSearchArea();
      syncRestaurantLocationInputs();
      setRestaurantLocationStatus(restaurantAreaLabel() || 'Location shared.');
    }catch(e){
      setRestaurantLocationStatus('Location shared. Add the city, state, or country if needed.', false);
    }
  }, function(){
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
  document.querySelectorAll('[data-restaurant-location-field]').forEach(function(input){
    input.addEventListener('input', function(){
      updateRestaurantSearchArea(input.dataset.restaurantLocationField, input.value);
    });
  });
});

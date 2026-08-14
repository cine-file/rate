// ─────────────────────────────────────────────────────────────
//  CINE-FILE — Google Apps Script
//  Version: 2026.08.14-restaurant-location-performance.16
//  Runtime: GitHub Pages frontend + Apps Script JSON backend
//
//  Version notes:
//  - active-tabs-only.1: remove old migration/debug sheet paths and use only active database/summary tabs.
//  - upsert-summary-columns.1: enforce database upserts and add RT/IMDb to film summaries.
//  - decimal-score-group-search.1: supports tenth-point scoring in the frontend and
//    includes RT/IMDb metadata in the authenticated group-summary API response.
//  - wishlist-theme-details.1: adds authenticated personal Future-Films and
//    Future-Restaurants lists, removed automatically when their owner rates an item.
//  - tv-season-ratings.1: adds TV season and optional overall-series ratings.
//  - stats-search-delete.1: raw-score summaries, advanced search, secure rating deletion, and distribution-ready data.
//  - stats-genre-bars.2: exposes film genres to the stats API for cross-user genre filtering.
//  - recommendation-diagnostics.4: strengthens recommendation candidates, uses source category scores/notes in Gemini, exposes safe AI diagnostics, and defers backup hydration for faster generation.
//  - gemini-3.6.5: migrates the optional AI jury to Gemini 3.6 Flash and removes deprecated sampling parameters.
//  - ai-first-recommendations.6: Gemini proposes titles first; TMDB only validates and enriches 10 eligible movies per batch, with 5 visible and 5 backups.
//  - cross-category-recommendations.8: adds matching Gemini-first recommendation rooms for TV and restaurants, validated by TMDB and Google Places.
//  - cross-category-learning.9: persists TV and restaurant recommendation sessions and feedback, feeds prior actions back into future Gemini prompts, and removes off-theme search glows.
//  - restaurant-location-performance.16: adds voluntary city/state/country restaurant filtering, location-aware restaurant recommendations, cached searches, and batched recommendation history writes.
//
//  Original by friend, restaurant functions added by Claude
// ─────────────────────────────────────────────────────────────

const BACKEND_VERSION = '2026.08.14-restaurant-location-performance.16';
const SESSION_TTL_SECONDS = 6 * 60 * 60;
const LOGIN_RATE_WINDOW_SECONDS = 15 * 60;
const LOGIN_RATE_MAX_ATTEMPTS = 8;

const FILMS_SHEET_NAME = 'Database-Films';
const RESTAURANTS_SHEET_NAME = 'Database-Restaurants';
const FILMS_SUMMARY_SHEET_NAME = 'Summary-Films';
const RESTAURANTS_SUMMARY_SHEET_NAME = 'Summary-Restaurants';
const FUTURE_FILMS_SHEET_NAME = 'Future-Films';
const FUTURE_RESTAURANTS_SHEET_NAME = 'Future-Restaurants';
const TV_SHEET_NAME = 'Database-TV';
const TV_SUMMARY_SHEET_NAME = 'Summary-TV';
const FUTURE_TV_SHEET_NAME = 'Future-TV';
const FILM_RECOMMENDATIONS_SHEET_NAME = 'Recommendations-Films';
const FILM_RECOMMENDATION_FEEDBACK_SHEET_NAME = 'Recommendation-Feedback';
const TV_RECOMMENDATIONS_SHEET_NAME = 'Recommendations-TV';
const TV_RECOMMENDATION_FEEDBACK_SHEET_NAME = 'Recommendation-Feedback-TV';
const RESTAURANT_RECOMMENDATIONS_SHEET_NAME = 'Recommendations-Restaurants';
const RESTAURANT_RECOMMENDATION_FEEDBACK_SHEET_NAME = 'Recommendation-Feedback-Restaurants';
const RECENT_ACTIVITY_SHEET_NAME = 'Recent-Activity';
const RECENT_ACTIVITY_SNAPSHOT_PROPERTY = 'RECENT_ACTIVITY_SNAPSHOT_V14';

const FILM_SUMMARY_BASE_COLUMNS = ['Title','Year','Genre','Director','Movie length','RT Audience','IMDb'];
const FILM_SUMMARY_AVERAGE_COLUMN = 'Average Rating';
const FILM_SUMMARY_USER_ORDER = ['Michael','Megan','Stephen','Hannah','Chace','Natasha'];
const SUMMARY_DISPLAY_NAMES = {};

const FILMS_HEADER = [
  'user','date','title','year','director','rtAudience','imdb',
  'score10','raw100','grade',
  'plot','plotGrade','plotNotes',
  'entertainment','entGrade','entNotes',
  'acting','actingGrade','actingNotes',
  'visuals','visualsGrade','visualsNotes',
  'pacing','pacingGrade','pacingNotes',
  'emotional','emotionalGrade','emotionalNotes',
  'overallNotes','tmdbId','posterPath','genres','createdAt','updatedAt','runtimeMinutes'
];

const RESTAURANTS_HEADER = [
  'user','date','name','address','city','cuisine','price','googleRating',
  'score10','raw100','grade','stars',
  'food','foodGrade','value','valueGrade',
  'service','serviceGrade','atmosphere','atmosphereGrade',
  'craving','cravingGrade','overallNotes','placeId','createdAt','updatedAt'
];

const FUTURE_FILMS_HEADER = [
  'user','title','year','director','runtimeMinutes','rtAudience','imdb',
  'tmdbId','posterPath','genres','createdAt','updatedAt'
];

const FUTURE_RESTAURANTS_HEADER = [
  'user','name','address','city','cuisine','price','googleRating',
  'placeId','createdAt','updatedAt'
];

const TV_HEADER = [
  'user','date','entryType','seriesTitle','seriesYear','seasonNumber','seasonName',
  'episodeCount','creator','genres','imdb','tmdbTvId','posterPath',
  'score10','raw100','grade',
  'plot','plotGrade','plotNotes',
  'entertainment','entGrade','entNotes',
  'acting','actingGrade','actingNotes',
  'visuals','visualsGrade','visualsNotes',
  'pacing','pacingGrade','pacingNotes',
  'emotional','emotionalGrade','emotionalNotes',
  'overallNotes','createdAt','updatedAt'
];

const FUTURE_TV_HEADER = [
  'user','seriesTitle','seriesYear','creator','genres','imdb','tmdbTvId',
  'posterPath','createdAt','updatedAt'
];

const FILM_RECOMMENDATIONS_HEADER = [
  'recommendationId','user','sourceMode','sourceTmdbId','sourceTitle','pool','style',
  'recommendedTmdbId','recommendedTitle','rank','role','explanation','score',
  'posterPath','year','genres','runtimeMinutes','createdAt','status','groupMembers'
];

const FILM_RECOMMENDATION_FEEDBACK_HEADER = [
  'recommendationId','user','recommendedTmdbId','action','createdAt'
];

const GENERIC_RECOMMENDATIONS_HEADER = [
  'recommendationId','user','sourceMode','sourceId','sourceTitle','pool','style','category',
  'recommendedId','recommendedTitle','rank','role','explanation','yearOrCity','metadata','createdAt','status'
];

const GENERIC_RECOMMENDATION_FEEDBACK_HEADER = [
  'recommendationId','user','category','recommendedId','action','createdAt'
];

const RECENT_ACTIVITY_HEADER = [
  'activityKey','user','category','title','score10','displayDate','sortDate','updatedAt'
];


function getScriptProps() {
  return PropertiesService.getScriptProperties();
}

function getProp_(name) {
  return String(getScriptProps().getProperty(name) || '').trim();
}

function requireProp_(name) {
  var value = getProp_(name);
  if (!value) throw new Error('Missing Apps Script property: ' + name);
  return value;
}

function getSheetId() {
  return requireProp_('SHEET_ID');
}

function getTmdbKey() {
  return requireProp_('TMDB_API_KEY');
}

function getOmdbKey() {
  return getProp_('OMDB_API_KEY');
}

function getAdminPin() {
  return requireProp_('ADMIN_PIN');
}

function getPlacesKey() {
  return requireProp_('GOOGLE_PLACES_KEY');
}

function getGeminiKey_() {
  return getProp_('GEMINI_API_KEY');
}

// ── SESSION ───────────────────────────────────────────────────
function generateToken_() {
  return Utilities.getUuid();
}

function createSession_(username) {
  var token = generateToken_();
  var cache = CacheService.getScriptCache();
  cache.put('sess_' + token, JSON.stringify({ username: username }), SESSION_TTL_SECONDS);
  return token;
}

function validateSession_(token) {
  if (!token) return null;
  var cache = CacheService.getScriptCache();
  var data  = cache.get('sess_' + token);
  if (!data) return null;
  try { return JSON.parse(data); } catch(e) { return null; }
}

function createAdminSession_() {
  var token = generateToken_();
  var cache = CacheService.getScriptCache();
  cache.put('admin_' + token, 'true', SESSION_TTL_SECONDS);
  return token;
}

function validateAdminSession_(token) {
  if (!token) return false;
  var cache = CacheService.getScriptCache();
  return cache.get('admin_' + token) === 'true';
}

function withDocumentLock_(work) {
  var lock = LockService.getDocumentLock();
  lock.waitLock(30000);
  try {
    return work();
  } finally {
    lock.releaseLock();
  }
}

function loginAttemptKey_(scope, value) {
  var digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(scope || '') + '|' + String(value || '').trim().toLowerCase(),
    Utilities.Charset.UTF_8
  );
  return 'login_attempt_' + digest.map(function(b){ return ('0' + (b & 0xFF).toString(16)).slice(-2); }).join('');
}

function assertLoginAllowed_(scope, value) {
  var raw = CacheService.getScriptCache().get(loginAttemptKey_(scope, value));
  if (!raw) return;
  try {
    var state = JSON.parse(raw);
    if (Number(state.count || 0) >= LOGIN_RATE_MAX_ATTEMPTS) {
      throw new Error('Too many attempts. Try again in a few minutes.');
    }
  } catch (e) {
    if (e && e.message === 'Too many attempts. Try again in a few minutes.') throw e;
  }
}

function recordFailedLogin_(scope, value) {
  var cache = CacheService.getScriptCache();
  var key = loginAttemptKey_(scope, value);
  var state = { count: 0 };
  try { state = JSON.parse(cache.get(key) || '{"count":0}'); } catch (e) {}
  state.count = Number(state.count || 0) + 1;
  cache.put(key, JSON.stringify(state), LOGIN_RATE_WINDOW_SECONDS);
}

function clearFailedLogin_(scope, value) {
  CacheService.getScriptCache().remove(loginAttemptKey_(scope, value));
}

// ── PIN HASHING ───────────────────────────────────────────────
function hashPin_(pin, salt) {
  salt = salt || Utilities.getUuid().replace(/-/g,'').substring(0,16);
  return hashPinWithValue_(pin + salt, salt);
}

function hashPinWithValue_(value, salt) {
  var bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    value,
    Utilities.Charset.UTF_8
  );
  var hex = bytes.map(function(b){ return ('0'+(b&0xFF).toString(16)).slice(-2); }).join('');
  return { hash: hex, salt: salt };
}

function verifyPin_(pin, storedHash, storedSalt) {
  if (!storedHash || !storedSalt) return false;
  if (hashPin_(pin, storedSalt).hash === storedHash) return true;

  // Compatibility with the earlier secure backend, which used salt + ":" + pin.
  return hashPinWithValue_(storedSalt + ':' + pin, storedSalt).hash === storedHash;
}

// ── USERS ─────────────────────────────────────────────────────
function getUsersSheet_() {
  var ss  = SpreadsheetApp.openById(getSheetId());
  var tab = ss.getSheetByName('Users');
  if (!tab) {
    tab = ss.insertSheet('Users');
    tab.appendRow(['name','pinHash','pinSalt']);
  }
  return tab;
}

function getUsers_() {
  var tab  = getUsersSheet_();
  var rows = tab.getDataRange().getValues();
  var out  = [];
  for (var i = 1; i < rows.length; i++) {
    var name = String(rows[i][0] || '').trim();
    var pinHash = String(rows[i][1] || '').replace(/^'/, '').trim();
    var pinSalt = String(rows[i][2] || '').trim();
    if (name) {
      out.push({
        name: name,
        pinHash: pinHash,
        pinSalt: pinSalt,
        legacyPin: pinSalt ? '' : pinHash
      });
    }
  }
  return out;
}

function getUsersPublic_() {
  return getUsers_().map(function(u){ return { name: u.name }; });
}

// ── JSON OUTPUT ───────────────────────────────────────────────
function jsonOut_(data) {
  var output = ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
  return output;
}

function fetchJson_(url) {
  var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  var code = res.getResponseCode();
  var body = res.getContentText();
  if (code < 200 || code >= 300) {
    throw new Error('External API request failed (' + code + '): ' + body.slice(0, 180));
  }
  return JSON.parse(body);
}

// ── ROUTING ───────────────────────────────────────────────────
function doPost(e) {
  try {
    var d      = JSON.parse(e.postData.contents);
    var action = d.action || '';
    var token  = d.token  || '';

    // Public actions
    if (action === 'login')      return doLogin_(d);
    if (action === 'loginAdmin') return doLoginAdmin_(d);
    if (action === 'getUsers')   return jsonOut_({ users: getUsersPublic_() });
    if (action === 'getSession') return doGetSession_(d);
    if (action === 'verifyUserPin') return doVerifyUserPin_(d);

    // Admin actions
    if (action === 'saveUsers') {
      if (!validateAdminSession_(d.adminToken)) return jsonOut_({ error: 'Unauthorized' });
      return doSaveUsers_(d);
    }
    if (action === 'addUser') {
      if (!validateAdminSession_(d.adminToken)) return jsonOut_({ error: 'Unauthorized' });
      return doAddUser_(d);
    }
    if (action === 'deleteUser') {
      if (!validateAdminSession_(d.adminToken)) return jsonOut_({ error: 'Unauthorized' });
      return doDeleteUser_(d);
    }
    if (action === 'getDeploymentStatus') {
      if (!validateAdminSession_(d.adminToken)) return jsonOut_({ error: 'Unauthorized' });
      return doGetDeploymentStatus_(d);
    }

    // Session required
    var sess = validateSession_(token);
    if (!sess) return jsonOut_({ error: 'Invalid or expired session. Please log in again.' });
    var username = sess.username;

    if (action === 'getRecentActivity') return doGetRecentActivity_();

    if (action === 'searchMovies')           return doSearchMovies_(d);
    if (action === 'getMovieDetails')        return doGetMovieDetails_(d);
    if (action === 'saveRating')             return doSaveRating_(d.payload || d, username);
    if (action === 'getRatings')             return doGetRatings_(username);
    if (action === 'getSummary')             return doGetSummary_();
    if (action === 'getFutureFilms')         return doGetFutureFilms_(username);
    if (action === 'addFutureFilm')          return doAddFutureFilm_(d.payload || d, username);
    if (action === 'deleteFutureFilm')       return doDeleteFutureFilm_(d.payload || d, username);
    if (action === 'getRecommendationSources') return doGetRecommendationSources_(username);
    if (action === 'generateFilmRecommendations') return doGenerateFilmRecommendations_(d.payload || d, username);
    if (action === 'replaceFilmRecommendation') return doReplaceFilmRecommendation_(d.payload || d, username);
    if (action === 'recordRecommendationFeedback') return doRecordRecommendationFeedback_(d.payload || d, username);
    if (action === 'getTvRecommendationSources') return doGetTvRecommendationSources_(username);
    if (action === 'generateTvRecommendations') return doGenerateTvRecommendations_(d.payload || d, username);
    if (action === 'replaceTvRecommendation') return doReplaceGenericRecommendation_(d.payload || d, username, 'tv');
    if (action === 'getRestaurantRecommendationSources') return doGetRestaurantRecommendationSources_(username);
    if (action === 'generateRestaurantRecommendations') return doGenerateRestaurantRecommendations_(d.payload || d, username);
    if (action === 'replaceRestaurantRecommendation') return doReplaceGenericRecommendation_(d.payload || d, username, 'restaurant');
    if (action === 'recordTvRecommendationFeedback') return doRecordGenericRecommendationFeedback_(d.payload || d, username, 'tv');
    if (action === 'recordRestaurantRecommendationFeedback') return doRecordGenericRecommendationFeedback_(d.payload || d, username, 'restaurant');
    if (action === 'searchTv')                return doSearchTv_(d);
    if (action === 'getTvDetails')            return doGetTvDetails_(d);
    if (action === 'saveTvRating')            return doSaveTvRating_(d.payload || d, username);
    if (action === 'getTvRatings')            return doGetTvRatings_(username);
    if (action === 'getTvSummary')            return doGetTvSummary_();
    if (action === 'getFutureTv')             return doGetFutureTv_(username);
    if (action === 'addFutureTv')             return doAddFutureTv_(d.payload || d, username);
    if (action === 'deleteFutureTv')          return doDeleteFutureTv_(d.payload || d, username);
    if (action === 'searchRestaurants')      return doSearchRestaurants_(d);
    if (action === 'saveRestaurantRating')   return doSaveRestaurantRating_(d.payload || d, username);
    if (action === 'getRestaurantRatings')   return doGetRestaurantRatings_(username);
    if (action === 'getRestaurantSummary')   return doGetRestaurantSummary_();
    if (action === 'getFutureRestaurants')   return doGetFutureRestaurants_(username);
    if (action === 'addFutureRestaurant')    return doAddFutureRestaurant_(d.payload || d, username);
    if (action === 'deleteFutureRestaurant') return doDeleteFutureRestaurant_(d.payload || d, username);
    if (action === 'reverseGeocode')        return doReverseGeocode_(d);
    if (action === 'deleteRating')             return doDeleteRating_(d.payload || d, username);
    if (action === 'deleteTvRating')           return doDeleteTvRating_(d.payload || d, username);
    if (action === 'deleteRestaurantRating')   return doDeleteRestaurantRating_(d.payload || d, username);

    return jsonOut_({ error: 'Unknown action: ' + action });
  } catch(err) {
    return jsonOut_({ error: err.message });
  }
}

function doGet(e) {
  try {
    return jsonOut_({ service: 'cine-file-api', version: BACKEND_VERSION });
  } catch(err) {
    return jsonOut_({ error: err.message });
  }
}

// ── LOGIN ─────────────────────────────────────────────────────
function doLogin_(d) {
  var users = getUsers_();
  var username = String(d.username || d.name || '').trim();
  assertLoginAllowed_('user', username);
  var user  = users.filter(function(u){ return String(u.name).trim().toLowerCase() === username.toLowerCase(); })[0];
  if (!user) {
    recordFailedLogin_('user', username);
    return jsonOut_({ success: false, error: 'Incorrect name or PIN' });
  }
  var pin = String(d.pin || '').padStart(4, '0');
  var valid = user.legacyPin
    ? String(user.legacyPin).padStart(4, '0') === pin
    : verifyPin_(pin, user.pinHash, user.pinSalt);
  if (!valid) {
    recordFailedLogin_('user', username);
    return jsonOut_({ success: false, error: 'Incorrect PIN' });
  }
  clearFailedLogin_('user', username);
  if (user.legacyPin || !isCurrentPinHash_(pin, user.pinHash, user.pinSalt)) migrateUserPin_(username, pin);
  var token = createSession_(username);
  return jsonOut_({ success: true, token: token, username: username, user: { name: username } });
}

function isCurrentPinHash_(pin, storedHash, storedSalt) {
  if (!storedHash || !storedSalt) return false;
  return hashPin_(pin, storedSalt).hash === storedHash;
}

function migrateUserPin_(name, pin) {
  var tab = getUsersSheet_();
  var rows = tab.getDataRange().getValues();
  var hashed = hashPin_(pin);
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).toLowerCase() === String(name).toLowerCase()) {
      tab.getRange(i + 1, 2, 1, 2).setValues([[hashed.hash, hashed.salt]]);
      return;
    }
  }
}

function doLoginAdmin_(d) {
  assertLoginAllowed_('admin', 'admin');
  var pin = String(d.pin || '').padStart(4, '0');
  if (pin !== getAdminPin()) {
    recordFailedLogin_('admin', 'admin');
    return jsonOut_({ success: false, error: 'Incorrect admin PIN' });
  }
  clearFailedLogin_('admin', 'admin');
  var token = createAdminSession_();
  return jsonOut_({ success: true, adminToken: token });
}

function doGetSession_(d) {
  var sess = validateSession_(d.token || '');
  if (!sess) return jsonOut_({ error: 'Invalid or expired session. Please log in again.' });
  return jsonOut_({ user: { name: sess.username } });
}

function verifyUserPinValue_(username, pin) {
  var normalizedPin = String(pin || '').replace(/\D/g, '').padStart(4, '0').slice(-4);
  var user = getUsers_().filter(function(u){
    return String(u.name || '').trim().toLowerCase() === String(username || '').trim().toLowerCase();
  })[0];
  if (!user) return false;
  return user.legacyPin
    ? String(user.legacyPin).padStart(4, '0') === normalizedPin
    : verifyPin_(normalizedPin, user.pinHash, user.pinSalt);
}

function doVerifyUserPin_(d) {
  var sess = validateSession_(d.token || '');
  if (!sess) return jsonOut_({ ok: false, error: 'Invalid or expired session. Please log in again.' });
  if (!verifyUserPinValue_(sess.username, d.pin)) return jsonOut_({ ok: false, error: 'Incorrect PIN.' });
  return jsonOut_({ ok: true });
}

function doGetDeploymentStatus_(d) {
  var props = getScriptProps().getProperties();
  return jsonOut_({
    version: BACKEND_VERSION,
    hasSheetId: !!String(props.SHEET_ID || '').trim(),
    hasAdminPin: !!String(props.ADMIN_PIN || '').trim(),
    hasTmdbKey: !!String(props.TMDB_API_KEY || '').trim(),
    hasOmdbKey: !!String(props.OMDB_API_KEY || '').trim(),
    hasPlacesKey: !!String(props.GOOGLE_PLACES_KEY || '').trim()
  });
}

function doAddUser_(d) {
  var name = String(d.name || '').trim();
  var pin = String(d.pin || '').replace(/\D/g, '').padStart(4, '0').slice(-4);
  if (!name) return jsonOut_({ error: 'Name is required.' });
  if (!/^\d{4}$/.test(pin)) return jsonOut_({ error: 'PIN must be exactly 4 digits.' });
  if (pin === getAdminPin()) return jsonOut_({ error: 'That PIN is reserved. Choose another.' });
  if (/[\\\/\?\*\[\]:]/.test(name)) return jsonOut_({ error: 'Name contains invalid sheet characters.' });

  var users = getUsers_();
  if (users.some(function(u){ return String(u.name).toLowerCase() === name.toLowerCase(); })) {
    return jsonOut_({ error: 'A user with that name already exists.' });
  }
  var hashed = hashPin_(pin);
  getUsersSheet_().appendRow([name, hashed.hash, hashed.salt]);
  rebuildSummariesSafe_();
  return jsonOut_({ ok: true });
}

function doDeleteUser_(d) {
  var name = String(d.name || '').trim();
  if (!name) return jsonOut_({ error: 'Name is required.' });
  var tab = getUsersSheet_();
  var rows = tab.getDataRange().getValues();
  for (var i = rows.length - 1; i >= 1; i--) {
    if (String(rows[i][0]).toLowerCase() === name.toLowerCase()) {
      tab.deleteRow(i + 1);
    }
  }
  rebuildSummariesSafe_();
  return jsonOut_({ ok: true });
}

// ── SAVE USERS ────────────────────────────────────────────────
function doSaveUsers_(d) {
  var tab = getUsersSheet_();
  tab.clearContents();
  tab.appendRow(['name','pinHash','pinSalt']);
  (d.users || []).forEach(function(u) {
    var pin    = String(u.pin || '').padStart(4, '0');
    var hashed = hashPin_(pin);
    tab.appendRow([u.name, hashed.hash, hashed.salt]);
  });
  rebuildSummariesSafe_();
  return jsonOut_({ ok: true });
}

function rebuildSummariesSafe_() {
  try { rebuildFilmSummary_(); } catch(e) {}
  try { rebuildRestaurantSummary_(); } catch(e) {}
  try { rebuildTvSummary_(); } catch(e) {}
}

// ── SEARCH MOVIES ─────────────────────────────────────────────
function doSearchMovies_(d) {
  var query = String(d.query || '').trim();
  var advanced = !!d.advanced;
  var year = String(d.year || '').replace(/\D/g, '').slice(0, 4);
  var pageCount = advanced ? Math.max(1, Math.min(3, parseInt(d.pages, 10) || 3)) : 1;
  var seen = {};
  var merged = [];
  for (var page = 1; page <= pageCount; page++) {
    var url = 'https://api.themoviedb.org/3/search/movie?api_key=' + getTmdbKey() +
      '&query=' + encodeURIComponent(query) + '&include_adult=false&page=' + page +
      (year ? '&primary_release_year=' + encodeURIComponent(year) : '');
    var data = fetchJson_(url);
    (data.results || []).forEach(function(r) {
      if (!r.id || seen[r.id]) return;
      seen[r.id] = true;
      merged.push({
        id: r.id,
        title: r.title,
        original_title: r.original_title || '',
        year: (r.release_date || '').slice(0, 4),
        release_date: r.release_date || '',
        poster_path: r.poster_path || '',
        overview: r.overview || ''
      });
    });
    if (!advanced || page >= Number(data.total_pages || 1)) break;
  }
  return jsonOut_({ results: merged.slice(0, advanced ? 30 : 7) });
}

// ── GET MOVIE DETAILS ─────────────────────────────────────────
function doGetMovieDetails_(d) {
  var url  = 'https://api.themoviedb.org/3/movie/' + d.id +
             '?api_key=' + getTmdbKey() + '&append_to_response=credits';
  var data = fetchJson_(url);
  var director = '';
  if (data.credits && data.credits.crew) {
    var dir = data.credits.crew.filter(function(c){ return c.job === 'Director'; })[0];
    if (dir) director = dir.name;
  }
  var rt = null, imdb = null;
  try {
    if (!getOmdbKey()) throw new Error('OMDB key not configured.');
    var oUrl  = 'https://www.omdbapi.com/?apikey=' + getOmdbKey() +
                '&t=' + encodeURIComponent(data.title) +
                '&y=' + (data.release_date || '').slice(0, 4) + '&tomatoes=true';
    var oData = fetchJson_(oUrl);
    var rtEntry = (oData.Ratings || []).filter(function(r){ return r.Source === 'Rotten Tomatoes'; })[0];
    rt   = rtEntry ? rtEntry.Value : (oData.tomatoUserMeter ? oData.tomatoUserMeter + '%' : null);
    imdb = (oData.imdbRating && oData.imdbRating !== 'N/A') ? oData.imdbRating : null;
  } catch(e) {}
  return jsonOut_({
    id:          data.id,
    title:       data.title,
    year:        (data.release_date || '').slice(0, 4),
    director:    director,
    rt:          rt,
    imdb:        imdb,
    poster:      data.poster_path || '',
    poster_path: data.poster_path || '',
    genres:      (data.genres || []).map(function(g){ return g.name; }),
    runtime:     data.runtime || '',
    runtimeMinutes: data.runtime || ''
  });
}

// ── CATEGORY SHEET HELPERS ────────────────────────────────────
function getOrCreateSheet_(name, header) {
  var ss = SpreadsheetApp.openById(getSheetId());
  var tab = ss.getSheetByName(name);
  var created = false;
  if (!tab) {
    tab = ss.insertSheet(name);
    created = true;
  }
  ensureHeader_(tab, header);
  if (created) formatSheetAsTable_(tab);
  return tab;
}

function getExistingSheet_(preferredName) {
  var ss = SpreadsheetApp.openById(getSheetId());
  return ss.getSheetByName(preferredName);
}

function ensureHeader_(tab, header) {
  if (tab.getLastRow() === 0) {
    tab.getRange(1, 1, 1, header.length).setValues([header]);
    return;
  }
  var existing = tab.getRange(1, 1, 1, Math.max(tab.getLastColumn(), header.length)).getValues()[0];
  if (header[0] === 'user' && String(existing[0] || '').trim() !== 'user') {
    tab.getRange(1, 1, 1, header.length).setValues([header]);
    return;
  }
  header.forEach(function(h, i) {
    if (!existing[i]) tab.getRange(1, i + 1).setValue(h);
  });
}

function formatSheetAsTable_(tab, options) {
  if (!tab || tab.getLastRow() < 1 || tab.getLastColumn() < 1) return;
  options = options || {};
  tab.setFrozenRows(1);
  var range = tab.getRange(1, 1, Math.max(tab.getLastRow(), 1), tab.getLastColumn());
  try {
    var filter = tab.getFilter();
    if (!filter) range.createFilter();
  } catch(e) {}
  try {
    tab.getBandings().forEach(function(b){ b.remove(); });
    range.applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY);
  } catch(e) {}
  try {
    if (options.resize !== false) tab.autoResizeColumns(1, tab.getLastColumn());
  } catch(e) {}
}

function valuesToObjects_(values, expectedHeader) {
  if (!values || values.length < 2) return [];
  var keys = values[0].map(function(k){ return String(k || '').trim(); });
  if (expectedHeader && expectedHeader.length && keys[0] !== expectedHeader[0]) {
    keys = expectedHeader.slice();
  }
  var out = [];
  for (var i = 1; i < values.length; i++) {
    var empty = values[i].every(function(v){ return v === '' || v === null; });
    if (empty) continue;
    var obj = {};
    keys.forEach(function(k, j){ if (k) obj[k] = values[i][j]; });
    out.push(obj);
  }
  return out;
}

function sheetObjects_(tab, expectedHeader) {
  if (!tab || tab.getLastRow() < 2) return [];
  return valuesToObjects_(tab.getDataRange().getValues(), expectedHeader);
}

function rowForHeader_(header, obj) {
  return header.map(function(h){ return obj[h] === undefined ? '' : obj[h]; });
}

function objectAtSheetRow_(tab, rowNumber) {
  var header = tab.getRange(1, 1, 1, tab.getLastColumn()).getValues()[0]
    .map(function(k){ return String(k || '').trim(); });
  var values = tab.getRange(rowNumber, 1, 1, tab.getLastColumn()).getValues()[0];
  var obj = {};
  header.forEach(function(k, j){ if (k) obj[k] = values[j]; });
  return obj;
}

function findExistingRows_(tab, header, rowObj, keyFn) {
  var values = tab.getDataRange().getValues();
  if (values.length < 2) return [];
  var keys = values[0].map(function(k){ return String(k || '').trim(); });
  if (header && header.length && keys[0] !== header[0]) {
    keys = header.slice();
  }
  var target = keyFn(rowObj);
  var rows = [];
  for (var i = 1; i < values.length; i++) {
    var obj = {};
    keys.forEach(function(k, j){ if (k) obj[k] = values[i][j]; });
    if (keyFn(obj) === target) rows.push(i + 1);
  }
  return rows;
}

function normalizeKeyPart_(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s.-]/g, '');
}

function categoryKey_(user, primaryId, name, yearOrAddress) {
  var userKey = normalizeKeyPart_(user);
  var id = normalizeKeyPart_(primaryId);
  if (id) return userKey + '|id|' + id;
  return userKey + '|name|' + normalizeKeyPart_(name) + '|' + normalizeKeyPart_(yearOrAddress);
}

function filmGroupKey_(r) {
  var title = normalizeKeyPart_(r.title || r.Title);
  var year = normalizeKeyPart_(r.year || r.Year);
  if (title || year) return 'title|' + title + '|' + year;
  return 'tmdb|' + normalizeKeyPart_(r.tmdbId || r['TMDB ID']);
}

function restaurantGroupKey_(r) {
  var placeId = normalizeKeyPart_(r.placeId || r['Place ID']);
  if (placeId) return 'place|' + placeId;
  return 'name|' + normalizeKeyPart_(r.name || r.Name) + '|' + normalizeKeyPart_(r.address || r.Address);
}

function deleteExtraRows_(tab, rows) {
  rows.slice(1).sort(function(a, b){ return b - a; }).forEach(function(rowNumber) {
    tab.deleteRow(rowNumber);
  });
}

// ── WISHLIST HELPERS ──────────────────────────────────────────
function futureFilmPayloadToSheetRow_(d, username, existing) {
  var now = new Date().toISOString();
  existing = existing || {};
  var genres = d.genres || existing.genres || '';
  if (Array.isArray(genres)) genres = genres.join(' · ');
  return {
    user: username,
    title: d.title || existing.title || '',
    year: d.year || existing.year || '',
    director: d.director || existing.director || '',
    runtimeMinutes: d.runtimeMinutes || d.runtime || existing.runtimeMinutes || '',
    rtAudience: d.rt || d.rtAudience || existing.rtAudience || '',
    imdb: d.imdb || existing.imdb || '',
    tmdbId: d.tmdbId || d['TMDB ID'] || d.id || existing.tmdbId || '',
    posterPath: d.posterPath || d['Poster Path'] || d.poster || d.poster_path || existing.posterPath || '',
    genres: genres,
    createdAt: existing.createdAt || now,
    updatedAt: now
  };
}

function futureRestaurantPayloadToSheetRow_(d, username, existing) {
  var now = new Date().toISOString();
  existing = existing || {};
  return {
    user: username,
    name: d.name || existing.name || '',
    address: d.address || existing.address || '',
    city: d.city || existing.city || '',
    cuisine: d.cuisine || existing.cuisine || '',
    price: d.price || existing.price || '',
    googleRating: d.googleRating || d.rating || existing.googleRating || '',
    placeId: d.placeId || d['Place ID'] || d.place_id || d.id || existing.placeId || '',
    createdAt: existing.createdAt || now,
    updatedAt: now
  };
}

function categoryRowsForPayload_(tab, header, rowObj, idField, nameField, detailField) {
  var rows = findExistingRows_(tab, header, rowObj, function(r) {
    return categoryKey_(r.user, r[idField], r[nameField], r[detailField]);
  });
  if (!rows.length) {
    rows = findExistingRows_(tab, header, rowObj, function(r) {
      return categoryKey_(r.user, '', r[nameField], r[detailField]);
    });
  }
  return rows;
}

function userHasRatedFilm_(rowObj, username) {
  var tab = getExistingSheet_(FILMS_SHEET_NAME);
  if (!tab) return false;
  var candidate = {
    user: username,
    tmdbId: rowObj.tmdbId,
    title: rowObj.title,
    year: rowObj.year
  };
  return categoryRowsForPayload_(tab, FILMS_HEADER, candidate, 'tmdbId', 'title', 'year').length > 0;
}

function userHasRatedRestaurant_(rowObj, username) {
  var tab = getExistingSheet_(RESTAURANTS_SHEET_NAME);
  if (!tab) return false;
  var candidate = {
    user: username,
    placeId: rowObj.placeId,
    name: rowObj.name,
    address: rowObj.address
  };
  return categoryRowsForPayload_(tab, RESTAURANTS_HEADER, candidate, 'placeId', 'name', 'address').length > 0;
}

function removeFutureFilm_(rowObj, username) {
  var tab = getExistingSheet_(FUTURE_FILMS_SHEET_NAME);
  if (!tab) return;
  var candidate = {
    user: username,
    tmdbId: rowObj.tmdbId,
    title: rowObj.title,
    year: rowObj.year
  };
  categoryRowsForPayload_(tab, FUTURE_FILMS_HEADER, candidate, 'tmdbId', 'title', 'year')
    .sort(function(a, b){ return b - a; })
    .forEach(function(rowNumber){ tab.deleteRow(rowNumber); });
}

function removeFutureRestaurant_(rowObj, username) {
  var tab = getExistingSheet_(FUTURE_RESTAURANTS_SHEET_NAME);
  if (!tab) return;
  var candidate = {
    user: username,
    placeId: rowObj.placeId,
    name: rowObj.name,
    address: rowObj.address
  };
  categoryRowsForPayload_(tab, FUTURE_RESTAURANTS_HEADER, candidate, 'placeId', 'name', 'address')
    .sort(function(a, b){ return b - a; })
    .forEach(function(rowNumber){ tab.deleteRow(rowNumber); });
}

function futureFilmToApiRow_(r, groupStats) {
  var stats = groupStats[filmGroupKey_(r)] || { scores: [] };
  var scores = stats.scores || [];
  var avg = scores.length
    ? Number((scores.reduce(function(a, b){ return a + b; }, 0) / scores.length).toFixed(1))
    : '';
  return {
    'Title': r.title,
    'Year': r.year,
    'Director': r.director,
    'Movie length': r.runtimeMinutes,
    'RT Audience': r.rtAudience,
    'IMDb': r.imdb,
    'TMDB ID': r.tmdbId,
    'Poster Path': r.posterPath,
    'Genres': r.genres,
    'Group Average': avg,
    'Group Rating Count': scores.length
  };
}

function futureRestaurantToApiRow_(r, groupStats) {
  var stats = groupStats[restaurantGroupKey_(r)] || { scores: [] };
  var scores = stats.scores || [];
  var avg = scores.length
    ? Number((scores.reduce(function(a, b){ return a + b; }, 0) / scores.length).toFixed(1))
    : '';
  return {
    'Name': r.name,
    'Address': r.address,
    'City': r.city,
    'Cuisine': r.cuisine,
    'Price': r.price,
    'Google Rating': r.googleRating,
    'Place ID': r.placeId,
    'Group Average': avg,
    'Group Rating Count': scores.length
  };
}

function filmGroupStats_() {
  var tab = getExistingSheet_(FILMS_SHEET_NAME);
  var grouped = {};
  sheetObjects_(tab, FILMS_HEADER).forEach(function(r) {
    var key = filmGroupKey_(r);
    if (!grouped[key]) grouped[key] = { scores: [] };
    var score = parseFloat(r.score10);
    if (!isNaN(score)) grouped[key].scores.push(score);
  });
  return grouped;
}

function restaurantGroupStats_() {
  var tab = getExistingSheet_(RESTAURANTS_SHEET_NAME);
  var grouped = {};
  sheetObjects_(tab, RESTAURANTS_HEADER).forEach(function(r) {
    var key = restaurantGroupKey_(r);
    if (!grouped[key]) grouped[key] = { scores: [] };
    var score = parseFloat(r.score10);
    if (!isNaN(score)) grouped[key].scores.push(score);
  });
  return grouped;
}

function doAddFutureFilm_(d, username) {
  var tab = getOrCreateSheet_(FUTURE_FILMS_SHEET_NAME, FUTURE_FILMS_HEADER);
  var rowObj = futureFilmPayloadToSheetRow_(d, username, {});
  if (userHasRatedFilm_(rowObj, username)) {
    return jsonOut_({ ok: false, error: 'You have already rated this film.' });
  }
  var rows = categoryRowsForPayload_(tab, FUTURE_FILMS_HEADER, rowObj, 'tmdbId', 'title', 'year');
  if (rows.length) {
    var existing = objectAtSheetRow_(tab, rows[0]);
    rowObj = futureFilmPayloadToSheetRow_(d, username, existing);
    tab.getRange(rows[0], 1, 1, FUTURE_FILMS_HEADER.length).setValues([rowForHeader_(FUTURE_FILMS_HEADER, rowObj)]);
    deleteExtraRows_(tab, rows);
  } else {
    tab.appendRow(rowForHeader_(FUTURE_FILMS_HEADER, rowObj));
  }
  return jsonOut_({ ok: true });
}

function doDeleteFutureFilm_(d, username) {
  removeFutureFilm_(futureFilmPayloadToSheetRow_(d, username, {}), username);
  return jsonOut_({ ok: true });
}

function doGetFutureFilms_(username) {
  var tab = getExistingSheet_(FUTURE_FILMS_SHEET_NAME);
  var rows = sheetObjects_(tab, FUTURE_FILMS_HEADER).filter(function(r) {
    return String(r.user || '').toLowerCase() === String(username || '').toLowerCase();
  });
  var stats = filmGroupStats_();
  return jsonOut_(rows.map(function(r){ return futureFilmToApiRow_(r, stats); }));
}

function doAddFutureRestaurant_(d, username) {
  var tab = getOrCreateSheet_(FUTURE_RESTAURANTS_SHEET_NAME, FUTURE_RESTAURANTS_HEADER);
  var rowObj = futureRestaurantPayloadToSheetRow_(d, username, {});
  if (userHasRatedRestaurant_(rowObj, username)) {
    return jsonOut_({ ok: false, error: 'You have already rated this restaurant.' });
  }
  var rows = categoryRowsForPayload_(tab, FUTURE_RESTAURANTS_HEADER, rowObj, 'placeId', 'name', 'address');
  if (rows.length) {
    var existing = objectAtSheetRow_(tab, rows[0]);
    rowObj = futureRestaurantPayloadToSheetRow_(d, username, existing);
    tab.getRange(rows[0], 1, 1, FUTURE_RESTAURANTS_HEADER.length).setValues([rowForHeader_(FUTURE_RESTAURANTS_HEADER, rowObj)]);
    deleteExtraRows_(tab, rows);
  } else {
    tab.appendRow(rowForHeader_(FUTURE_RESTAURANTS_HEADER, rowObj));
  }
  return jsonOut_({ ok: true });
}

function doDeleteFutureRestaurant_(d, username) {
  removeFutureRestaurant_(futureRestaurantPayloadToSheetRow_(d, username, {}), username);
  return jsonOut_({ ok: true });
}

function doGetFutureRestaurants_(username) {
  var tab = getExistingSheet_(FUTURE_RESTAURANTS_SHEET_NAME);
  var rows = sheetObjects_(tab, FUTURE_RESTAURANTS_HEADER).filter(function(r) {
    return String(r.user || '').toLowerCase() === String(username || '').toLowerCase();
  });
  var stats = restaurantGroupStats_();
  return jsonOut_(rows.map(function(r){ return futureRestaurantToApiRow_(r, stats); }));
}

function filmToApiRow_(r) {
  return {
    'Date': r.date,
    'Title': r.title,
    'Year': r.year,
    'Director': r.director,
    'RT Audience': r.rtAudience,
    'IMDb': r.imdb,
    'Score /10': r.score10,
    'Raw /100': r.raw100,
    'Grade': r.grade,
    'Plot': r.plot,
    'Plot Grade': r.plotGrade,
    'Plot Notes': r.plotNotes,
    'Entertainment': r.entertainment,
    'Ent Grade': r.entGrade,
    'Ent Notes': r.entNotes,
    'Acting': r.acting,
    'Acting Grade': r.actingGrade,
    'Acting Notes': r.actingNotes,
    'Visuals': r.visuals,
    'Visuals Grade': r.visualsGrade,
    'Visuals Notes': r.visualsNotes,
    'Pacing': r.pacing,
    'Pacing Grade': r.pacingGrade,
    'Pacing Notes': r.pacingNotes,
    'Emotional': r.emotional,
    'Emotional Grade': r.emotionalGrade,
    'Emotional Notes': r.emotionalNotes,
    'Overall Notes': r.overallNotes,
    'TMDB ID': r.tmdbId,
    'Poster Path': r.posterPath,
    'Genres': r.genres,
    'Movie length': r.runtimeMinutes
  };
}

function filmPayloadToSheetRow_(d, username, existing) {
  var now = new Date().toISOString();
  existing = existing || {};
  return {
    user: username,
    date: d.date || existing.date || '',
    title: d.title || existing.title || '',
    year: d.year || existing.year || '',
    director: d.director || existing.director || '',
    rtAudience: d.rt || d.rtAudience || existing.rtAudience || '',
    imdb: d.imdb || existing.imdb || '',
    score10: d.score10 || existing.score10 || '',
    raw100: d.score100 || d.raw100 || existing.raw100 || '',
    grade: d.grade || existing.grade || '',
    plot: d.plot || '',
    plotGrade: d.plotGrade || '',
    plotNotes: d.plotNotes || '',
    entertainment: d.entertainment || '',
    entGrade: d.entGrade || '',
    entNotes: d.entNotes || '',
    acting: d.acting || '',
    actingGrade: d.actingGrade || '',
    actingNotes: d.actingNotes || '',
    visuals: d.visuals || '',
    visualsGrade: d.visualsGrade || '',
    visualsNotes: d.visualsNotes || '',
    pacing: d.pacing || '',
    pacingGrade: d.pacingGrade || '',
    pacingNotes: d.pacingNotes || '',
    emotional: d.emotional || '',
    emotionalGrade: d.emotionalGrade || '',
    emotionalNotes: d.emotionalNotes || '',
    overallNotes: d.notes || d.overallNotes || '',
    tmdbId: d.tmdbId || d.id || existing.tmdbId || '',
    posterPath: d.posterPath || existing.posterPath || '',
    genres: d.genres || existing.genres || '',
    runtimeMinutes: d.runtimeMinutes || d.runtime || existing.runtimeMinutes || '',
    createdAt: existing.createdAt || now,
    updatedAt: now
  };
}

// ── SAVE FILM RATING ──────────────────────────────────────────
function doSaveRating_(d, username) {
  return withDocumentLock_(function() {
    var tab = getOrCreateSheet_(FILMS_SHEET_NAME, FILMS_HEADER);
    var rowObj = filmPayloadToSheetRow_(d, username, {});
    var existingRows = findExistingRows_(tab, FILMS_HEADER, rowObj, function(r) {
      return categoryKey_(r.user, r.tmdbId, r.title, r.year);
    });
    if (!existingRows.length) {
      existingRows = findExistingRows_(tab, FILMS_HEADER, rowObj, function(r) {
        return categoryKey_(r.user, '', r.title, r.year);
      });
    }
    var existingRow = existingRows.length ? existingRows[0] : -1;
    if (existingRow > -1) {
      var existingObj = objectAtSheetRow_(tab, existingRow);
      rowObj = filmPayloadToSheetRow_(d, username, existingObj);
      tab.getRange(existingRow, 1, 1, FILMS_HEADER.length).setValues([rowForHeader_(FILMS_HEADER, rowObj)]);
      deleteExtraRows_(tab, existingRows);
    } else {
      tab.appendRow(rowForHeader_(FILMS_HEADER, rowObj));
    }
    removeFutureFilm_(rowObj, username);
    upsertRecentActivity_({activityKey:recentActivityKey_('film',username,rowObj.tmdbId,rowObj.title+'|'+rowObj.year),user:username,category:'film',title:rowObj.title||'',score10:Number(rowObj.score10||0),displayDate:activityDisplayDate_(rowObj),sortDate:activityDateValue_(rowObj),updatedAt:rowObj.updatedAt||''});
    rebuildFilmSummary_();
    return jsonOut_({ ok: true });
  });
}

// ── GET FILM RATINGS ──────────────────────────────────────────
function doGetRatings_(username) {
  var tab = getExistingSheet_(FILMS_SHEET_NAME);
  var rows = sheetObjects_(tab, FILMS_HEADER).filter(function(r) {
    return String(r.user || '').toLowerCase() === String(username || '').toLowerCase();
  });
  return jsonOut_(rows.map(filmToApiRow_));
}

// ── GET FILM SUMMARY ──────────────────────────────────────────
function doGetSummary_() {
  var tab = getExistingSheet_(FILMS_SHEET_NAME);
  var data = sheetObjects_(tab, FILMS_HEADER);
  if (!data.length) return jsonOut_({ rows: [] });

  var grouped = {};
  data.forEach(function(r) {
    var key = filmGroupKey_(r);
    if (!grouped[key]) {
      grouped[key] = {
        Title: r.title,
        Year: r.year,
        Genre: r.genres || '',
        rt: r.rtAudience || '',
        imdb: r.imdb || '',
        scores: [],
        rawScores: [],
        userScores: {},
        userRawScores: {}
      };
    }
    grouped[key].Genre = grouped[key].Genre || r.genres || '';
    grouped[key].rt = grouped[key].rt || r.rtAudience || '';
    grouped[key].imdb = grouped[key].imdb || r.imdb || '';
    var score = parseFloat(r.score10);
    if (!isNaN(score) && r.user) {
      grouped[key].scores.push(score);
      grouped[key].userScores[summaryDisplayName_(r.user)] = score;
      var rawScore = parseFloat(r.raw100);
      if (isNaN(rawScore)) rawScore = score * 10;
      grouped[key].rawScores.push(rawScore);
      grouped[key].userRawScores[summaryDisplayName_(r.user)] = rawScore;
    }
  });
  return jsonOut_({ rows: Object.keys(grouped).map(function(k){ return grouped[k]; }) });
}

function rebuildFilmSummary_() {
  var dataTab = getExistingSheet_(FILMS_SHEET_NAME);
  var data = sheetObjects_(dataTab, FILMS_HEADER);
  var userNames = getSummaryUserNames_(data);
  var header = FILM_SUMMARY_BASE_COLUMNS
    .concat(userNames.map(summaryDisplayName_))
    .concat([FILM_SUMMARY_AVERAGE_COLUMN]);
  var summaryTab = getOrCreateSummarySheet_(FILMS_SUMMARY_SHEET_NAME);

  var grouped = {};
  data.forEach(function(r) {
    var key = filmGroupKey_(r);
    if (!grouped[key]) {
      grouped[key] = {
        title: r.title,
        year: r.year,
        genre: r.genres || '',
        director: r.director || '',
        runtimeMinutes: r.runtimeMinutes || '',
        rtAudience: r.rtAudience || '',
        imdb: r.imdb || '',
        tmdbId: r.tmdbId || '',
        scoresByUser: {}
      };
    }
    grouped[key].genre = grouped[key].genre || r.genres || '';
    grouped[key].director = grouped[key].director || r.director || '';
    grouped[key].runtimeMinutes = grouped[key].runtimeMinutes || r.runtimeMinutes || '';
    grouped[key].rtAudience = grouped[key].rtAudience || r.rtAudience || '';
    grouped[key].imdb = grouped[key].imdb || r.imdb || '';
    var score = parseFloat(r.score10);
    if (!isNaN(score) && r.user) grouped[key].scoresByUser[String(r.user)] = score;
  });

  var rows = Object.keys(grouped).map(function(key) {
    var g = grouped[key];
    if (!g.genre || !g.runtimeMinutes) {
      var meta = g.tmdbId ? getMovieMetaByTmdbId_(g.tmdbId) : getMovieMetaByTitleYear_(g.title, g.year);
      g.genre = g.genre || meta.genres;
      g.runtimeMinutes = g.runtimeMinutes || meta.runtimeMinutes;
    }
    var scores = userNames.map(function(u) {
      var s = g.scoresByUser[u];
      return s === undefined || s === '' ? '' : Number(s);
    });
    var numericScores = scores.filter(function(s){ return s !== '' && !isNaN(parseFloat(s)); }).map(Number);
    var avg = numericScores.length
      ? Number((numericScores.reduce(function(a,b){ return a + b; }, 0) / numericScores.length).toFixed(1))
      : '';
    return [g.title, g.year, g.genre, g.director, formatRuntime_(g.runtimeMinutes), g.rtAudience, g.imdb]
      .concat(scores)
      .concat([avg]);
  }).sort(function(a, b) {
    return String(a[0] || '').localeCompare(String(b[0] || ''));
  });

  writeTable_(summaryTab, header, rows);
  return { sheet: FILMS_SUMMARY_SHEET_NAME, rows: rows.length, userColumns: userNames.map(summaryDisplayName_) };
}

function getSummaryUserNames_(data) {
  var known = {};
  getUsers_().forEach(function(u){
    if (String(u.name || '').toLowerCase() !== 'unknown') known[u.name] = true;
  });
  (data || []).forEach(function(r) {
    if (r.user && String(r.user).toLowerCase() !== 'unknown') known[String(r.user)] = true;
  });
  var names = Object.keys(known);
  var orderIndex = {};
  FILM_SUMMARY_USER_ORDER.forEach(function(name, i){ orderIndex[name.toLowerCase()] = i; });
  return names.sort(function(a, b) {
    var ai = orderIndex[String(a).toLowerCase()];
    var bi = orderIndex[String(b).toLowerCase()];
    if (ai === undefined) ai = 1000;
    if (bi === undefined) bi = 1000;
    if (ai !== bi) return ai - bi;
    return String(a).localeCompare(String(b));
  });
}

function summaryDisplayName_(name) {
  return SUMMARY_DISPLAY_NAMES[name] || name;
}

function formatRuntime_(minutes) {
  var n = parseInt(minutes, 10);
  if (!n || isNaN(n)) return '';
  var h = Math.floor(n / 60);
  var m = n % 60;
  return h ? h + 'h ' + m + 'm' : m + 'm';
}

function getMovieMetaByTmdbId_(tmdbId) {
  try {
    var cacheKey = 'movie_meta_id_' + tmdbId;
    var cached = CacheService.getScriptCache().get(cacheKey);
    if (cached) return JSON.parse(cached);
    var url = 'https://api.themoviedb.org/3/movie/' + encodeURIComponent(tmdbId) + '?api_key=' + getTmdbKey();
    var data = fetchJson_(url);
    var result = {
      genres: (data.genres || []).map(function(g){ return g.name; }).join(' · '),
      runtimeMinutes: data.runtime || ''
    };
    CacheService.getScriptCache().put(cacheKey, JSON.stringify(result), 21600);
    return result;
  } catch(e) {
    return { genres: '', runtimeMinutes: '' };
  }
}

function getMovieMetaByTitleYear_(title, year) {
  try {
    if (!title) return { genres: '', runtimeMinutes: '' };
    var cacheKey = 'movie_meta_title_' + String(title).toLowerCase() + '_' + String(year || '');
    var cached = CacheService.getScriptCache().get(cacheKey);
    if (cached) return JSON.parse(cached);
    var searchUrl = 'https://api.themoviedb.org/3/search/movie?api_key=' + getTmdbKey() +
      '&query=' + encodeURIComponent(title) +
      (year ? '&year=' + encodeURIComponent(year) : '') +
      '&include_adult=false';
    var searchData = fetchJson_(searchUrl);
    var first = (searchData.results || [])[0];
    if (!first || !first.id) return { genres: '', runtimeMinutes: '' };
    var result = getMovieMetaByTmdbId_(first.id);
    CacheService.getScriptCache().put(cacheKey, JSON.stringify(result), 21600);
    return result;
  } catch(e) {
    return { genres: '', runtimeMinutes: '' };
  }
}

function getOrCreateSummarySheet_(name) {
  var ss = SpreadsheetApp.openById(getSheetId());
  var tab = ss.getSheetByName(name);
  return tab || ss.insertSheet(name);
}

function writeTable_(tab, header, rows) {
  tab.clearContents();
  tab.clearFormats();
  var values = [header].concat(rows || []);
  tab.getRange(1, 1, values.length, header.length).setValues(values);
  // Keep summary filters/banding current without repeatedly auto-sizing every column.
  formatSheetAsTable_(tab, { resize:false });
}

// ══════════════════════════════════════════════════════════════
//  TV — SEASONS + OPTIONAL OVERALL SERIES RATINGS
// ══════════════════════════════════════════════════════════════
function tvGroupKey_(r) {
  var id = normalizeKeyPart_(r.tmdbTvId || r['TMDB TV ID']);
  var type = normalizeKeyPart_(r.entryType || r.Type || 'season');
  var season = type === 'overall' ? 'overall' : String(r.seasonNumber || r.Season || '');
  return (id ? 'tv|' + id : 'tvtitle|' + normalizeKeyPart_(r.seriesTitle || r.Series)) + '|' + type + '|' + season;
}

function tvSeriesKey_(r) {
  var id = normalizeKeyPart_(r.tmdbTvId || r['TMDB TV ID']);
  return id ? 'tv|' + id : 'tvtitle|' + normalizeKeyPart_(r.seriesTitle || r.Series);
}

function tvGroupStats_() {
  var grouped = {};
  sheetObjects_(getExistingSheet_(TV_SHEET_NAME), TV_HEADER).forEach(function(r) {
    var key = tvSeriesKey_(r);
    if (!grouped[key]) grouped[key] = { scores: [] };
    var score = parseFloat(r.score10);
    if (!isNaN(score)) grouped[key].scores.push(score);
  });
  return grouped;
}

function tvPayloadToSheetRow_(d, username, existing) {
  var now = new Date().toISOString();
  existing = existing || {};
  var genres = d.genres || existing.genres || '';
  if (Array.isArray(genres)) genres = genres.join(' · ');
  var entryType = String(d.entryType || existing.entryType || 'season').toLowerCase() === 'overall' ? 'overall' : 'season';
  return {
    user: username,
    date: d.date || existing.date || '',
    entryType: entryType,
    seriesTitle: d.seriesTitle || d.name || existing.seriesTitle || '',
    seriesYear: d.seriesYear || d.year || existing.seriesYear || '',
    seasonNumber: entryType === 'overall' ? '' : (d.seasonNumber || existing.seasonNumber || ''),
    seasonName: entryType === 'overall' ? 'Overall Series' : (d.seasonName || existing.seasonName || ''),
    episodeCount: entryType === 'overall' ? '' : (d.episodeCount || existing.episodeCount || ''),
    creator: d.creator || existing.creator || '',
    genres: genres,
    imdb: d.imdb || existing.imdb || '',
    tmdbTvId: d.tmdbTvId || d.id || existing.tmdbTvId || '',
    posterPath: d.posterPath || d.poster || d.poster_path || existing.posterPath || '',
    score10: d.score10 || existing.score10 || '',
    raw100: d.score100 || d.raw100 || existing.raw100 || '',
    grade: d.grade || existing.grade || '',
    plot: d.plot || '', plotGrade: d.plotGrade || '', plotNotes: d.plotNotes || '',
    entertainment: d.entertainment || '', entGrade: d.entGrade || '', entNotes: d.entNotes || '',
    acting: d.acting || '', actingGrade: d.actingGrade || '', actingNotes: d.actingNotes || '',
    visuals: d.visuals || '', visualsGrade: d.visualsGrade || '', visualsNotes: d.visualsNotes || '',
    pacing: d.pacing || '', pacingGrade: d.pacingGrade || '', pacingNotes: d.pacingNotes || '',
    emotional: d.emotional || '', emotionalGrade: d.emotionalGrade || '', emotionalNotes: d.emotionalNotes || '',
    overallNotes: d.notes || d.overallNotes || '',
    createdAt: existing.createdAt || now,
    updatedAt: now
  };
}

function tvToApiRow_(r) {
  return {
    'Date': r.date, 'Type': r.entryType, 'Series': r.seriesTitle, 'Year': r.seriesYear,
    'Season': r.seasonNumber, 'Season Name': r.seasonName, 'Episodes': r.episodeCount,
    'Creator': r.creator, 'Genres': r.genres, 'IMDb': r.imdb, 'TMDB TV ID': r.tmdbTvId,
    'Poster Path': r.posterPath, 'Score /10': r.score10, 'Raw /100': r.raw100, 'Grade': r.grade,
    'Plot': r.plot, 'Entertainment': r.entertainment, 'Acting': r.acting, 'Visuals': r.visuals,
    'Pacing': r.pacing, 'Emotional': r.emotional, 'Overall Notes': r.overallNotes
  };
}

function doSearchTv_(d) {
  var query = String(d.query || '').trim();
  var advanced = !!d.advanced;
  var year = String(d.year || '').replace(/\D/g, '').slice(0, 4);
  var pageCount = advanced ? Math.max(1, Math.min(3, parseInt(d.pages, 10) || 3)) : 1;
  var seen = {};
  var merged = [];
  for (var page = 1; page <= pageCount; page++) {
    var url = 'https://api.themoviedb.org/3/search/tv?api_key=' + getTmdbKey() +
      '&query=' + encodeURIComponent(query) + '&include_adult=false&page=' + page +
      (year ? '&first_air_date_year=' + encodeURIComponent(year) : '');
    var data = fetchJson_(url);
    (data.results || []).forEach(function(r) {
      if (!r.id || seen[r.id]) return;
      seen[r.id] = true;
      merged.push({
        id: r.id,
        name: r.name,
        original_name: r.original_name || '',
        year: (r.first_air_date || '').slice(0, 4),
        poster_path: r.poster_path || '',
        overview: r.overview || ''
      });
    });
    if (!advanced || page >= Number(data.total_pages || 1)) break;
  }
  return jsonOut_({ results: merged.slice(0, advanced ? 30 : 7) });
}

function doGetTvDetails_(d) {
  var url = 'https://api.themoviedb.org/3/tv/' + encodeURIComponent(d.id) +
    '?api_key=' + getTmdbKey() + '&append_to_response=external_ids';
  var data = fetchJson_(url);
  var imdb = '';
  var imdbId = data.external_ids && data.external_ids.imdb_id;
  if (imdbId && getOmdbKey()) {
    try {
      var omdb = fetchJson_('https://www.omdbapi.com/?apikey=' + getOmdbKey() + '&i=' + encodeURIComponent(imdbId));
      imdb = omdb.imdbRating && omdb.imdbRating !== 'N/A' ? omdb.imdbRating : '';
    } catch(e) {}
  }
  var creators = (data.created_by || []).map(function(p){ return p.name; }).join(', ');
  var seasons = (data.seasons || []).filter(function(s){ return Number(s.season_number) > 0; }).map(function(s) {
    return {
      seasonNumber:s.season_number, seasonName:s.name || ('Season ' + s.season_number),
      episodeCount:s.episode_count || '', year:(s.air_date || '').slice(0,4),
      poster:s.poster_path || data.poster_path || ''
    };
  });
  return jsonOut_({
    id:data.id, seriesTitle:data.name, seriesYear:(data.first_air_date || '').slice(0,4),
    creator:creators, genres:(data.genres || []).map(function(g){ return g.name; }),
    imdb:imdb, poster:data.poster_path || '', seasons:seasons
  });
}

function doSaveTvRating_(d, username) {
  return withDocumentLock_(function() {
    var tab = getOrCreateSheet_(TV_SHEET_NAME, TV_HEADER);
    var rowObj = tvPayloadToSheetRow_(d, username, {});
    var rows = findExistingRows_(tab, TV_HEADER, rowObj, function(r) {
      return String(r.user || '').toLowerCase() + '|' + tvGroupKey_(r);
    });
    if (rows.length) {
      var existing = objectAtSheetRow_(tab, rows[0]);
      rowObj = tvPayloadToSheetRow_(d, username, existing);
      tab.getRange(rows[0], 1, 1, TV_HEADER.length).setValues([rowForHeader_(TV_HEADER, rowObj)]);
      deleteExtraRows_(tab, rows);
    } else {
      tab.appendRow(rowForHeader_(TV_HEADER, rowObj));
    }
    removeFutureTv_(rowObj, username);
    var activityTitle=rowObj.seriesTitle||''; if(String(rowObj.entryType||'').toLowerCase()==='season'&&rowObj.seasonNumber) activityTitle+=' — Season '+rowObj.seasonNumber;
    upsertRecentActivity_({activityKey:recentActivityKey_('tv',username,(rowObj.tmdbTvId||'')+'|'+(rowObj.entryType||'')+'|'+(rowObj.seasonNumber||''),activityTitle),user:username,category:'tv',title:activityTitle,score10:Number(rowObj.score10||0),displayDate:activityDisplayDate_(rowObj),sortDate:activityDateValue_(rowObj),updatedAt:rowObj.updatedAt||''});
    rebuildTvSummary_();
    return jsonOut_({ ok:true });
  });
}

function doGetTvRatings_(username) {
  var tab = getExistingSheet_(TV_SHEET_NAME);
  var rows = sheetObjects_(tab, TV_HEADER).filter(function(r) {
    return String(r.user || '').toLowerCase() === String(username || '').toLowerCase();
  });
  return jsonOut_(rows.map(tvToApiRow_));
}

function doGetTvSummary_() {
  var tab = getExistingSheet_(TV_SHEET_NAME);
  var data = sheetObjects_(tab, TV_HEADER);
  var grouped = {};
  data.forEach(function(r) {
    var key = tvGroupKey_(r);
    if (!grouped[key]) grouped[key] = {
      'Series':r.seriesTitle, 'Year':r.seriesYear, 'Type':r.entryType, 'Season':r.seasonNumber,
      'Season Name':r.seasonName, 'Episodes':r.episodeCount, 'Creator':r.creator,
      'Genre':r.genres, 'IMDb':r.imdb,
      scores:[], rawScores:[], userScores:{}, userRawScores:{}
    };
    var score = parseFloat(r.score10);
    if (!isNaN(score) && r.user) {
      grouped[key].scores.push(score);
      grouped[key].userScores[summaryDisplayName_(r.user)] = score;
      var rawScore = parseFloat(r.raw100);
      if (isNaN(rawScore)) rawScore = score * 10;
      grouped[key].rawScores.push(rawScore);
      grouped[key].userRawScores[summaryDisplayName_(r.user)] = rawScore;
    }
  });
  return jsonOut_({ rows:Object.keys(grouped).map(function(key){ return grouped[key]; }) });
}

function rebuildTvSummary_() {
  var data = sheetObjects_(getExistingSheet_(TV_SHEET_NAME), TV_HEADER);
  var users = getSummaryUserNames_(data);
  var header = ['Series','Year','Type','Season','Season Name','Episodes','Creator','Genre','IMDb']
    .concat(users.map(summaryDisplayName_)).concat([FILM_SUMMARY_AVERAGE_COLUMN]);
  var grouped = {};
  data.forEach(function(r) {
    var key = tvGroupKey_(r);
    if (!grouped[key]) grouped[key] = r;
  });
  var rows = Object.keys(grouped).map(function(key) {
    var sample = grouped[key];
    var scoresByUser = {};
    data.filter(function(r){ return tvGroupKey_(r) === key; }).forEach(function(r){ scoresByUser[r.user] = r.score10; });
    var scores = users.map(function(user){ return scoresByUser[user] === undefined ? '' : Number(scoresByUser[user]); });
    var numeric = scores.filter(function(score){ return score !== '' && !isNaN(score); });
    var avg = numeric.length ? Number((numeric.reduce(function(a,b){ return a+b; },0) / numeric.length).toFixed(1)) : '';
    return [sample.seriesTitle,sample.seriesYear,sample.entryType,sample.seasonNumber,sample.seasonName,
      sample.episodeCount,sample.creator,sample.genres,sample.imdb].concat(scores).concat([avg]);
  }).sort(function(a,b){ return String(a[0]).localeCompare(String(b[0])); });
  writeTable_(getOrCreateSummarySheet_(TV_SUMMARY_SHEET_NAME), header, rows);
  return { sheet:TV_SUMMARY_SHEET_NAME, rows:rows.length };
}

function futureTvPayloadToSheetRow_(d, username, existing) {
  var now = new Date().toISOString();
  existing = existing || {};
  var genres = d.genres || existing.genres || '';
  if (Array.isArray(genres)) genres = genres.join(' · ');
  return {
    user:username, seriesTitle:d.seriesTitle || d.name || existing.seriesTitle || '',
    seriesYear:d.seriesYear || d.year || existing.seriesYear || '', creator:d.creator || existing.creator || '',
    genres:genres, imdb:d.imdb || existing.imdb || '', tmdbTvId:d.tmdbTvId || d.id || d['TMDB TV ID'] || existing.tmdbTvId || '',
    posterPath:d.posterPath || d.poster || d['Poster Path'] || existing.posterPath || '',
    createdAt:existing.createdAt || now, updatedAt:now
  };
}

function futureTvToApiRow_(r, groupStats) {
  var stats = groupStats[tvSeriesKey_(r)] || { scores: [] };
  var scores = stats.scores || [];
  var average = scores.length
    ? Number((scores.reduce(function(a,b){ return a + b; }, 0) / scores.length).toFixed(1))
    : '';
  return {
    'Series':r.seriesTitle,
    'Year':r.seriesYear,
    'Creator':r.creator,
    'Genres':r.genres,
    'IMDb':r.imdb,
    'TMDB TV ID':r.tmdbTvId,
    'Poster Path':r.posterPath,
    'Group Average':average,
    'Group Rating Count':scores.length
  };
}

function removeFutureTv_(rowObj, username) {
  var tab = getExistingSheet_(FUTURE_TV_SHEET_NAME);
  if (!tab) return;
  var target = String(username).toLowerCase() + '|' + normalizeKeyPart_(rowObj.tmdbTvId || rowObj.seriesTitle);
  var matchingRows = [];
  sheetObjects_(tab, FUTURE_TV_HEADER).forEach(function(r, index) {
    var key = String(r.user || '').toLowerCase() + '|' + normalizeKeyPart_(r.tmdbTvId || r.seriesTitle);
    if (key === target) matchingRows.push(index + 2);
  });
  matchingRows.sort(function(a, b){ return b - a; }).forEach(function(rowNumber) {
    tab.deleteRow(rowNumber);
  });
}

function doAddFutureTv_(d, username) {
  var tab = getOrCreateSheet_(FUTURE_TV_SHEET_NAME, FUTURE_TV_HEADER);
  var rowObj = futureTvPayloadToSheetRow_(d, username, {});
  var ratingTab = getExistingSheet_(TV_SHEET_NAME);
  var existingRows = ratingTab ? findExistingRows_(ratingTab, TV_HEADER,
    { user:username, tmdbTvId:rowObj.tmdbTvId, seriesTitle:rowObj.seriesTitle }, function(r) {
      return String(r.user || '').toLowerCase() + '|' + normalizeKeyPart_(r.tmdbTvId || r.seriesTitle);
    }) : [];
  if (existingRows.length) return jsonOut_({ ok:false, error:'You have already rated this TV series.' });
  var rows = findExistingRows_(tab, FUTURE_TV_HEADER, rowObj, function(r) {
    return String(r.user || '').toLowerCase() + '|' + normalizeKeyPart_(r.tmdbTvId || r.seriesTitle);
  });
  if (rows.length) {
    tab.getRange(rows[0], 1, 1, FUTURE_TV_HEADER.length).setValues([rowForHeader_(FUTURE_TV_HEADER, futureTvPayloadToSheetRow_(d, username, objectAtSheetRow_(tab, rows[0])))]);
    deleteExtraRows_(tab, rows);
  } else tab.appendRow(rowForHeader_(FUTURE_TV_HEADER, rowObj));
  return jsonOut_({ ok:true });
}

function doDeleteFutureTv_(d, username) {
  removeFutureTv_(futureTvPayloadToSheetRow_(d, username, {}), username);
  return jsonOut_({ ok:true });
}

function doGetFutureTv_(username) {
  var rows = sheetObjects_(getExistingSheet_(FUTURE_TV_SHEET_NAME), FUTURE_TV_HEADER).filter(function(r) {
    return String(r.user || '').toLowerCase() === String(username || '').toLowerCase();
  });
  var stats = tvGroupStats_();
  return jsonOut_(rows.map(function(r) { return futureTvToApiRow_(r, stats); }));
}

// ══════════════════════════════════════════════════════════════
//  LE GUIDE — RESTAURANT FUNCTIONS
// ══════════════════════════════════════════════════════════════

// ── SEARCH RESTAURANTS ────────────────────────────────────────
function restaurantSearchCacheKey_(value) {
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(value || ''));
  return 'restaurant_search_' + Utilities.base64EncodeWebSafe(digest).replace(/=+$/,'').slice(0, 40);
}

function restaurantSearchArea_(d) {
  return {
    city:String(d.city || '').trim().slice(0,80),
    region:String(d.region || '').trim().slice(0,80),
    country:String(d.country || '').trim().slice(0,80),
    lat:Number(d.lat),
    lng:Number(d.lng)
  };
}

function restaurantSearchQuery_(query, area) {
  return [String(query || '').trim(), 'restaurant', area.city, area.region, area.country]
    .filter(function(part){ return !!part; }).join(' ');
}

function doSearchRestaurants_(d) {
  var q = String(d.query || '').trim();
  if (!q) return jsonOut_({ results: [] });
  var area = restaurantSearchArea_(d);
  var key = getPlacesKey();
  var cache = CacheService.getScriptCache();
  var cacheKey = restaurantSearchCacheKey_(JSON.stringify({q:q,area:area}));
  var cached = cache.get(cacheKey);
  if (cached) return jsonOut_(JSON.parse(cached));

  var url = 'https://maps.googleapis.com/maps/api/place/textsearch/json?' +
            'query=' + encodeURIComponent(restaurantSearchQuery_(q, area)) +
            '&type=restaurant&key=' + encodeURIComponent(key);
  if (isFinite(area.lat) && isFinite(area.lng)) url += '&location=' + area.lat + ',' + area.lng + '&radius=50000';

  var data = fetchJson_(url);
  if (data.status && data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
    throw new Error('Google Places request failed: ' + data.status + (data.error_message ? ' - ' + data.error_message : ''));
  }

  var results = (data.results || []).slice(0, 8).map(function(r) {
    var parts   = (r.formatted_address || '').split(',');
    var city    = parts.length > 1 ? parts[parts.length - 2].trim() : '';
    var cuisine = (r.types || [])
      .filter(function(t){
        return t !== 'restaurant' && t !== 'food' &&
               t !== 'point_of_interest' && t !== 'establishment';
      })
      .map(function(t){ return t.replace(/_/g, ' '); })[0] || '';
    var price = '';
    if (r.price_level !== undefined) {
      price = ['', '$', '$$', '$$$', '$$$$'][r.price_level] || '';
    }
    return {
      placeId: r.place_id,
      name:    r.name,
      address: r.formatted_address || '',
      city:    city,
      cuisine: cuisine,
      price:   price,
      rating:  r.rating ? String(r.rating) : '',
      photo:   ''
    };
  });
  var response = { results: results };
  cache.put(cacheKey, JSON.stringify(response), 120);
  return jsonOut_(response);
}

function doReverseGeocode_(d) {
  var lat = Number(d.lat), lng = Number(d.lng);
  if (!isFinite(lat) || !isFinite(lng)) throw new Error('A valid location is required.');
  var url = 'https://maps.googleapis.com/maps/api/geocode/json?latlng=' + encodeURIComponent(lat + ',' + lng) + '&key=' + encodeURIComponent(getPlacesKey());
  var data = fetchJson_(url);
  if (data.status !== 'OK' || !data.results || !data.results.length) {
    throw new Error('Google could not identify that location.');
  }
  var components = data.results[0].address_components || [];
  function component(types, preferShort) {
    var found = components.filter(function(item){ return (item.types || []).some(function(type){ return types.indexOf(type) > -1; }); })[0];
    return found ? (preferShort ? found.short_name : found.long_name) : '';
  }
  return jsonOut_({
    city:component(['locality','postal_town','administrative_area_level_2'], false),
    region:component(['administrative_area_level_1'], false),
    country:component(['country'], false)
  });
}

function restaurantToApiRow_(r) {
  return {
    'Date': r.date,
    'Name': r.name,
    'Address': r.address,
    'City': r.city,
    'Cuisine': r.cuisine,
    'Price': r.price,
    'Google Rating': r.googleRating,
    'Score /10': r.score10,
    'Raw /100': r.raw100,
    'Grade': r.grade,
    'Stars': r.stars,
    'Food': r.food,
    'Food Grade': r.foodGrade,
    'Value': r.value,
    'Value Grade': r.valueGrade,
    'Service': r.service,
    'Service Grade': r.serviceGrade,
    'Atmosphere': r.atmosphere,
    'Atmosphere Grade': r.atmosphereGrade,
    'Craving': r.craving,
    'Craving Grade': r.cravingGrade,
    'Overall Notes': r.overallNotes,
    'Place ID': r.placeId
  };
}

function restaurantPayloadToSheetRow_(d, username, existing) {
  var now = new Date().toISOString();
  existing = existing || {};
  return {
    user: username,
    date: d.date || existing.date || '',
    name: d.name || existing.name || '',
    address: d.address || existing.address || '',
    city: d.city || existing.city || '',
    cuisine: d.cuisine || existing.cuisine || '',
    price: d.price || existing.price || '',
    googleRating: d.googleRating || existing.googleRating || '',
    score10: d.score10 || existing.score10 || '',
    raw100: d.score100 || d.raw100 || existing.raw100 || '',
    grade: d.grade || existing.grade || '',
    stars: d.stars || existing.stars || '',
    food: d.food || '',
    foodGrade: d.foodGrade || '',
    value: d.value || '',
    valueGrade: d.valueGrade || '',
    service: d.service || '',
    serviceGrade: d.serviceGrade || '',
    atmosphere: d.atmosphere || '',
    atmosphereGrade: d.atmosphereGrade || '',
    craving: d.craving || '',
    cravingGrade: d.cravingGrade || '',
    overallNotes: d.notes || d.overallNotes || '',
    placeId: d.placeId || d.place_id || d.id || existing.placeId || '',
    createdAt: existing.createdAt || now,
    updatedAt: now
  };
}

// ── SAVE RESTAURANT RATING ────────────────────────────────────
function doSaveRestaurantRating_(d, username) {
  return withDocumentLock_(function() {
    var tab = getOrCreateSheet_(RESTAURANTS_SHEET_NAME, RESTAURANTS_HEADER);
    var rowObj = restaurantPayloadToSheetRow_(d, username, {});
    var existingRows = findExistingRows_(tab, RESTAURANTS_HEADER, rowObj, function(r) {
      return categoryKey_(r.user, r.placeId, r.name, r.address);
    });
    if (!existingRows.length) {
      existingRows = findExistingRows_(tab, RESTAURANTS_HEADER, rowObj, function(r) {
        return categoryKey_(r.user, '', r.name, r.address);
      });
    }
    var existingRow = existingRows.length ? existingRows[0] : -1;
    if (existingRow > -1) {
      var existingObj = objectAtSheetRow_(tab, existingRow);
      rowObj = restaurantPayloadToSheetRow_(d, username, existingObj);
      tab.getRange(existingRow, 1, 1, RESTAURANTS_HEADER.length).setValues([rowForHeader_(RESTAURANTS_HEADER, rowObj)]);
      deleteExtraRows_(tab, existingRows);
    } else {
      tab.appendRow(rowForHeader_(RESTAURANTS_HEADER, rowObj));
    }
    removeFutureRestaurant_(rowObj, username);
    upsertRecentActivity_({activityKey:recentActivityKey_('restaurant',username,rowObj.placeId,rowObj.name+'|'+rowObj.address),user:username,category:'restaurant',title:rowObj.name||'',score10:Number(rowObj.score10||0),displayDate:activityDisplayDate_(rowObj),sortDate:activityDateValue_(rowObj),updatedAt:rowObj.updatedAt||''});
    rebuildRestaurantSummary_();
    return jsonOut_({ ok: true });
  });
}

// ── GET RESTAURANT RATINGS ────────────────────────────────────
function doGetRestaurantRatings_(username) {
  var tab = getExistingSheet_(RESTAURANTS_SHEET_NAME);
  var rows = sheetObjects_(tab, RESTAURANTS_HEADER).filter(function(r) {
    return String(r.user || '').toLowerCase() === String(username || '').toLowerCase();
  });
  return jsonOut_(rows.map(restaurantToApiRow_));
}

// ── GET RESTAURANT SUMMARY ────────────────────────────────────
function doGetRestaurantSummary_() {
  var tab = getExistingSheet_(RESTAURANTS_SHEET_NAME);
  var data = sheetObjects_(tab, RESTAURANTS_HEADER);
  if (!data.length) return jsonOut_({ rows: [] });

  var grouped = {};
  data.forEach(function(r) {
    var key = restaurantGroupKey_(r);
    if (!grouped[key]) {
      grouped[key] = { Name: r.name, Address: r.address, Cuisine: r.cuisine || '', Price: r.price || '', GoogleRating: r.googleRating || '', scores: [], rawScores: [], userScores: {}, userRawScores: {} };
    }
    var score = parseFloat(r.score10);
    if (!isNaN(score) && r.user) {
      grouped[key].scores.push(score);
      grouped[key].userScores[summaryDisplayName_(r.user)] = score;
      var rawScore = parseFloat(r.raw100);
      if (isNaN(rawScore)) rawScore = score * 10;
      grouped[key].rawScores.push(rawScore);
      grouped[key].userRawScores[summaryDisplayName_(r.user)] = rawScore;
    }
  });
  return jsonOut_({ rows: Object.keys(grouped).map(function(k){ return grouped[k]; }) });
}

function rebuildRestaurantSummary_() {
  var dataTab = getExistingSheet_(RESTAURANTS_SHEET_NAME);
  var data = sheetObjects_(dataTab, RESTAURANTS_HEADER);
  var userNames = getSummaryUserNames_(data);
  var header = ['Name','Address','Cuisine','Price','Google Rating']
    .concat(userNames.map(summaryDisplayName_))
    .concat([FILM_SUMMARY_AVERAGE_COLUMN]);
  var summaryTab = getOrCreateSummarySheet_(RESTAURANTS_SUMMARY_SHEET_NAME);

  var grouped = {};
  data.forEach(function(r) {
    var key = restaurantGroupKey_(r);
    if (!grouped[key]) {
      grouped[key] = {
        name: r.name,
        address: r.address,
        cuisine: r.cuisine,
        price: r.price,
        googleRating: r.googleRating,
        scoresByUser: {}
      };
    }
    var score = parseFloat(r.score10);
    if (!isNaN(score) && r.user) grouped[key].scoresByUser[String(r.user)] = score;
  });

  var rows = Object.keys(grouped).map(function(key) {
    var g = grouped[key];
    var scores = userNames.map(function(u) {
      var s = g.scoresByUser[u];
      return s === undefined || s === '' ? '' : Number(s);
    });
    var numericScores = scores.filter(function(s){ return s !== '' && !isNaN(parseFloat(s)); }).map(Number);
    var avg = numericScores.length
      ? Number((numericScores.reduce(function(a,b){ return a + b; }, 0) / numericScores.length).toFixed(1))
      : '';
    return [g.name, g.address, g.cuisine, g.price, g.googleRating].concat(scores).concat([avg]);
  }).sort(function(a, b) {
    return String(a[0] || '').localeCompare(String(b[0] || ''));
  });

  writeTable_(summaryTab, header, rows);
  return { sheet: RESTAURANTS_SUMMARY_SHEET_NAME, rows: rows.length, userColumns: userNames.map(summaryDisplayName_) };
}


// ── SECURE RATING DELETION ───────────────────────────────────
function requireDeletePin_(d, username) {
  var pin = String(d.pin || '').replace(/\D/g, '');
  if (!/^\d{4}$/.test(pin) || !verifyUserPinValue_(username, pin)) throw new Error('Incorrect PIN.');
}

function deleteMatchingRows_(tab, header, matcher) {
  if (!tab || tab.getLastRow() < 2) return 0;
  var rows = sheetObjects_(tab, header);
  var sheetRows = [];
  rows.forEach(function(row, index) { if (matcher(row)) sheetRows.push(index + 2); });
  sheetRows.sort(function(a, b){ return b - a; }).forEach(function(rowNumber){ tab.deleteRow(rowNumber); });
  return sheetRows.length;
}

function doDeleteRating_(d, username) {
  return withDocumentLock_(function() {
    requireDeletePin_(d, username);
    var target = { user: username, tmdbId: d.tmdbId, title: d.title, year: d.year };
    var key = categoryKey_(target.user, target.tmdbId, target.title, target.year);
    var fallback = categoryKey_(target.user, '', target.title, target.year);
    var deleted = deleteMatchingRows_(getExistingSheet_(FILMS_SHEET_NAME), FILMS_HEADER, function(row) {
      var rowKey = categoryKey_(row.user, row.tmdbId, row.title, row.year);
      var rowFallback = categoryKey_(row.user, '', row.title, row.year);
      return rowKey === key || rowFallback === fallback;
    });
    if (!deleted) return jsonOut_({ ok: false, error: 'Rating not found.' });
    removeRecentActivity_(recentActivityKey_('film', username, target.tmdbId, String(target.title || '') + '|' + String(target.year || '')));
    rebuildFilmSummary_();
    return jsonOut_({ ok: true, deleted: deleted });
  });
}

function doDeleteTvRating_(d, username) {
  return withDocumentLock_(function() {
    requireDeletePin_(d, username);
    var target = tvPayloadToSheetRow_(d, username, {});
    var targetKey = String(username || '').toLowerCase() + '|' + tvGroupKey_(target);
    var deleted = deleteMatchingRows_(getExistingSheet_(TV_SHEET_NAME), TV_HEADER, function(row) {
      return (String(row.user || '').toLowerCase() + '|' + tvGroupKey_(row)) === targetKey;
    });
    if (!deleted) return jsonOut_({ ok: false, error: 'Rating not found.' });
    var activityTitle = target.seriesTitle || '';
    if (String(target.entryType || '').toLowerCase() === 'season' && target.seasonNumber) activityTitle += ' — Season ' + target.seasonNumber;
    removeRecentActivity_(recentActivityKey_('tv', username, (target.tmdbTvId || '') + '|' + (target.entryType || '') + '|' + (target.seasonNumber || ''), activityTitle));
    rebuildTvSummary_();
    return jsonOut_({ ok: true, deleted: deleted });
  });
}

function doDeleteRestaurantRating_(d, username) {
  return withDocumentLock_(function() {
    requireDeletePin_(d, username);
    var target = { user: username, placeId: d.placeId, name: d.name, address: d.address };
    var key = categoryKey_(target.user, target.placeId, target.name, target.address);
    var fallback = categoryKey_(target.user, '', target.name, target.address);
    var deleted = deleteMatchingRows_(getExistingSheet_(RESTAURANTS_SHEET_NAME), RESTAURANTS_HEADER, function(row) {
      var rowKey = categoryKey_(row.user, row.placeId, row.name, row.address);
      var rowFallback = categoryKey_(row.user, '', row.name, row.address);
      return rowKey === key || rowFallback === fallback;
    });
    if (!deleted) return jsonOut_({ ok: false, error: 'Rating not found.' });
    removeRecentActivity_(recentActivityKey_('restaurant', username, target.placeId, String(target.name || '') + '|' + String(target.address || '')));
    rebuildRestaurantSummary_();
    return jsonOut_({ ok: true, deleted: deleted });
  });
}

function setupActiveSheetTabs() {
  var filmDb = getOrCreateSheet_(FILMS_SHEET_NAME, FILMS_HEADER);
  var restaurantDb = getOrCreateSheet_(RESTAURANTS_SHEET_NAME, RESTAURANTS_HEADER);
  var futureFilms = getOrCreateSheet_(FUTURE_FILMS_SHEET_NAME, FUTURE_FILMS_HEADER);
  var futureRestaurants = getOrCreateSheet_(FUTURE_RESTAURANTS_SHEET_NAME, FUTURE_RESTAURANTS_HEADER);
  var tvDb = getOrCreateSheet_(TV_SHEET_NAME, TV_HEADER);
  var futureTv = getOrCreateSheet_(FUTURE_TV_SHEET_NAME, FUTURE_TV_HEADER);
  var filmRecommendations = getOrCreateSheet_(FILM_RECOMMENDATIONS_SHEET_NAME, FILM_RECOMMENDATIONS_HEADER);
  var recommendationFeedback = getOrCreateSheet_(FILM_RECOMMENDATION_FEEDBACK_SHEET_NAME, FILM_RECOMMENDATION_FEEDBACK_HEADER);
  var tvRecommendations = getOrCreateSheet_(TV_RECOMMENDATIONS_SHEET_NAME, GENERIC_RECOMMENDATIONS_HEADER);
  var tvRecommendationFeedback = getOrCreateSheet_(TV_RECOMMENDATION_FEEDBACK_SHEET_NAME, GENERIC_RECOMMENDATION_FEEDBACK_HEADER);
  var restaurantRecommendations = getOrCreateSheet_(RESTAURANT_RECOMMENDATIONS_SHEET_NAME, GENERIC_RECOMMENDATIONS_HEADER);
  var restaurantRecommendationFeedback = getOrCreateSheet_(RESTAURANT_RECOMMENDATION_FEEDBACK_SHEET_NAME, GENERIC_RECOMMENDATION_FEEDBACK_HEADER);
  var recentActivity = getOrCreateSheet_(RECENT_ACTIVITY_SHEET_NAME, RECENT_ACTIVITY_HEADER);
  formatSheetAsTable_(filmDb);
  formatSheetAsTable_(restaurantDb);
  formatSheetAsTable_(futureFilms);
  formatSheetAsTable_(futureRestaurants);
  formatSheetAsTable_(tvDb);
  formatSheetAsTable_(futureTv);
  formatSheetAsTable_(filmRecommendations);
  formatSheetAsTable_(recommendationFeedback);
  formatSheetAsTable_(tvRecommendations);
  formatSheetAsTable_(tvRecommendationFeedback);
  formatSheetAsTable_(restaurantRecommendations);
  formatSheetAsTable_(restaurantRecommendationFeedback);
  formatSheetAsTable_(recentActivity);
  var filmSummary = rebuildFilmSummary_();
  var restaurantSummary = rebuildRestaurantSummary_();
  var tvSummary = rebuildTvSummary_();
  var recentActivityCount = rebuildRecentActivity_();
  var result = {
    version: BACKEND_VERSION,
    databaseFilms: FILMS_SHEET_NAME,
    summaryFilms: filmSummary,
    databaseRestaurants: RESTAURANTS_SHEET_NAME,
    summaryRestaurants: restaurantSummary,
    futureFilms: FUTURE_FILMS_SHEET_NAME,
    futureRestaurants: FUTURE_RESTAURANTS_SHEET_NAME,
    databaseTv: TV_SHEET_NAME,
    recentActivity: RECENT_ACTIVITY_SHEET_NAME,
    recentActivityCount: recentActivityCount,
    summaryTv: tvSummary,
    futureTv: FUTURE_TV_SHEET_NAME,
    filmRecommendations: FILM_RECOMMENDATIONS_SHEET_NAME,
    recommendationFeedback: FILM_RECOMMENDATION_FEEDBACK_SHEET_NAME,
    tvRecommendations: TV_RECOMMENDATIONS_SHEET_NAME,
    tvRecommendationFeedback: TV_RECOMMENDATION_FEEDBACK_SHEET_NAME,
    restaurantRecommendations: RESTAURANT_RECOMMENDATIONS_SHEET_NAME,
    restaurantRecommendationFeedback: RESTAURANT_RECOMMENDATION_FEEDBACK_SHEET_NAME,
    usersTabKept: true
  };
  console.log(JSON.stringify(result, null, 2));
  return result;
}

// ══════════════════════════════════════════════════════════════
//  FILM RECOMMENDATIONS — TMDB CANDIDATES + OPTIONAL AI JURY
// ══════════════════════════════════════════════════════════════
function doGetRecommendationSources_(username) {
  var rows = sheetObjects_(getExistingSheet_(FILMS_SHEET_NAME), FILMS_HEADER)
    .filter(function(r){ return String(r.user || '').toLowerCase() === String(username || '').toLowerCase(); })
    .map(function(r){
      return {
        tmdbId: r.tmdbId || '', title: r.title || '', year: r.year || '', score10: Number(r.score10 || 0),
        raw100: Number(r.raw100 || 0), grade: r.grade || '', genres: r.genres || '', posterPath: r.posterPath || '',
        director: r.director || '', runtimeMinutes: r.runtimeMinutes || '', ratingType: filmRatingType_(r)
      };
    })
    .sort(function(a,b){ return b.score10 - a.score10 || String(a.title).localeCompare(String(b.title)); });
  return jsonOut_({ rows: rows });
}

function filmRatingType_(r) {
  var categoryFields = ['plot','entertainment','acting','visuals','pacing','emotional'];
  return categoryFields.some(function(k){ return r[k] !== '' && r[k] !== null && r[k] !== undefined; }) ? 'full' : 'quick';
}

function splitGenres_(value) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  return String(value || '').split(/\s*[·,|]\s*/).map(function(v){ return v.trim(); }).filter(Boolean);
}


function activityDateValue_(r) {
  var raw=r.updatedAt||r.createdAt||r.date||'';
  var d=raw instanceof Date?raw:new Date(raw);
  return isNaN(d.getTime())?0:d.getTime();
}
function activityDisplayDate_(r) {
  var raw=r.date||r.updatedAt||r.createdAt||'';
  var d=raw instanceof Date?raw:new Date(raw);
  if(isNaN(d.getTime())) return String(raw||'');
  return Utilities.formatDate(d, Session.getScriptTimeZone()||'America/Chicago', 'MMM d, yyyy');
}
function recentActivityKey_(category, user, id, title) {
  return [String(category||'').toLowerCase(),String(user||'').toLowerCase(),String(id||title||'').toLowerCase()].join('|');
}
function recentActivitySnapshotRows_() {
  var tab=getExistingSheet_(RECENT_ACTIVITY_SHEET_NAME);
  if(!tab || tab.getLastRow()<2) return [];
  return sheetObjects_(tab,RECENT_ACTIVITY_HEADER).map(function(r){
    return {user:r.user||'',category:r.category||'',title:r.title||'',score10:Number(r.score10||0),sortDate:Number(r.sortDate||0),displayDate:r.displayDate||''};
  }).filter(function(r){ return r.user&&r.title&&!isNaN(r.score10); })
    .sort(function(a,b){ return b.sortDate-a.sortDate; }).slice(0,15);
}
function writeRecentActivitySnapshot_() {
  var rows=recentActivitySnapshotRows_();
  PropertiesService.getScriptProperties().setProperty(RECENT_ACTIVITY_SNAPSHOT_PROPERTY,JSON.stringify(rows));
  return rows.length;
}
function upsertRecentActivity_(row) {
  var tab=getOrCreateSheet_(RECENT_ACTIVITY_SHEET_NAME,RECENT_ACTIVITY_HEADER);
  var key=String(row.activityKey||'');
  if(!key) return;
  var rows=findExistingRows_(tab,RECENT_ACTIVITY_HEADER,row,function(r){ return String(r.activityKey||''); });
  if(rows.length){
    tab.getRange(rows[0],1,1,RECENT_ACTIVITY_HEADER.length).setValues([rowForHeader_(RECENT_ACTIVITY_HEADER,row)]);
    deleteExtraRows_(tab,rows);
  } else {
    tab.appendRow(rowForHeader_(RECENT_ACTIVITY_HEADER,row));
  }
  writeRecentActivitySnapshot_();
}
function removeRecentActivity_(activityKey) {
  var tab=getExistingSheet_(RECENT_ACTIVITY_SHEET_NAME);
  if(!tab) return;
  deleteMatchingRows_(tab,RECENT_ACTIVITY_HEADER,function(r){ return String(r.activityKey||'')===String(activityKey||''); });
  writeRecentActivitySnapshot_();
}
function rebuildRecentActivity_() {
  var tab=getOrCreateSheet_(RECENT_ACTIVITY_SHEET_NAME,RECENT_ACTIVITY_HEADER);
  if(tab.getLastRow()>1) tab.getRange(2,1,tab.getLastRow()-1,tab.getLastColumn()).clearContent();
  var rows=[];
  sheetObjects_(getExistingSheet_(FILMS_SHEET_NAME),FILMS_HEADER).forEach(function(r){ rows.push({activityKey:recentActivityKey_('film',r.user,r.tmdbId,r.title+'|'+r.year),user:r.user||'',category:'film',title:r.title||'',score10:Number(r.score10||0),displayDate:activityDisplayDate_(r),sortDate:activityDateValue_(r),updatedAt:r.updatedAt||r.createdAt||''}); });
  sheetObjects_(getExistingSheet_(TV_SHEET_NAME),TV_HEADER).forEach(function(r){ var title=r.seriesTitle||''; if(String(r.entryType||'').toLowerCase()==='season'&&r.seasonNumber) title+=' — Season '+r.seasonNumber; rows.push({activityKey:recentActivityKey_('tv',r.user,(r.tmdbTvId||'')+'|'+(r.entryType||'')+'|'+(r.seasonNumber||''),title),user:r.user||'',category:'tv',title:title,score10:Number(r.score10||0),displayDate:activityDisplayDate_(r),sortDate:activityDateValue_(r),updatedAt:r.updatedAt||r.createdAt||''}); });
  sheetObjects_(getExistingSheet_(RESTAURANTS_SHEET_NAME),RESTAURANTS_HEADER).forEach(function(r){ rows.push({activityKey:recentActivityKey_('restaurant',r.user,r.placeId,r.name+'|'+r.address),user:r.user||'',category:'restaurant',title:r.name||'',score10:Number(r.score10||0),displayDate:activityDisplayDate_(r),sortDate:activityDateValue_(r),updatedAt:r.updatedAt||r.createdAt||''}); });
  rows=rows.filter(function(r){ return r.user&&r.title&&!isNaN(r.score10); });
  if(rows.length) tab.getRange(2,1,rows.length,RECENT_ACTIVITY_HEADER.length).setValues(rows.map(function(r){ return rowForHeader_(RECENT_ACTIVITY_HEADER,r); }));
  formatSheetAsTable_(tab);
  writeRecentActivitySnapshot_();
  return rows.length;
}
function doGetRecentActivity_() {
  var raw=PropertiesService.getScriptProperties().getProperty(RECENT_ACTIVITY_SNAPSHOT_PROPERTY);
  var rows=[];
  if(raw){ try{ rows=JSON.parse(raw)||[]; }catch(e){ rows=[]; } }
  return jsonOut_({rows:rows,snapshot:true});
}

function normalizedScore100_(r) {
  var raw = parseFloat(r.raw100);
  if (!isNaN(raw) && raw >= 0) return raw;
  var ten = parseFloat(r.score10);
  return isNaN(ten) ? 0 : ten * 10;
}

function buildFilmTasteProfile_(username) {
  var rows = sheetObjects_(getExistingSheet_(FILMS_SHEET_NAME), FILMS_HEADER)
    .filter(function(r){ return String(r.user || '').toLowerCase() === String(username || '').toLowerCase(); });
  var genre = {}, director = {}, decade = {}, runtime = { short:[], medium:[], long:[] };
  var fullCount = 0, quickCount = 0;
  rows.forEach(function(r){
    var score = Number(r.score10 || 0);
    splitGenres_(r.genres).forEach(function(g){
      var k = String(g).toLowerCase(); if (!genre[k]) genre[k] = { name:g, scores:[] }; genre[k].scores.push(score);
    });
    if (r.director) { var d=String(r.director).toLowerCase(); if(!director[d]) director[d]={name:r.director,scores:[]}; director[d].scores.push(score); }
    var y=parseInt(r.year,10); if(y){ var dec=Math.floor(y/10)*10; if(!decade[dec]) decade[dec]=[]; decade[dec].push(score); }
    var mins=parseInt(r.runtimeMinutes,10); if(mins){ runtime[mins<100?'short':(mins<=140?'medium':'long')].push(score); }
    if (filmRatingType_(r)==='full') fullCount++; else quickCount++;
  });
  function summarize(map){ return Object.keys(map).map(function(k){ var x=map[k], arr=x.scores||x; return {name:x.name||k, count:arr.length, average:Number((arr.reduce(function(a,b){return a+b;},0)/arr.length).toFixed(2))}; }).sort(function(a,b){return b.average-a.average || b.count-a.count;}); }
  return {
    ratingCount: rows.length, fullCount: fullCount, quickCount: quickCount,
    topGenres: summarize(genre).slice(0,8), lowGenres: summarize(genre).slice().sort(function(a,b){return a.average-b.average || b.count-a.count;}).slice(0,5),
    topDirectors: summarize(director).filter(function(x){return x.count>=1;}).slice(0,6),
    topDecades: summarize(decade).slice(0,5), runtimePreferences: summarize(runtime).filter(function(x){return x.count;})
  };
}

function sourceFilmRatingContext_(username, tmdbId) {
  var rows = sheetObjects_(getExistingSheet_(FILMS_SHEET_NAME), FILMS_HEADER);
  var userKey = String(username || '').toLowerCase();
  var row = rows.filter(function(r){
    return String(r.user || '').toLowerCase() === userKey && String(r.tmdbId || '') === String(tmdbId || '');
  })[0];
  if (!row) return null;
  return {
    score10:Number(row.score10 || 0), raw100:normalizedScore100_(row), ratingType:filmRatingType_(row),
    plot:row.plot, entertainment:row.entertainment, acting:row.acting, visuals:row.visuals,
    pacing:row.pacing, emotional:row.emotional,
    plotNotes:row.plotNotes || '', entNotes:row.entNotes || '', actingNotes:row.actingNotes || '',
    visualsNotes:row.visualsNotes || '', pacingNotes:row.pacingNotes || '', emotionalNotes:row.emotionalNotes || '',
    overallNotes:row.overallNotes || '', director:row.director || '', genres:splitGenres_(row.genres), runtimeMinutes:row.runtimeMinutes || ''
  };
}

function tmdbMovieDetailsForRecommendation_(id) {
  var url = 'https://api.themoviedb.org/3/movie/' + encodeURIComponent(id) + '?api_key=' + getTmdbKey() + '&append_to_response=keywords,credits';
  return fetchJson_(url);
}

function ratedAndWishlistIds_(username) {
  var rated={}, wished={};
  sheetObjects_(getExistingSheet_(FILMS_SHEET_NAME), FILMS_HEADER).forEach(function(r){
    if(String(r.user||'').toLowerCase()===String(username).toLowerCase() && r.tmdbId) rated[String(r.tmdbId)]=r;
  });
  sheetObjects_(getExistingSheet_(FUTURE_FILMS_SHEET_NAME), FUTURE_FILMS_HEADER).forEach(function(r){
    if(String(r.user||'').toLowerCase()===String(username).toLowerCase() && r.tmdbId) wished[String(r.tmdbId)]=r;
  });
  return {rated:rated,wished:wished};
}

function recommendationRole_(index, style) {
  var normal=['Best Overall Match','Closest Match','Hidden Gem','Something Different','Wildcard'];
  var hidden=['Hidden Gem','Underseen Match','Critic Pick','Deep Cut','Wildcard'];
  var different=['Taste Expansion','Genre Stretch','Unexpected Match','Adjacent Pick','Wildcard'];
  return ((style==='hidden'?hidden:(style==='different'?different:normal))[index] || 'Recommendation');
}

function compactFilmHistoryForAi_(username) {
  return sheetObjects_(getExistingSheet_(FILMS_SHEET_NAME), FILMS_HEADER)
    .filter(function(r){return String(r.user||'').toLowerCase()===String(username||'').toLowerCase();})
    .sort(function(a,b){return Number(b.score10||0)-Number(a.score10||0);})
    .slice(0,80)
    .map(function(r){return {
      title:r.title||'', year:r.year||'', score10:Number(r.score10||0), ratingType:filmRatingType_(r),
      genres:splitGenres_(r.genres), director:r.director||'', runtimeMinutes:r.runtimeMinutes||'',
      categories:filmRatingType_(r)==='full'?{
        plot:r.plot, entertainment:r.entertainment, acting:r.acting, visuals:r.visuals, pacing:r.pacing, emotional:r.emotional
      }:null,
      notes:[r.plotNotes,r.entNotes,r.actingNotes,r.visualsNotes,r.pacingNotes,r.emotionalNotes,r.overallNotes].filter(Boolean).join(' | ').slice(0,700)
    };});
}


function normalizeGroupMembers_(requested, username) {
  var valid={};getUsers_().forEach(function(u){valid[String(u.name||'').toLowerCase()]=u.name;});
  var out=[],seen={};
  [username].concat(Array.isArray(requested)?requested:[]).forEach(function(name){var key=String(name||'').trim().toLowerCase();if(key&&valid[key]&&!seen[key]){seen[key]=true;out.push(valid[key]);}});
  return out;
}
function groupFilmStates_(members) {
  var rated={},wished={},memberKeys={};members.forEach(function(n){memberKeys[String(n).toLowerCase()]=true;});
  sheetObjects_(getExistingSheet_(FILMS_SHEET_NAME),FILMS_HEADER).forEach(function(r){if(memberKeys[String(r.user||'').toLowerCase()]&&r.tmdbId){var id=String(r.tmdbId);if(!rated[id])rated[id]={title:r.title||'',year:r.year||'',users:[],scores:[]};rated[id].users.push(r.user);rated[id].scores.push(Number(r.score10||0));}});
  Object.keys(rated).forEach(function(id){var x=rated[id],sum=x.scores.reduce(function(a,b){return a+b;},0);x.score10=x.scores.length?sum/x.scores.length:0;});
  sheetObjects_(getExistingSheet_(FUTURE_FILMS_SHEET_NAME),FUTURE_FILMS_HEADER).forEach(function(r){if(memberKeys[String(r.user||'').toLowerCase()]&&r.tmdbId){var id=String(r.tmdbId);if(!wished[id])wished[id]={title:r.title||'',year:r.year||'',users:[]};wished[id].users.push(r.user);}});
  return {rated:rated,wished:wished};
}
function groupFilmContext_(members) {
  var total=0,people=members.map(function(name){var profile=buildFilmTasteProfile_(name),history=compactFilmHistoryForAi_(name).slice(0,35);total+=profile.ratingCount;return {name:name,profile:profile,representativeRatings:history};});
  return {members:people,ratingCount:total,memberCount:members.length};
}
function callGeminiGroupMovieGenerator_(groupContext,payload,states) {
  var key=getGeminiKey_(),diagnostic={attempted:false,success:false,error:key?'':'GEMINI_API_KEY is not configured.',httpStatus:'',model:'gemini-3.6-flash'};
  if(!key)return {suggestions:null,diagnostic:diagnostic};diagnostic.attempted=true;
  var pool=payload.pool||'new',excluded=[];
  Object.keys(states.rated).forEach(function(id){if(pool==='new'||pool==='notWishlist')excluded.push({tmdbId:id,title:states.rated[id].title,reason:'already rated by '+states.rated[id].users.join(', ')});});
  if(pool==='notWishlist')Object.keys(states.wished).forEach(function(id){excluded.push({tmdbId:id,title:states.wished[id].title,reason:'already wishlisted by '+states.wished[id].users.join(', ')});});
  (payload.excludeTmdbIds||[]).forEach(function(id){excluded.push({tmdbId:String(id),reason:'already shown in this session'});});
  var prompt={instruction:'You are a group movie matchmaker. Generate exactly 15 real feature films that create the strongest shared viewing experience for all selected people. Treat every person as important; do not simply follow the person with the most ratings. Identify overlapping tastes, avoid strong individual dislikes, and use thoughtful compromise when tastes differ. Respect every exclusion. Return strict JSON only with accurate title and release year for TMDB validation.',mode:'Group Matchmaker',style:payload.style||'balanced',pool:pool,group:groupContext.members,exclusions:excluded.slice(0,220),outputSchema:{recommendations:[{title:'exact movie title',year:'four-digit release year',role:'Best Shared Pick, Strong Match for Everyone, Slightly Adventurous, or Wildcard',explanation:'one or two specific sentences explaining why this works for the selected group and naming relevant members when useful'}]}};
  try{var url='https://generativelanguage.googleapis.com/v1beta/models/'+diagnostic.model+':generateContent?key='+encodeURIComponent(key),res=UrlFetchApp.fetch(url,{method:'post',contentType:'application/json',muteHttpExceptions:true,payload:JSON.stringify({contents:[{parts:[{text:JSON.stringify(prompt)}]}],generationConfig:{responseMimeType:'application/json'}})});diagnostic.httpStatus=res.getResponseCode();if(res.getResponseCode()<200||res.getResponseCode()>=300){diagnostic.error='Gemini returned HTTP '+res.getResponseCode()+': '+String(res.getContentText()||'').slice(0,220);return {suggestions:null,diagnostic:diagnostic};}var data=JSON.parse(res.getContentText()),text=data.candidates&&data.candidates[0]&&data.candidates[0].content&&data.candidates[0].content.parts&&data.candidates[0].content.parts[0].text;if(!text){diagnostic.error='Gemini returned no recommendation JSON.';return {suggestions:null,diagnostic:diagnostic};}var parsed=JSON.parse(text),suggestions=parsed&&parsed.recommendations;if(!Array.isArray(suggestions))throw new Error('Gemini response did not match the required schema.');suggestions=suggestions.filter(function(x){return x&&x.title;}).slice(0,15);diagnostic.success=!!suggestions.length;diagnostic.error=diagnostic.success?'':'Gemini returned no usable movie titles.';return {suggestions:diagnostic.success?suggestions:null,diagnostic:diagnostic};}catch(e){diagnostic.error='Gemini request failed: '+e.message;return {suggestions:null,diagnostic:diagnostic};}
}

function callGeminiMovieGenerator_(source, sourceRating, profile, payload, username, states) {
  var key=getGeminiKey_();
  var diagnostic={attempted:false,success:false,error:key?'':'GEMINI_API_KEY is not configured.',httpStatus:'',model:'gemini-3.6-flash'};
  if(!key) return {suggestions:null,diagnostic:diagnostic};
  diagnostic.attempted=true;
  var pool=payload.pool||'new';
  var excludedIds={};
  (payload.excludeTmdbIds||[]).forEach(function(id){excludedIds[String(id)]=true;});
  var excluded=[];
  Object.keys(states.rated).forEach(function(id){
    if(pool==='new'||pool==='notWishlist') excluded.push({tmdbId:id,title:states.rated[id].title||'',year:states.rated[id].year||'',reason:'already rated'});
  });
  if(pool==='notWishlist') Object.keys(states.wished).forEach(function(id){excluded.push({tmdbId:id,title:states.wished[id].title||'',year:states.wished[id].year||'',reason:'already wishlisted'});});
  Object.keys(excludedIds).forEach(function(id){excluded.push({tmdbId:id,reason:'already shown in this session'});});
  var prompt={
    instruction:'You are the primary movie recommendation engine. Generate exactly 15 real feature films. Do not merely list broad genre matches. Recommend based on viewing experience, themes, tone, structure, atmosphere, pacing, emotional payoff, scale, and the user\'s actual rating behavior. Respect every exclusion. Provide title and release year accurately enough for TMDB validation. Return strict JSON only. Do not include television series, shorts, documentaries unless clearly appropriate, unreleased rumors, or invented films.',
    mode:payload.sourceMode==='taste'?'Based on the user\'s overall taste':'Based on a source movie plus the user\'s taste',
    style:payload.style||'balanced', pool:pool,
    source:source?{title:source.title,year:String(source.release_date||'').slice(0,4),overview:source.overview||'',genres:(source.genres||[]).map(function(g){return g.name;}),keywords:(source.keywords&&(source.keywords.keywords||source.keywords.results)||[]).slice(0,15).map(function(k){return k.name;}),director:((source.credits&&source.credits.crew||[]).filter(function(c){return c.job==='Director';})[0]||{}).name||'',runtime:source.runtime||''}:null,
    sourceUserRating:sourceRating,
    tasteProfile:profile,
    representativeRatingHistory:compactFilmHistoryForAi_(username),
    exclusions:excluded.slice(0,180),
    outputSchema:{recommendations:[{title:'exact movie title',year:'four-digit release year',role:'short recommendation label',explanation:'one or two specific sentences tied to the source rating or taste profile'}]}
  };
  try{
    var url='https://generativelanguage.googleapis.com/v1beta/models/'+diagnostic.model+':generateContent?key='+encodeURIComponent(key);
    var res=UrlFetchApp.fetch(url,{method:'post',contentType:'application/json',muteHttpExceptions:true,payload:JSON.stringify({contents:[{parts:[{text:JSON.stringify(prompt)}]}],generationConfig:{responseMimeType:'application/json'}})});
    diagnostic.httpStatus=res.getResponseCode();
    if(res.getResponseCode()<200||res.getResponseCode()>=300){diagnostic.error='Gemini returned HTTP '+res.getResponseCode()+': '+String(res.getContentText()||'').slice(0,220);return {suggestions:null,diagnostic:diagnostic};}
    var data=JSON.parse(res.getContentText());
    var text=data.candidates&&data.candidates[0]&&data.candidates[0].content&&data.candidates[0].content.parts&&data.candidates[0].content.parts[0].text;
    if(!text){diagnostic.error='Gemini returned no recommendation JSON.';return {suggestions:null,diagnostic:diagnostic};}
    var parsed=JSON.parse(text), suggestions=parsed&&parsed.recommendations;
    if(!Array.isArray(suggestions)){diagnostic.error='Gemini response did not match the required schema.';return {suggestions:null,diagnostic:diagnostic};}
    suggestions=suggestions.filter(function(x){return x&&x.title;}).slice(0,15);
    if(!suggestions.length){diagnostic.error='Gemini returned no usable movie titles.';return {suggestions:null,diagnostic:diagnostic};}
    diagnostic.success=true;diagnostic.error='';
    return {suggestions:suggestions,diagnostic:diagnostic};
  }catch(e){diagnostic.error='Gemini request failed: '+e.message;return {suggestions:null,diagnostic:diagnostic};}
}

function normalizeMovieTitle_(value) {
  return String(value||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
}

function chooseTmdbSearchMatch_(suggestion, results) {
  var wanted=normalizeMovieTitle_(suggestion.title), wantedYear=parseInt(suggestion.year,10)||0;
  var ranked=(results||[]).map(function(r){
    var title=normalizeMovieTitle_(r.title||r.original_title), year=parseInt(String(r.release_date||'').slice(0,4),10)||0, score=0;
    if(title===wanted) score+=100;
    else if(title.indexOf(wanted)>-1||wanted.indexOf(title)>-1) score+=55;
    if(wantedYear&&year===wantedYear) score+=35;
    else if(wantedYear&&year&&Math.abs(year-wantedYear)<=1) score+=15;
    score+=Math.min(12,Math.log(Math.max(1,Number(r.vote_count||0))));
    return {movie:r,score:score};
  }).sort(function(a,b){return b.score-a.score;});
  return ranked.length&&ranked[0].score>=55?ranked[0].movie:null;
}

function validateGeminiSuggestionsWithTmdb_(suggestions, payload, username, states) {
  var requests=suggestions.map(function(s){
    return {url:'https://api.themoviedb.org/3/search/movie?api_key='+encodeURIComponent(getTmdbKey())+'&query='+encodeURIComponent(s.title)+(s.year?'&year='+encodeURIComponent(s.year):'')+'&include_adult=false',muteHttpExceptions:true};
  });
  var responses=UrlFetchApp.fetchAll(requests), pool=payload.pool||'new', excluded={};
  (payload.excludeTmdbIds||[]).forEach(function(id){excluded[String(id)]=true;});
  var valid=[], seen={};
  responses.forEach(function(res,i){
    if(res.getResponseCode()<200||res.getResponseCode()>=300)return;
    var data;try{data=JSON.parse(res.getContentText());}catch(e){return;}
    var match=chooseTmdbSearchMatch_(suggestions[i],data.results||[]);if(!match)return;
    var id=String(match.id);if(seen[id]||excluded[id])return;
    if(pool==='new'&&states.rated[id])return;
    if(pool==='notWishlist'&&(states.rated[id]||states.wished[id]))return;
    seen[id]=true;
    match._aiRole=suggestions[i].role||'';match._aiExplanation=suggestions[i].explanation||'';
    match._rated=states.rated[id]||null;match._wishlisted=!!states.wished[id];
    valid.push(match);
  });
  return valid.slice(0,10);
}

function hydrateRecommendationMovies_(candidates) {
  var requests=candidates.map(function(c){return {url:'https://api.themoviedb.org/3/movie/'+encodeURIComponent(c.id)+'?api_key='+encodeURIComponent(getTmdbKey()),muteHttpExceptions:true};});
  var responses=UrlFetchApp.fetchAll(requests);
  return candidates.map(function(c,i){
    var details={};try{if(responses[i].getResponseCode()>=200&&responses[i].getResponseCode()<300)details=JSON.parse(responses[i].getContentText());}catch(e){}
    return {tmdbId:c.id,title:c.title||details.title||'',year:String(c.release_date||details.release_date||'').slice(0,4),posterPath:c.poster_path||details.poster_path||'',genres:(details.genres||[]).map(function(g){return g.name;}),runtimeMinutes:details.runtime||'',tmdbRating:Number(c.vote_average||details.vote_average||0).toFixed(1),overview:c.overview||details.overview||'',score:0,ratedScore:c._rated?Number(c._rated.score10||0):'',wishlisted:!!c._wishlisted,role:c._aiRole||'',explanation:c._aiExplanation||''};
  });
}

function deterministicFallbackCandidates_(source, payload, username, states) {
  var list=[];
  if(source){
    var data=fetchJson_('https://api.themoviedb.org/3/movie/'+encodeURIComponent(source.id)+'/recommendations?api_key='+encodeURIComponent(getTmdbKey()));
    list=(data.results||[]);
  }else{
    var data2=fetchJson_('https://api.themoviedb.org/3/discover/movie?api_key='+encodeURIComponent(getTmdbKey())+'&sort_by=vote_average.desc&vote_count.gte=1200&include_adult=false');
    list=(data2.results||[]);
  }
  var pool=payload.pool||'new', excluded={};(payload.excludeTmdbIds||[]).forEach(function(id){excluded[String(id)]=true;});
  return list.filter(function(c){var id=String(c.id);if(excluded[id])return false;if(pool==='new'&&states.rated[id])return false;if(pool==='notWishlist'&&(states.rated[id]||states.wished[id]))return false;c._rated=states.rated[id]||null;c._wishlisted=!!states.wished[id];return true;}).slice(0,10);
}

function persistRecommendations_(username, payload, source, recommendations, backups, recommendationId) {
  var tab=getOrCreateSheet_(FILM_RECOMMENDATIONS_SHEET_NAME,FILM_RECOMMENDATIONS_HEADER), now=new Date().toISOString();
  var rows=(recommendations||[]).map(function(r,i){ return rowForHeader_(FILM_RECOMMENDATIONS_HEADER,{
    recommendationId:recommendationId,user:username,sourceMode:payload.sourceMode||'movie',sourceTmdbId:source?source.id:'',sourceTitle:source?source.title:'',pool:payload.pool||'new',style:payload.style||'balanced',
    recommendedTmdbId:r.tmdbId,recommendedTitle:r.title,rank:i+1,role:r.role,explanation:r.explanation,score:r.score,posterPath:r.posterPath,year:r.year,genres:(r.genres||[]).join(' · '),runtimeMinutes:r.runtimeMinutes,createdAt:now,status:'shown',groupMembers:(payload.groupMembers||[]).join(' · ')
  }); });
  if (rows.length) tab.getRange(tab.getLastRow()+1, 1, rows.length, FILM_RECOMMENDATIONS_HEADER.length).setValues(rows);
  CacheService.getScriptCache().put('rec_backups_'+recommendationId,JSON.stringify(backups),21600);
}

function doGenerateFilmRecommendations_(payload, username) {
  payload=payload||{};
  var started=Date.now(),isGroup=payload.groupMode===true||payload.sourceMode==='group',mode=isGroup?'group':(payload.sourceMode==='taste'?'taste':'movie'),source=null,sourceRating=null,profile,states,ai,members=[];
  if(isGroup){
    members=normalizeGroupMembers_(payload.groupMembers,username);
    if(members.length<2)throw new Error('Add at least one other person to use Group Matchmaker.');
    payload.groupMembers=members;
    profile=groupFilmContext_(members);
    states=groupFilmStates_(members);
    ai=callGeminiGroupMovieGenerator_(profile,payload,states);
  }else{
    if(mode==='movie'){
      if(!payload.sourceTmdbId)throw new Error('Choose a source movie.');
      source=tmdbMovieDetailsForRecommendation_(payload.sourceTmdbId);
      sourceRating=sourceFilmRatingContext_(username,payload.sourceTmdbId);
    }
    profile=buildFilmTasteProfile_(username);states=ratedAndWishlistIds_(username);
    ai=callGeminiMovieGenerator_(source,sourceRating,profile,payload,username,states);
  }
  var candidates=ai.suggestions?validateGeminiSuggestionsWithTmdb_(ai.suggestions,payload,username,states):[];
  if(candidates.length<5){
    var fallback=deterministicFallbackCandidates_(source,payload,username,states),seen={};
    candidates.forEach(function(c){seen[String(c.id)]=true;});
    fallback.forEach(function(c){if(candidates.length<10&&!seen[String(c.id)]){seen[String(c.id)]=true;candidates.push(c);}});
  }
  if(candidates.length<5)throw new Error('Not enough eligible movies were found. Try a broader recommendation pool.');
  candidates=candidates.slice(0,10);
  var hydrated=hydrateRecommendationMovies_(candidates);
  hydrated.forEach(function(r,i){r.role=r.role||recommendationRole_(i,payload.style);r.explanation=r.explanation||(isGroup?'This is one of the strongest validated shared matches for the selected group.':'This is one of the strongest validated matches for your selected recommendation mode.');});
  var recs=hydrated.slice(0,5),backups=hydrated.slice(5,10),recommendationId=Utilities.getUuid();persistRecommendations_(username,payload,source,recs,backups,recommendationId);
  return jsonOut_({recommendationId:recommendationId,source:source?{tmdbId:source.id,title:source.title}:null,profileSummary:isGroup?{ratingCount:profile.ratingCount,memberCount:profile.memberCount,members:members}:{ratingCount:profile.ratingCount,fullCount:profile.fullCount,quickCount:profile.quickCount},aiEnhanced:!!ai.diagnostic.success,recommendations:recs,diagnostics:{engine:ai.diagnostic.success?(isGroup?'Gemini Group Matchmaker':'Gemini-generated recommendations'):'Deterministic fallback',candidateCount:candidates.length,aiCandidateCount:ai.suggestions?ai.suggestions.length:0,validatedCount:candidates.length,backupCount:backups.length,aiAttempted:ai.diagnostic.attempted,aiHttpStatus:ai.diagnostic.httpStatus,aiError:ai.diagnostic.error||'',model:ai.diagnostic.model,elapsedMs:Date.now()-started}});
}

function doReplaceFilmRecommendation_(payload, username) {
  var id=String(payload.recommendationId||''),currentId=String(payload.currentTmdbId||'');if(!id)throw new Error('Recommendation session is missing.');
  var cache=CacheService.getScriptCache(),raw=cache.get('rec_backups_'+id),backups=raw?JSON.parse(raw):[];
  if(!backups.length)return jsonOut_({exhausted:true});
  var next=backups.shift();cache.put('rec_backups_'+id,JSON.stringify(backups),21600);
  doRecordRecommendationFeedback_({recommendationId:id,recommendedTmdbId:currentId,action:'replaced'},username);
  next.role=next.role||'Replacement Pick';
  return jsonOut_({recommendation:next,remainingBackups:backups.length,exhausted:false});
}

function doRecordRecommendationFeedback_(payload, username) {
  var action=String(payload.action||'').trim(); if(!action) throw new Error('Feedback action is required.');
  var tab=getOrCreateSheet_(FILM_RECOMMENDATION_FEEDBACK_SHEET_NAME,FILM_RECOMMENDATION_FEEDBACK_HEADER);
  tab.appendRow(rowForHeader_(FILM_RECOMMENDATION_FEEDBACK_HEADER,{recommendationId:payload.recommendationId||'',user:username,recommendedTmdbId:payload.recommendedTmdbId||'',action:action,createdAt:new Date().toISOString()}));
  return jsonOut_({ok:true});
}



function genericRecommendationConfig_(kind) {
  if (kind === 'tv') return {
    category: 'tv', recommendationsSheet: TV_RECOMMENDATIONS_SHEET_NAME,
    feedbackSheet: TV_RECOMMENDATION_FEEDBACK_SHEET_NAME
  };
  return {
    category: 'restaurant', recommendationsSheet: RESTAURANT_RECOMMENDATIONS_SHEET_NAME,
    feedbackSheet: RESTAURANT_RECOMMENDATION_FEEDBACK_SHEET_NAME
  };
}

function persistGenericRecommendations_(kind, username, payload, source, items, recommendationId) {
  var cfg=genericRecommendationConfig_(kind), tab=getOrCreateSheet_(cfg.recommendationsSheet,GENERIC_RECOMMENDATIONS_HEADER), now=new Date().toISOString();
  var rows=(items||[]).map(function(r,i){
    var itemId=kind==='tv'?r.tmdbTvId:r.placeId;
    var title=kind==='tv'?r.title:r.name;
    var yearOrCity=kind==='tv'?r.year:r.city;
    var metadata=kind==='tv'?(Array.isArray(r.genres)?r.genres.join(' · '):String(r.genres||'')):[r.address,r.cuisine,r.price].filter(Boolean).join(' · ');
    return rowForHeader_(GENERIC_RECOMMENDATIONS_HEADER,{
      recommendationId:recommendationId,user:username,sourceMode:payload.sourceMode||'taste',sourceId:kind==='tv'?(source&&source.id||''):(source&&source.placeId||''),
      sourceTitle:kind==='tv'?(source&&source.name||''):(source&&source.name||''),pool:payload.pool||'new',style:payload.style||'balanced',category:cfg.category,
      recommendedId:itemId,recommendedTitle:title,rank:i+1,role:r.role||'',explanation:r.explanation||'',yearOrCity:yearOrCity||'',metadata:metadata,createdAt:now,status:i<5?'shown':'backup'
    });
  });
  if (rows.length) tab.getRange(tab.getLastRow()+1, 1, rows.length, GENERIC_RECOMMENDATIONS_HEADER.length).setValues(rows);
}

function doRecordGenericRecommendationFeedback_(payload, username, kind) {
  var action=String(payload.action||'').trim(); if(!action) throw new Error('Feedback action is required.');
  var cfg=genericRecommendationConfig_(kind), tab=getOrCreateSheet_(cfg.feedbackSheet,GENERIC_RECOMMENDATION_FEEDBACK_HEADER);
  tab.appendRow(rowForHeader_(GENERIC_RECOMMENDATION_FEEDBACK_HEADER,{
    recommendationId:payload.recommendationId||'',user:username,category:cfg.category,recommendedId:payload.recommendedId||payload.currentId||'',action:action,createdAt:new Date().toISOString()
  }));
  return jsonOut_({ok:true});
}

function genericRecommendationLearningContext_(kind, username) {
  var cfg=genericRecommendationConfig_(kind), recs=sheetObjects_(getExistingSheet_(cfg.recommendationsSheet),GENERIC_RECOMMENDATIONS_HEADER), feedback=sheetObjects_(getExistingSheet_(cfg.feedbackSheet),GENERIC_RECOMMENDATION_FEEDBACK_HEADER);
  var titles={};
  recs.forEach(function(r){if(String(r.user||'').toLowerCase()===String(username||'').toLowerCase())titles[String(r.recommendationId||'')+'|'+String(r.recommendedId||'')]=r.recommendedTitle||'';});
  return feedback.filter(function(f){return String(f.user||'').toLowerCase()===String(username||'').toLowerCase();}).slice(-60).map(function(f){return {title:titles[String(f.recommendationId||'')+'|'+String(f.recommendedId||'')]||'',action:f.action||'',date:f.createdAt||''};});
}

// ══════════════════════════════════════════════════════════════
//  TV + RESTAURANT RECOMMENDATIONS — GEMINI FIRST, API VALIDATED
// ══════════════════════════════════════════════════════════════
function doGetTvRecommendationSources_(username) {
  var rows=sheetObjects_(getExistingSheet_(TV_SHEET_NAME),TV_HEADER)
    .filter(function(r){return String(r.user||'').toLowerCase()===String(username||'').toLowerCase();})
    .map(function(r){return {tmdbTvId:r.tmdbTvId||'',title:r.seriesTitle||'',year:r.seriesYear||'',score10:Number(r.score10||0),type:r.entryType||'season',season:r.seasonNumber||'',genres:r.genres||''};})
    .sort(function(a,b){return b.score10-a.score10||String(a.title).localeCompare(String(b.title));});
  var seen={};rows=rows.filter(function(r){var k=String(r.tmdbTvId||r.title).toLowerCase();if(seen[k])return false;seen[k]=true;return true;});
  return jsonOut_({rows:rows});
}
function tvTasteContext_(username){
  return sheetObjects_(getExistingSheet_(TV_SHEET_NAME),TV_HEADER).filter(function(r){return String(r.user||'').toLowerCase()===String(username||'').toLowerCase();}).sort(function(a,b){return Number(b.score10||0)-Number(a.score10||0);}).slice(0,70).map(function(r){return {title:r.seriesTitle,year:r.seriesYear,type:r.entryType,season:r.seasonNumber,score10:Number(r.score10||0),genres:splitGenres_(r.genres),categories:{plot:r.plot,entertainment:r.entertainment,acting:r.acting,visuals:r.visuals,pacing:r.pacing,emotional:r.emotional},notes:r.overallNotes||''};});
}
function tvStates_(username){var rated={},wished={};sheetObjects_(getExistingSheet_(TV_SHEET_NAME),TV_HEADER).forEach(function(r){if(String(r.user||'').toLowerCase()===String(username).toLowerCase()&&r.tmdbTvId)rated[String(r.tmdbTvId)]=r;});sheetObjects_(getExistingSheet_(FUTURE_TV_SHEET_NAME),FUTURE_TV_HEADER).forEach(function(r){if(String(r.user||'').toLowerCase()===String(username).toLowerCase()&&r.tmdbTvId)wished[String(r.tmdbTvId)]=r;});return {rated:rated,wished:wished};}
function callGeminiGeneric_(kind,prompt){var key=getGeminiKey_(),model='gemini-3.6-flash',diag={attempted:false,success:false,error:key?'':'GEMINI_API_KEY is not configured.',model:model,httpStatus:''};if(!key)return {items:null,diagnostic:diag};diag.attempted=true;try{var res=UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/'+model+':generateContent?key='+encodeURIComponent(key),{method:'post',contentType:'application/json',muteHttpExceptions:true,payload:JSON.stringify({contents:[{parts:[{text:JSON.stringify(prompt)}]}],generationConfig:{responseMimeType:'application/json'}})});diag.httpStatus=res.getResponseCode();if(res.getResponseCode()<200||res.getResponseCode()>=300){diag.error='Gemini returned HTTP '+res.getResponseCode()+': '+String(res.getContentText()||'').slice(0,220);return {items:null,diagnostic:diag};}var data=JSON.parse(res.getContentText()),text=data.candidates&&data.candidates[0]&&data.candidates[0].content&&data.candidates[0].content.parts&&data.candidates[0].content.parts[0].text,parsed=JSON.parse(text||'{}'),items=parsed.recommendations;if(!Array.isArray(items)||!items.length){diag.error='Gemini returned no usable '+kind+' recommendations.';return {items:null,diagnostic:diag};}diag.success=true;diag.error='';return {items:items.slice(0,15),diagnostic:diag};}catch(e){diag.error='Gemini request failed: '+e.message;return {items:null,diagnostic:diag};}}
function doGenerateTvRecommendations_(payload,username){payload=payload||{};var states=tvStates_(username),source=null;if(payload.sourceMode!=='taste'){if(!payload.sourceTmdbId)throw new Error('Choose a source TV show.');source=fetchJson_('https://api.themoviedb.org/3/tv/'+encodeURIComponent(payload.sourceTmdbId)+'?api_key='+encodeURIComponent(getTmdbKey()));}
  var exclusions=[];Object.keys(states.rated).forEach(function(id){if(payload.pool!=='all')exclusions.push({id:id,title:states.rated[id].seriesTitle,reason:'rated'});});if(payload.pool==='notWishlist')Object.keys(states.wished).forEach(function(id){exclusions.push({id:id,title:states.wished[id].seriesTitle,reason:'wishlisted'});});(payload.excludeIds||[]).forEach(function(id){exclusions.push({id:id,reason:'already shown'});});
  var ai=callGeminiGeneric_('TV',{instruction:'Generate exactly 15 real television series recommendations. Use the user\'s actual ratings, category scores, notes, tone, pacing, themes, and viewing experience. Respect exclusions. Return strict JSON only.',mode:payload.sourceMode==='taste'?'overall taste':'source show plus taste',style:payload.style||'balanced',source:source?{title:source.name,year:String(source.first_air_date||'').slice(0,4),overview:source.overview,genres:(source.genres||[]).map(function(g){return g.name;})}:null,history:tvTasteContext_(username),recommendationFeedback:genericRecommendationLearningContext_('tv',username),exclusions:exclusions,outputSchema:{recommendations:[{title:'exact series title',year:'first air year',role:'short label',explanation:'specific reason'}]}});
  if(!ai.items)throw new Error(ai.diagnostic.error||'TV recommendations could not be generated.');var req=ai.items.map(function(x){return {url:'https://api.themoviedb.org/3/search/tv?api_key='+encodeURIComponent(getTmdbKey())+'&query='+encodeURIComponent(x.title)+(x.year?'&first_air_date_year='+encodeURIComponent(x.year):''),muteHttpExceptions:true};}),resp=UrlFetchApp.fetchAll(req),seen={},valid=[];resp.forEach(function(r,i){if(r.getResponseCode()<200||r.getResponseCode()>=300)return;var d=JSON.parse(r.getContentText()),m=(d.results||[])[0];if(!m)return;var id=String(m.id);if(seen[id]||(payload.excludeIds||[]).map(String).indexOf(id)>-1)return;if(payload.pool!=='all'&&states.rated[id])return;if(payload.pool==='notWishlist'&&states.wished[id])return;seen[id]=true;valid.push({tmdbTvId:m.id,title:m.name,year:String(m.first_air_date||'').slice(0,4),posterPath:m.poster_path||'',genres:[],tmdbRating:Number(m.vote_average||0).toFixed(1),role:ai.items[i].role||recommendationRole_(valid.length,payload.style),explanation:ai.items[i].explanation||'',ratedScore:states.rated[id]?Number(states.rated[id].score10||0):'',wishlisted:!!states.wished[id]});});if(valid.length<5)throw new Error('Fewer than five eligible TV recommendations validated. Try a broader pool.');valid=valid.slice(0,10);var id=Utilities.getUuid();persistGenericRecommendations_('tv',username,payload,source,valid,id);CacheService.getScriptCache().put('generic_rec_tv_'+id,JSON.stringify(valid.slice(5)),21600);return jsonOut_({recommendationId:id,recommendations:valid.slice(0,5),profileSummary:{ratingCount:tvTasteContext_(username).length},aiEnhanced:true,diagnostics:{engine:'Gemini-generated TV recommendations',validatedCount:valid.length,backupCount:Math.max(0,valid.length-5),aiCandidateCount:ai.items.length,model:ai.diagnostic.model,aiError:''}});}
function doGetRestaurantRecommendationSources_(username){var rows=sheetObjects_(getExistingSheet_(RESTAURANTS_SHEET_NAME),RESTAURANTS_HEADER).filter(function(r){return String(r.user||'').toLowerCase()===String(username||'').toLowerCase();}).map(function(r){return {placeId:r.placeId||'',name:r.name||'',city:r.city||'',cuisine:r.cuisine||'',score10:Number(r.score10||0),address:r.address||''};}).sort(function(a,b){return b.score10-a.score10||String(a.name).localeCompare(String(b.name));});return jsonOut_({rows:rows});}
function restaurantTasteContext_(username){return sheetObjects_(getExistingSheet_(RESTAURANTS_SHEET_NAME),RESTAURANTS_HEADER).filter(function(r){return String(r.user||'').toLowerCase()===String(username||'').toLowerCase();}).sort(function(a,b){return Number(b.score10||0)-Number(a.score10||0);}).slice(0,70).map(function(r){return {name:r.name,city:r.city,cuisine:r.cuisine,price:r.price,score10:Number(r.score10||0),categories:{food:r.food,value:r.value,service:r.service,atmosphere:r.atmosphere,craving:r.craving},notes:r.overallNotes||''};});}
function restaurantStates_(username){var rated={},wished={};sheetObjects_(getExistingSheet_(RESTAURANTS_SHEET_NAME),RESTAURANTS_HEADER).forEach(function(r){if(String(r.user||'').toLowerCase()===String(username).toLowerCase()&&r.placeId)rated[String(r.placeId)]=r;});sheetObjects_(getExistingSheet_(FUTURE_RESTAURANTS_SHEET_NAME),FUTURE_RESTAURANTS_HEADER).forEach(function(r){if(String(r.user||'').toLowerCase()===String(username).toLowerCase()&&r.placeId)wished[String(r.placeId)]=r;});return {rated:rated,wished:wished};}
function restaurantRecommendationArea_(payload) {
  return [payload.city, payload.region, payload.country].map(function(part){ return String(part || '').trim(); }).filter(Boolean).join(', ');
}

function doGenerateRestaurantRecommendations_(payload, username) {
  payload = payload || {};
  var history = restaurantTasteContext_(username), states = restaurantStates_(username), source = null;
  if (payload.sourceMode !== 'taste') {
    source = doGetRestaurantRecommendationSourcesData_(username, payload.sourcePlaceId);
    if (!source) throw new Error('Choose a source restaurant.');
  }
  var defaultLocation = restaurantRecommendationArea_(payload) || (source && source.city) || mostCommonCity_(history);
  if (!defaultLocation) throw new Error('Enter a recommendation area or rate a restaurant with a city first.');

  var exclusions = [], excludedIds = {};
  Object.keys(states.rated).forEach(function(id) {
    if (payload.pool !== 'all') exclusions.push({name:states.rated[id].name,city:states.rated[id].city,reason:'rated'});
  });
  if (payload.pool === 'notWishlist') Object.keys(states.wished).forEach(function(id) {
    exclusions.push({name:states.wished[id].name,city:states.wished[id].city,reason:'wishlisted'});
  });
  (payload.excludeIds || []).forEach(function(id){ excludedIds[String(id)] = true; });

  var ai = callGeminiGeneric_('restaurant', {
    instruction:'Generate exactly 12 real operating restaurant recommendations in the requested area. Use cuisine, food quality, value, service, atmosphere, craving, price, notes, and the user\'s actual history. Respect exclusions. Return strict JSON only.',
    mode:payload.sourceMode === 'taste' ? 'overall restaurant taste' : 'source restaurant plus taste',
    style:payload.style || 'balanced',
    location:defaultLocation,
    source:source,
    history:history,
    recommendationFeedback:genericRecommendationLearningContext_('restaurant', username),
    exclusions:exclusions,
    outputSchema:{recommendations:[{name:'exact restaurant name',city:'city',role:'short label',explanation:'specific reason'}]}
  });
  if (!ai.items) throw new Error(ai.diagnostic.error || 'Restaurant recommendations could not be generated.');

  var candidates = ai.items.slice(0, 12), key = getPlacesKey();
  var requests = candidates.map(function(item) {
    var itemLocation = item.city ? [item.city, payload.region, payload.country].filter(Boolean).join(', ') : defaultLocation;
    return {url:'https://maps.googleapis.com/maps/api/place/textsearch/json?query='+encodeURIComponent(item.name+' restaurant '+itemLocation)+'&type=restaurant&key='+encodeURIComponent(key),muteHttpExceptions:true};
  });
  var responses = UrlFetchApp.fetchAll(requests), seen = {}, valid = [];
  responses.forEach(function(response, index) {
    if (response.getResponseCode() < 200 || response.getResponseCode() >= 300) return;
    var data = JSON.parse(response.getContentText()), match = (data.results || [])[0];
    if (!match) return;
    var placeId = String(match.place_id);
    if (seen[placeId] || excludedIds[placeId]) return;
    if (payload.pool !== 'all' && states.rated[placeId]) return;
    if (payload.pool === 'notWishlist' && states.wished[placeId]) return;
    seen[placeId] = true;
    var parts = String(match.formatted_address || '').split(',');
    valid.push({
      placeId:placeId,name:match.name,address:match.formatted_address || '',city:parts.length > 1 ? parts[parts.length - 2].trim() : defaultLocation,
      cuisine:'',price:match.price_level === undefined ? '' : ['', '$', '$$', '$$$', '$$$$'][match.price_level],googleRating:match.rating || '',photo:'',
      role:candidates[index].role || recommendationRole_(valid.length, payload.style),explanation:candidates[index].explanation || '',
      ratedScore:states.rated[placeId] ? Number(states.rated[placeId].score10 || 0) : '',wishlisted:!!states.wished[placeId]
    });
  });
  if (valid.length < 5) throw new Error('Fewer than five eligible restaurant recommendations validated. Try a broader pool or another area.');
  valid = valid.slice(0, 10);
  var recommendationId = Utilities.getUuid();
  persistGenericRecommendations_('restaurant', username, payload, source, valid, recommendationId);
  CacheService.getScriptCache().put('generic_rec_restaurant_'+recommendationId, JSON.stringify(valid.slice(5)), 21600);
  return jsonOut_({recommendationId:recommendationId,recommendations:valid.slice(0,5),profileSummary:{ratingCount:history.length},aiEnhanced:true,diagnostics:{engine:'Gemini-generated restaurant recommendations',validatedCount:valid.length,backupCount:Math.max(0,valid.length-5),aiCandidateCount:candidates.length,model:ai.diagnostic.model,aiError:'',city:defaultLocation}});
}
function doGetRestaurantRecommendationSourcesData_(username,placeId){return sheetObjects_(getExistingSheet_(RESTAURANTS_SHEET_NAME),RESTAURANTS_HEADER).filter(function(r){return String(r.user||'').toLowerCase()===String(username||'').toLowerCase()&&String(r.placeId||'')===String(placeId||'');})[0]||null;}
function mostCommonCity_(history){var c={};(history||[]).forEach(function(r){if(r.city)c[r.city]=(c[r.city]||0)+1;});return Object.keys(c).sort(function(a,b){return c[b]-c[a];})[0]||'';}
function doReplaceGenericRecommendation_(payload,username,kind){var id=String(payload.recommendationId||'');if(!id)throw new Error('Recommendation session is missing.');var cache=CacheService.getScriptCache(),key='generic_rec_'+kind+'_'+id,raw=cache.get(key),arr=raw?JSON.parse(raw):[];if(!arr.length)return jsonOut_({exhausted:true});doRecordGenericRecommendationFeedback_({recommendationId:id,recommendedId:payload.currentId||'',action:payload.action||'replaced'},username,kind);var next=arr.shift();cache.put(key,JSON.stringify(arr),21600);return jsonOut_({recommendation:next,remainingBackups:arr.length,exhausted:false});}

// ─────────────────────────────────────────────────────────────
//  CINE-FILE — Google Apps Script
//  Version: 2026.07.11-active-tabs-only.1
//  Runtime: GitHub Pages frontend + Apps Script JSON backend
//
//  Version notes:
//  - active-tabs-only.1: remove old migration/debug sheet paths and use only active database/summary tabs.
//
//  Original by friend, restaurant functions added by Claude
// ─────────────────────────────────────────────────────────────

const BACKEND_VERSION = '2026.07.11-active-tabs-only.1';
const SESSION_TTL_SECONDS = 6 * 60 * 60;

const FILMS_SHEET_NAME = 'Database-Films';
const RESTAURANTS_SHEET_NAME = 'Database-Restaurants';
const FILMS_SUMMARY_SHEET_NAME = 'Summary-Films';
const RESTAURANTS_SUMMARY_SHEET_NAME = 'Summary-Restaurants';

const FILM_SUMMARY_BASE_COLUMNS = ['Title','Year','Genre','Director','Movie length'];
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

// Handle CORS preflight OPTIONS requests
function doOptions(e) {
  return ContentService.createTextOutput('')
    .setMimeType(ContentService.MimeType.TEXT);
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
    if (action === 'getDeploymentStatus') return doGetDeploymentStatus_(d);
    if (action === 'getSession') return doGetSession_(d);

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

    // Session required
    var sess = validateSession_(token);
    if (!sess) return jsonOut_({ error: 'Invalid or expired session. Please log in again.' });
    var username = sess.username;

    if (action === 'searchMovies')           return doSearchMovies_(d);
    if (action === 'getMovieDetails')        return doGetMovieDetails_(d);
    if (action === 'saveRating')             return doSaveRating_(d.payload || d, username);
    if (action === 'getRatings')             return doGetRatings_(username);
    if (action === 'getSummary')             return doGetSummary_();
    if (action === 'searchRestaurants')      return doSearchRestaurants_(d);
    if (action === 'saveRestaurantRating')   return doSaveRestaurantRating_(d.payload || d, username);
    if (action === 'getRestaurantRatings')   return doGetRestaurantRatings_(username);
    if (action === 'getRestaurantSummary')   return doGetRestaurantSummary_();

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
  var user  = users.filter(function(u){ return String(u.name).trim().toLowerCase() === username.toLowerCase(); })[0];
  if (!user) return jsonOut_({ success: false, error: 'User not found', version: BACKEND_VERSION, debug: { username: username, usersSeen: users.length } });
  var pin = String(d.pin || '').padStart(4, '0');
  var valid = user.legacyPin
    ? String(user.legacyPin).padStart(4, '0') === pin
    : verifyPin_(pin, user.pinHash, user.pinSalt);
  if (!valid) {
    return jsonOut_({
      success: false,
      error: 'Incorrect PIN',
      version: BACKEND_VERSION,
      debug: {
        username: username,
        matchedUser: user.name,
        mode: user.legacyPin ? 'plain-pin' : (user.pinHash && user.pinSalt ? 'pinHash-pinSalt' : 'incomplete-user-row'),
        enteredPinLength: String(d.pin || '').length,
        pinHashLength: String(user.pinHash || '').length,
        hasPinSalt: !!user.pinSalt
      }
    });
  }
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
  var pin = String(d.pin || '').padStart(4, '0');
  if (pin !== getAdminPin()) return jsonOut_({ success: false, error: 'Incorrect admin PIN' });
  var token = createAdminSession_();
  return jsonOut_({ success: true, adminToken: token });
}

function doGetSession_(d) {
  var sess = validateSession_(d.token || '');
  if (!sess) return jsonOut_({ error: 'Invalid or expired session. Please log in again.' });
  return jsonOut_({ user: { name: sess.username } });
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
}

// ── SEARCH MOVIES ─────────────────────────────────────────────
function doSearchMovies_(d) {
  var url = 'https://api.themoviedb.org/3/search/movie?api_key=' + getTmdbKey() +
            '&query=' + encodeURIComponent(d.query || '') + '&include_adult=false';
  var data = fetchJson_(url);
  var results = (data.results || []).slice(0, 7).map(function(r) {
    return {
      id:          r.id,
      title:       r.title,
      year:        (r.release_date || '').slice(0, 4),
      poster_path: r.poster_path || '',
      overview:    r.overview    || ''
    };
  });
  return jsonOut_({ results: results });
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
  if (!tab) tab = ss.insertSheet(name);
  ensureHeader_(tab, header);
  formatSheetAsTable_(tab);
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

function formatSheetAsTable_(tab) {
  if (!tab || tab.getLastRow() < 1 || tab.getLastColumn() < 1) return;
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
    tab.autoResizeColumns(1, tab.getLastColumn());
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

function findExistingRow_(tab, header, rowObj, keyFn) {
  var values = tab.getDataRange().getValues();
  if (values.length < 2) return -1;
  var keys = values[0].map(function(k){ return String(k || '').trim(); });
  if (header && header.length && keys[0] !== header[0]) {
    keys = header.slice();
  }
  var target = keyFn(rowObj);
  for (var i = 1; i < values.length; i++) {
    var obj = {};
    keys.forEach(function(k, j){ if (k) obj[k] = values[i][j]; });
    if (keyFn(obj) === target) return i + 1;
  }
  return -1;
}

function categoryKey_(user, primaryId, name, yearOrAddress) {
  var id = String(primaryId || '').trim();
  if (id) return String(user || '').toLowerCase() + '|id|' + id;
  return String(user || '').toLowerCase() + '|name|' +
    String(name || '').trim().toLowerCase() + '|' +
    String(yearOrAddress || '').trim().toLowerCase();
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
    tmdbId: d.tmdbId || existing.tmdbId || '',
    posterPath: d.posterPath || existing.posterPath || '',
    genres: d.genres || existing.genres || '',
    runtimeMinutes: d.runtimeMinutes || d.runtime || existing.runtimeMinutes || '',
    createdAt: existing.createdAt || now,
    updatedAt: now
  };
}

// ── SAVE FILM RATING ──────────────────────────────────────────
function doSaveRating_(d, username) {
  var tab = getOrCreateSheet_(FILMS_SHEET_NAME, FILMS_HEADER);
  var rowObj = filmPayloadToSheetRow_(d, username, {});
  var existingRow = findExistingRow_(tab, FILMS_HEADER, rowObj, function(r) {
    return categoryKey_(r.user, r.tmdbId, r.title, r.year);
  });
  if (existingRow > -1) {
    var existingObj = objectAtSheetRow_(tab, existingRow);
    rowObj = filmPayloadToSheetRow_(d, username, existingObj);
    tab.getRange(existingRow, 1, 1, FILMS_HEADER.length).setValues([rowForHeader_(FILMS_HEADER, rowObj)]);
  } else {
    tab.appendRow(rowForHeader_(FILMS_HEADER, rowObj));
  }
  rebuildFilmSummary_();
  return jsonOut_({ ok: true });
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
    var key = r.tmdbId ? 'tmdb|' + r.tmdbId : 'title|' + String(r.title || '').toLowerCase() + '|' + String(r.year || '');
    if (!grouped[key]) {
      grouped[key] = { Title: r.title, Year: r.year, scores: [], userScores: {} };
    }
    var score = parseFloat(r.score10);
    if (!isNaN(score) && r.user) {
      grouped[key].scores.push(score);
      grouped[key].userScores[summaryDisplayName_(r.user)] = score;
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
    var key = r.tmdbId ? 'tmdb|' + r.tmdbId : 'title|' + String(r.title || '').toLowerCase() + '|' + String(r.year || '');
    if (!grouped[key]) {
      grouped[key] = {
        title: r.title,
        year: r.year,
        genre: r.genres || '',
        director: r.director || '',
        runtimeMinutes: r.runtimeMinutes || '',
        tmdbId: r.tmdbId || '',
        scoresByUser: {}
      };
    }
    grouped[key].genre = grouped[key].genre || r.genres || '';
    grouped[key].director = grouped[key].director || r.director || '';
    grouped[key].runtimeMinutes = grouped[key].runtimeMinutes || r.runtimeMinutes || '';
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
    return [g.title, g.year, g.genre, g.director, formatRuntime_(g.runtimeMinutes)]
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
  formatSheetAsTable_(tab);
}

// ══════════════════════════════════════════════════════════════
//  LE GUIDE — RESTAURANT FUNCTIONS
// ══════════════════════════════════════════════════════════════

// ── SEARCH RESTAURANTS ────────────────────────────────────────
function doSearchRestaurants_(d) {
  var q   = d.query || '';
  var lat = d.lat   || null;
  var lng = d.lng   || null;
  var key = getPlacesKey();

  var url = 'https://maps.googleapis.com/maps/api/place/textsearch/json?' +
            'query=' + encodeURIComponent(q + ' restaurant') +
            '&type=restaurant' +
            '&key=' + key;
  if (lat && lng) url += '&location=' + lat + ',' + lng + '&radius=50000';

  var data = fetchJson_(url);
  if (data.status && data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
    throw new Error('Google Places request failed: ' + data.status + (data.error_message ? ' - ' + data.error_message : ''));
  }

  var results = (data.results || []).slice(0, 8).map(function(r) {
    var photo = '';
    if (r.photos && r.photos.length > 0) {
      photo = getPlacePhotoDataUrl_(r.photos[0].photo_reference, key);
    }
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
      photo:   photo
    };
  });

  return jsonOut_({ results: results });
}

function getPlacePhotoDataUrl_(photoReference, key) {
  if (!photoReference) return '';
  try {
    var url = 'https://maps.googleapis.com/maps/api/place/photo?maxwidth=88' +
              '&photo_reference=' + encodeURIComponent(photoReference) +
              '&key=' + encodeURIComponent(key);
    var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
    var code = res.getResponseCode();
    if (code < 200 || code >= 300) return '';
    var blob = res.getBlob();
    var contentType = blob.getContentType() || 'image/jpeg';
    return 'data:' + contentType + ';base64,' + Utilities.base64Encode(blob.getBytes());
  } catch (e) {
    return '';
  }
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
    placeId: d.placeId || existing.placeId || '',
    createdAt: existing.createdAt || now,
    updatedAt: now
  };
}

// ── SAVE RESTAURANT RATING ────────────────────────────────────
function doSaveRestaurantRating_(d, username) {
  var tab = getOrCreateSheet_(RESTAURANTS_SHEET_NAME, RESTAURANTS_HEADER);
  var rowObj = restaurantPayloadToSheetRow_(d, username, {});
  var existingRow = findExistingRow_(tab, RESTAURANTS_HEADER, rowObj, function(r) {
    return categoryKey_(r.user, r.placeId, r.name, r.address);
  });
  if (existingRow > -1) {
    var existingObj = objectAtSheetRow_(tab, existingRow);
    rowObj = restaurantPayloadToSheetRow_(d, username, existingObj);
    tab.getRange(existingRow, 1, 1, RESTAURANTS_HEADER.length).setValues([rowForHeader_(RESTAURANTS_HEADER, rowObj)]);
  } else {
    tab.appendRow(rowForHeader_(RESTAURANTS_HEADER, rowObj));
  }
  rebuildRestaurantSummary_();
  return jsonOut_({ ok: true });
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
    var key = r.placeId ? 'place|' + r.placeId : 'name|' + String(r.name || '').toLowerCase() + '|' + String(r.address || '').toLowerCase();
    if (!grouped[key]) {
      grouped[key] = { Name: r.name, Address: r.address, scores: [], userScores: {} };
    }
    var score = parseFloat(r.score10);
    if (!isNaN(score) && r.user) {
      grouped[key].scores.push(score);
      grouped[key].userScores[summaryDisplayName_(r.user)] = score;
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
    var key = r.placeId ? 'place|' + r.placeId : 'name|' + String(r.name || '').toLowerCase() + '|' + String(r.address || '').toLowerCase();
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

function setupActiveSheetTabs() {
  var filmDb = getOrCreateSheet_(FILMS_SHEET_NAME, FILMS_HEADER);
  var restaurantDb = getOrCreateSheet_(RESTAURANTS_SHEET_NAME, RESTAURANTS_HEADER);
  formatSheetAsTable_(filmDb);
  formatSheetAsTable_(restaurantDb);
  var filmSummary = rebuildFilmSummary_();
  var restaurantSummary = rebuildRestaurantSummary_();
  var result = {
    version: BACKEND_VERSION,
    databaseFilms: FILMS_SHEET_NAME,
    summaryFilms: filmSummary,
    databaseRestaurants: RESTAURANTS_SHEET_NAME,
    summaryRestaurants: restaurantSummary,
    usersTabKept: true
  };
  console.log(JSON.stringify(result, null, 2));
  return result;
}

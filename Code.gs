// ─────────────────────────────────────────────────────────────
//  CINE-FILE — Google Apps Script
//  Original by friend, restaurant functions added by Claude
// ─────────────────────────────────────────────────────────────

const SESSION_TTL_SECONDS = 6 * 60 * 60;

function getScriptProps() {
  return PropertiesService.getScriptProperties();
}

function getSheetId() {
  return getScriptProps().getProperty('SHEET_ID');
}

function getTmdbKey() {
  return getScriptProps().getProperty('TMDB_API_KEY');
}

function getOmdbKey() {
  return getScriptProps().getProperty('OMDB_API_KEY');
}

function getAdminPin() {
  return getScriptProps().getProperty('ADMIN_PIN') || '2028';
}

function getPlacesKey() {
  return getScriptProps().getProperty('GOOGLE_PLACES_KEY');
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
  var bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    pin + salt,
    Utilities.Charset.UTF_8
  );
  var hex = bytes.map(function(b){ return ('0'+(b&0xFF).toString(16)).slice(-2); }).join('');
  return { hash: hex, salt: salt };
}

function verifyPin_(pin, storedHash, storedSalt) {
  if (!storedHash || !storedSalt) return false;
  var result = hashPin_(pin, storedSalt);
  return result.hash === storedHash;
}

// ── USERS ─────────────────────────────────────────────────────
function getUsersSheet_() {
  var ss  = SpreadsheetApp.openById(getSheetId());
  var tab = ss.getSheetByName('Users');
  if (!tab) {
    tab = ss.insertSheet('Users');
    tab.appendRow(['name','hash','salt']);
  }
  return tab;
}

function getUsers_() {
  var tab  = getUsersSheet_();
  var rows = tab.getDataRange().getValues();
  var out  = [];
  for (var i = 1; i < rows.length; i++) {
    if (rows[i][0]) out.push({ name: rows[i][0], hash: rows[i][1], salt: rows[i][2] });
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

    // Admin actions
    if (action === 'saveUsers') {
      if (!validateAdminSession_(d.adminToken)) return jsonOut_({ error: 'Unauthorized' });
      return doSaveUsers_(d);
    }

    // Session required
    var sess = validateSession_(token);
    if (!sess) return jsonOut_({ error: 'Invalid or expired session. Please log in again.' });
    var username = sess.username;

    if (action === 'searchMovies')           return doSearchMovies_(d);
    if (action === 'getMovieDetails')        return doGetMovieDetails_(d);
    if (action === 'saveRating')             return doSaveRating_(d, username);
    if (action === 'searchRestaurants')      return doSearchRestaurants_(d);
    if (action === 'saveRestaurantRating')   return doSaveRestaurantRating_(d, username);

    return jsonOut_({ error: 'Unknown action: ' + action });
  } catch(err) {
    return jsonOut_({ error: err.message });
  }
}

function doGet(e) {
  try {
    var action = e.parameter.action || 'getRatings';
    var token  = e.parameter.token  || '';
    var user   = e.parameter.user   || '';

    if (action === 'getUsers') return jsonOut_({ users: getUsersPublic_() });

    if (action === 'getUsers')             return jsonOut_({ users: getUsersPublic_() });
    if (action === 'getSummary')           return doGetSummary_();
    if (action === 'getRestaurantSummary') return doGetRestaurantSummary_();
    if (action === 'searchRestaurants')    return doSearchRestaurants_({query: e.parameter.query||'', lat: e.parameter.lat||null, lng: e.parameter.lng||null});

    // These require a valid user parameter
    if (action === 'getRatings')           return doGetRatings_(user);
    if (action === 'getRestaurantRatings') return doGetRestaurantRatings_(user);

    return jsonOut_({ error: 'Unknown action' });
  } catch(err) {
    return jsonOut_({ error: err.message });
  }
}

// ── LOGIN ─────────────────────────────────────────────────────
function doLogin_(d) {
  var users = getUsers_();
  var user  = users.filter(function(u){ return u.name === d.username; })[0];
  if (!user) return jsonOut_({ success: false, error: 'User not found' });
  var pin = String(d.pin || '').padStart(4, '0');
  if (!verifyPin_(pin, user.hash, user.salt))
    return jsonOut_({ success: false, error: 'Incorrect PIN' });
  var token = createSession_(d.username);
  return jsonOut_({ success: true, token: token, username: d.username });
}

function doLoginAdmin_(d) {
  var pin = String(d.pin || '').padStart(4, '0');
  if (pin !== getAdminPin()) return jsonOut_({ success: false, error: 'Incorrect admin PIN' });
  var token = createAdminSession_();
  return jsonOut_({ success: true, adminToken: token });
}

// ── SAVE USERS ────────────────────────────────────────────────
function doSaveUsers_(d) {
  var tab = getUsersSheet_();
  tab.clearContents();
  tab.appendRow(['name','hash','salt']);
  (d.users || []).forEach(function(u) {
    var pin    = String(u.pin || '').padStart(4, '0');
    var hashed = hashPin_(pin);
    tab.appendRow([u.name, hashed.hash, hashed.salt]);
  });
  return jsonOut_({ ok: true });
}

// ── SEARCH MOVIES ─────────────────────────────────────────────
function doSearchMovies_(d) {
  var url = 'https://api.themoviedb.org/3/search/movie?api_key=' + getTmdbKey() +
            '&query=' + encodeURIComponent(d.query || '') + '&include_adult=false';
  var res  = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  var data = JSON.parse(res.getContentText());
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
  var res  = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  var data = JSON.parse(res.getContentText());
  var director = '';
  if (data.credits && data.credits.crew) {
    var dir = data.credits.crew.filter(function(c){ return c.job === 'Director'; })[0];
    if (dir) director = dir.name;
  }
  var rt = null, imdb = null;
  try {
    var oUrl  = 'https://www.omdbapi.com/?apikey=' + getOmdbKey() +
                '&t=' + encodeURIComponent(data.title) +
                '&y=' + (data.release_date || '').slice(0, 4) + '&tomatoes=true';
    var oRes  = UrlFetchApp.fetch(oUrl, { muteHttpExceptions: true });
    var oData = JSON.parse(oRes.getContentText());
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
    poster_path: data.poster_path || '',
    genres:      (data.genres || []).map(function(g){ return g.name; })
  });
}

// ── SAVE FILM RATING ──────────────────────────────────────────
function doSaveRating_(d, username) {
  var ss  = SpreadsheetApp.openById(getSheetId());
  var tab = ss.getSheetByName(username) || ss.insertSheet(username);

  if (tab.getLastRow() === 0) {
    tab.appendRow(["Date","Title","Year","Director","RT Audience","IMDb",
      "Score /10","Raw /100","Grade",
      "Plot","Plot Grade","Plot Notes",
      "Entertainment","Ent Grade","Ent Notes",
      "Acting","Acting Grade","Acting Notes",
      "Visuals","Visuals Grade","Visuals Notes",
      "Pacing","Pacing Grade","Pacing Notes",
      "Emotional","Emotional Grade","Emotional Notes","Overall Notes"]);
  }

  var newRow = [d.date,d.title,d.year,d.director,d.rt,d.imdb,
    d.score10,d.score100,d.grade,
    d.plot,d.plotGrade,d.plotNotes,
    d.entertainment,d.entGrade,d.entNotes,
    d.acting,d.actingGrade,d.actingNotes,
    d.visuals,d.visualsGrade,d.visualsNotes,
    d.pacing,d.pacingGrade,d.pacingNotes,
    d.emotional,d.emotionalGrade,d.emotionalNotes,d.notes];

  var tabData     = tab.getDataRange().getValues();
  var existingRow = -1;
  for (var i = 1; i < tabData.length; i++) {
    if (String(tabData[i][1]).toLowerCase() === String(d.title).toLowerCase()) {
      existingRow = i + 1; break;
    }
  }
  if (existingRow > -1) {
    tab.getRange(existingRow, 1, 1, newRow.length).setValues([newRow]);
  } else {
    tab.appendRow(newRow);
  }

  // Summary tab
  var sum = ss.getSheetByName('Summary') || ss.insertSheet('Summary');
  if (sum.getLastRow() === 0)
    sum.appendRow(['Title','Year','Director','RT Audience','IMDb']);

  var sumData = sum.getDataRange().getValues();
  var rowIdx  = -1;
  for (var i = 1; i < sumData.length; i++) {
    if (sumData[i][0] === d.title) { rowIdx = i + 1; break; }
  }
  if (rowIdx === -1) {
    sum.appendRow([d.title, d.year, d.director, d.rt, d.imdb]);
    rowIdx  = sum.getLastRow();
    sumData = sum.getDataRange().getValues();
  }
  var headers = sumData[0];
  var userCol = headers.indexOf(username);
  if (userCol === -1) {
    userCol = headers.length;
    sum.getRange(1, userCol + 1).setValue(username);
  }
  sum.getRange(rowIdx, userCol + 1).setValue(d.score10);

  return jsonOut_({ ok: true });
}

// ── GET FILM RATINGS ──────────────────────────────────────────
function doGetRatings_(username) {
  var ss  = SpreadsheetApp.openById(getSheetId());
  var tab = ss.getSheetByName(username);
  if (!tab) return jsonOut_([]);
  var rows = tab.getDataRange().getValues();
  var keys = rows[0];
  var out  = [];
  for (var i = 1; i < rows.length; i++) {
    var obj = {};
    keys.forEach(function(k, j){ obj[k] = rows[i][j]; });
    out.push(obj);
  }
  return jsonOut_(out);
}

// ── GET FILM SUMMARY ──────────────────────────────────────────
function doGetSummary_() {
  var ss  = SpreadsheetApp.openById(getSheetId());
  var sum = ss.getSheetByName('Summary');
  if (!sum) return jsonOut_({ rows: [] });
  var data    = sum.getDataRange().getValues();
  var headers = data[0];
  var rows    = [];
  for (var i = 1; i < data.length; i++) {
    var row = { Title: data[i][0], Year: data[i][1], scores: [], userScores: {} };
    for (var j = 5; j < headers.length; j++) {
      if (headers[j] && data[i][j] !== '') {
        var s = parseFloat(data[i][j]);
        if (!isNaN(s)) { row.scores.push(s); row.userScores[headers[j]] = s; }
      }
    }
    rows.push(row);
  }
  return jsonOut_({ rows: rows });
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

  var res  = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  var data = JSON.parse(res.getContentText());

  var results = (data.results || []).slice(0, 8).map(function(r) {
    var photo = '';
    if (r.photos && r.photos.length > 0) {
      photo = 'https://maps.googleapis.com/maps/api/place/photo?maxwidth=200' +
              '&photo_reference=' + r.photos[0].photo_reference +
              '&key=' + key;
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

// ── SAVE RESTAURANT RATING ────────────────────────────────────
function doSaveRestaurantRating_(d, username) {
  var ss      = SpreadsheetApp.openById(getSheetId());
  var tabName = username + '-Restaurants';
  var tab     = ss.getSheetByName(tabName) || ss.insertSheet(tabName);

  if (tab.getLastRow() === 0) {
    tab.appendRow(["Date","Name","Address","Cuisine","Price","Google Rating",
      "Score /10","Raw /100","Grade","Stars",
      "Food","Food Grade","Value","Value Grade",
      "Service","Service Grade","Atmosphere","Atmosphere Grade",
      "Craving","Craving Grade","Overall Notes","Place ID"]);
  }

  var newRow = [d.date, d.name, d.address, d.cuisine, d.price, d.googleRating,
    d.score10, d.score100, d.grade, d.stars,
    d.food,       d.foodGrade,
    d.value,      d.valueGrade,
    d.service,    d.serviceGrade,
    d.atmosphere, d.atmosphereGrade,
    d.craving,    d.cravingGrade,
    d.notes,      d.placeId || ''];

  // Overwrite if already exists
  var tabData     = tab.getDataRange().getValues();
  var existingRow = -1;
  for (var i = 1; i < tabData.length; i++) {
    if (String(tabData[i][1]).toLowerCase() === String(d.name).toLowerCase() &&
        String(tabData[i][2]).toLowerCase() === String(d.address || '').toLowerCase()) {
      existingRow = i + 1; break;
    }
  }
  if (existingRow > -1) {
    tab.getRange(existingRow, 1, 1, newRow.length).setValues([newRow]);
  } else {
    tab.appendRow(newRow);
  }

  // Restaurant Summary tab
  var sum = ss.getSheetByName('Restaurant Summary') || ss.insertSheet('Restaurant Summary');
  if (sum.getLastRow() === 0)
    sum.appendRow(['Name','Address','Cuisine','Price','Google Rating']);

  var sumData = sum.getDataRange().getValues();
  var rowIdx  = -1;
  for (var i = 1; i < sumData.length; i++) {
    if (String(sumData[i][0]).toLowerCase() === String(d.name).toLowerCase() &&
        String(sumData[i][1]).toLowerCase() === String(d.address || '').toLowerCase()) {
      rowIdx = i + 1; break;
    }
  }
  if (rowIdx === -1) {
    sum.appendRow([d.name, d.address, d.cuisine, d.price, d.googleRating]);
    rowIdx  = sum.getLastRow();
    sumData = sum.getDataRange().getValues();
  }
  var headers = sumData[0];
  var userCol = headers.indexOf(username);
  if (userCol === -1) {
    userCol = headers.length;
    sum.getRange(1, userCol + 1).setValue(username);
  }
  sum.getRange(rowIdx, userCol + 1).setValue(d.score10);

  return jsonOut_({ ok: true });
}

// ── GET RESTAURANT RATINGS ────────────────────────────────────
function doGetRestaurantRatings_(username) {
  var ss  = SpreadsheetApp.openById(getSheetId());
  var tab = ss.getSheetByName(username + '-Restaurants');
  if (!tab) return jsonOut_([]);
  var rows = tab.getDataRange().getValues();
  var keys = rows[0];
  var out  = [];
  for (var i = 1; i < rows.length; i++) {
    var obj = {};
    keys.forEach(function(k, j){ obj[k] = rows[i][j]; });
    out.push(obj);
  }
  return jsonOut_(out);
}

// ── GET RESTAURANT SUMMARY ────────────────────────────────────
function doGetRestaurantSummary_() {
  var ss  = SpreadsheetApp.openById(getSheetId());
  var sum = ss.getSheetByName('Restaurant Summary');
  if (!sum) return jsonOut_({ rows: [] });
  var data    = sum.getDataRange().getValues();
  var headers = data[0];
  var rows    = [];
  for (var i = 1; i < data.length; i++) {
    var row = { Name: data[i][0], Address: data[i][1], scores: [], userScores: {} };
    for (var j = 5; j < headers.length; j++) {
      if (headers[j] && data[i][j] !== '') {
        var s = parseFloat(data[i][j]);
        if (!isNaN(s)) { row.scores.push(s); row.userScores[headers[j]] = s; }
      }
    }
    rows.push(row);
  }
  return jsonOut_({ rows: rows });
}

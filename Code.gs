const SESSION_TTL_SECONDS = 6 * 60 * 60;

const USERS_HEADER = ['name', 'pinHash', 'pinSalt'];
const RATING_HEADER = [
  'Date', 'Title', 'Year', 'Director', 'RT Audience',
  'IMDb', 'Score /10', 'Raw /100', 'Grade',
  'Plot', 'Plot Grade', 'Plot Notes',
  'Entertainment', 'Ent Grade', 'Ent Notes',
  'Acting', 'Acting Grade', 'Acting Notes',
  'Visuals', 'Visuals Grade', 'Visuals Notes',
  'Pacing', 'Pacing Grade', 'Pacing Notes',
  'Emotional', 'Emotional Grade', 'Emotional Notes',
  'Overall Notes'
];

function doGet() {
  return json_({ ok: true, result: { service: 'cine-file-api' } });
}

function doPost(e) {
  try {
    const body = parseBody_(e);
    const action = String(body.action || '').trim();
    let result;

    switch (action) {
      case 'getDeploymentStatus':
        result = getDeploymentStatus(body.token || '');
        break;
      case 'getUsersPublic':
        result = getUsersPublic();
        break;
      case 'login':
        result = login(body.name, body.pin);
        break;
      case 'loginAdmin':
        result = loginAdmin(body.pin);
        break;
      case 'getSession':
        result = getSession(body.token);
        break;
      case 'addUser':
        result = addUser(body.token, body.name, body.pin);
        break;
      case 'deleteUser':
        result = deleteUser(body.token, body.name);
        break;
      case 'searchMovies':
        result = searchMovies(body.query);
        break;
      case 'getMovieDetails':
        result = getMovieDetails(body.id);
        break;
      case 'saveRating':
        result = saveRating(body.token, body.payload);
        break;
      case 'getRatings':
        result = getRatings(body.token, body.userName);
        break;
      case 'getSummary':
        result = getSummary(body.token);
        break;
      default:
        throw new Error('Unknown action.');
    }

    return json_({ ok: true, result: result });
  } catch (err) {
    return json_({ ok: false, error: err && err.message ? err.message : String(err) });
  }
}

function parseBody_(e) {
  if (!e || !e.postData || !e.postData.contents) return {};
  return JSON.parse(e.postData.contents);
}

function json_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function getDeploymentStatus(token) {
  if (token) requireSession_(token);
  const props = getProps_();
  return {
    hasSheetId: !!props.SHEET_ID,
    hasAdminPin: !!props.ADMIN_PIN,
    hasTmdbKey: !!props.TMDB_API_KEY,
    hasOmdbKey: !!props.OMDB_API_KEY
  };
}

function getUsersPublic() {
  return readUsers_().map(user => ({ name: user.name }));
}

function login(name, pin) {
  name = String(name || '').trim();
  pin = normalizePin_(pin);

  const user = findUser_(name);
  if (!user) throw new Error('Unknown user.');
  if (!verifyPin_(user, pin)) throw new Error('Incorrect PIN.');

  if (user.legacyPin) {
    upsertUser_(user.name, pin);
  }

  return createSession_({ name: user.name, role: 'user' });
}

function loginAdmin(pin) {
  const adminPin = getRequiredProp_('ADMIN_PIN');
  if (normalizePin_(pin) !== normalizePin_(adminPin)) {
    throw new Error('Incorrect admin PIN.');
  }
  return createSession_({ name: 'Admin', role: 'admin' });
}

function getSession(token) {
  return requireSession_(token);
}

function addUser(token, name, pin) {
  requireAdmin_(token);

  name = String(name || '').trim();
  pin = normalizePin_(pin);

  if (!name) throw new Error('Name is required.');
  if (!/^\d{4}$/.test(pin)) throw new Error('PIN must be exactly 4 digits.');
  validateSheetName_(name);
  if (normalizePin_(pin) === normalizePin_(getRequiredProp_('ADMIN_PIN'))) {
    throw new Error('That PIN is reserved. Choose another.');
  }
  if (findUser_(name)) throw new Error('A user with that name already exists.');

  upsertUser_(name, pin);
  return { ok: true };
}

function deleteUser(token, name) {
  requireAdmin_(token);

  name = String(name || '').trim();
  const users = readUsers_().filter(user => user.name.toLowerCase() !== name.toLowerCase());
  writeUsers_(users);
  return { ok: true };
}

function searchMovies(query) {
  const q = String(query || '').trim();
  if (!q) return [];

  const key = getRequiredProp_('TMDB_API_KEY');
  const url = 'https://api.themoviedb.org/3/search/movie'
    + '?api_key=' + encodeURIComponent(key)
    + '&query=' + encodeURIComponent(q)
    + '&include_adult=false';

  const data = fetchJson_(url);
  return (data.results || []).slice(0, 7).map(movie => ({
    id: movie.id,
    title: movie.title || '',
    release_date: movie.release_date || '',
    poster_path: movie.poster_path || ''
  }));
}

function getMovieDetails(id) {
  const movieId = String(id || '').replace(/\D/g, '');
  if (!movieId) throw new Error('Movie ID is required.');

  const key = getRequiredProp_('TMDB_API_KEY');
  const url = 'https://api.themoviedb.org/3/movie/' + encodeURIComponent(movieId)
    + '?api_key=' + encodeURIComponent(key)
    + '&append_to_response=credits';

  const d = fetchJson_(url);
  const director = ((d.credits && d.credits.crew) || []).find(person => person.job === 'Director');
  const year = String(d.release_date || '').slice(0, 4);
  const external = getExternalMovieScores_(d.title || '', year);

  return {
    id: d.id,
    title: d.title || '',
    year: year,
    director: director ? director.name : '',
    rt: external.rt,
    imdb: external.imdb,
    poster: d.poster_path || '',
    genres: (d.genres || []).map(genre => genre.name)
  };
}

function saveRating(token, payload) {
  const session = requireSession_(token);
  const userName = session.name;
  validateSheetName_(userName);

  const d = payload || {};
  const ss = openSpreadsheet_();
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const tab = ss.getSheetByName(userName) || ss.insertSheet(userName);
    ensureRatingHeader_(tab);

    const newRow = [
      clean_(d.date), clean_(d.title), clean_(d.year), clean_(d.director), clean_(d.rt),
      clean_(d.imdb), clean_(d.score10), clean_(d.score100), clean_(d.grade),
      clean_(d.plot), clean_(d.plotGrade), clean_(d.plotNotes),
      clean_(d.entertainment), clean_(d.entGrade), clean_(d.entNotes),
      clean_(d.acting), clean_(d.actingGrade), clean_(d.actingNotes),
      clean_(d.visuals), clean_(d.visualsGrade), clean_(d.visualsNotes),
      clean_(d.pacing), clean_(d.pacingGrade), clean_(d.pacingNotes),
      clean_(d.emotional), clean_(d.emotionalGrade), clean_(d.emotionalNotes),
      clean_(d.notes)
    ];

    const data = tab.getDataRange().getValues();
    let existingRow = -1;

    for (let i = 1; i < data.length; i++) {
      if (String(data[i][1]).toLowerCase() === String(d.title || '').toLowerCase()) {
        existingRow = i + 1;
        break;
      }
    }

    if (existingRow > -1) {
      tab.getRange(existingRow, 1, 1, newRow.length).setValues([newRow]);
    } else {
      tab.appendRow(newRow);
    }

    updateSummary_(ss, userName, d);
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

function getRatings(token, userName) {
  const session = requireSession_(token);
  const target = session.role === 'admin' && userName ? String(userName).trim() : session.name;
  validateSheetName_(target);

  const ss = openSpreadsheet_();
  const tab = ss.getSheetByName(target);
  if (!tab) return [];

  const values = tab.getDataRange().getValues();
  if (values.length < 2) return [];

  const keys = values[0];
  const out = [];

  for (let i = 1; i < values.length; i++) {
    const obj = {};
    keys.forEach((key, j) => {
      obj[key] = values[i][j] instanceof Date
        ? Utilities.formatDate(values[i][j], Session.getScriptTimeZone(), 'MMMM d, yyyy')
        : values[i][j];
    });
    out.push(obj);
  }

  return out;
}

function getSummary(token) {
  requireSession_(token);

  const ss = openSpreadsheet_();
  const sum = ss.getSheetByName('Summary');
  if (!sum || sum.getLastRow() === 0) return { rows: [] };

  const data = sum.getDataRange().getValues();
  const headers = data[0] || [];
  const rows = [];

  for (let i = 1; i < data.length; i++) {
    const row = { Title: data[i][0], Year: data[i][1], scores: [], userScores: {} };

    for (let j = 5; j < headers.length; j++) {
      if (headers[j] && data[i][j] !== '') {
        const score = parseFloat(data[i][j]);
        if (!isNaN(score)) {
          row.scores.push(score);
          row.userScores[headers[j]] = score;
        }
      }
    }

    rows.push(row);
  }

  return { rows };
}

function getExternalMovieScores_(title, year) {
  const key = getProps_().OMDB_API_KEY;
  if (!key || !title) return { rt: null, imdb: null };

  try {
    const url = 'https://www.omdbapi.com/'
      + '?apikey=' + encodeURIComponent(key)
      + '&t=' + encodeURIComponent(title)
      + '&y=' + encodeURIComponent(year)
      + '&tomatoes=true';
    const o = fetchJson_(url);
    const rtEntry = (o.Ratings || []).find(rating => rating.Source === 'Rotten Tomatoes');
    const rtCritics = rtEntry ? rtEntry.Value : null;
    const rtAudience = o.tomatoUserMeter ? o.tomatoUserMeter + '%' : (o.tomatoUserRating ? o.tomatoUserRating + '%' : null);
    const rt = rtAudience && rtAudience !== 'N/A%' ? rtAudience : (rtCritics && rtCritics !== 'N/A%' ? rtCritics + '*' : null);
    const imdb = o.imdbRating && o.imdbRating !== 'N/A' ? o.imdbRating : null;
    return { rt: rt && rt.indexOf('N/A') === -1 ? rt : null, imdb: imdb };
  } catch (e) {
    return { rt: null, imdb: null };
  }
}

function openSpreadsheet_() {
  return SpreadsheetApp.openById(getRequiredProp_('SHEET_ID'));
}

function getProps_() {
  return PropertiesService.getScriptProperties().getProperties();
}

function getRequiredProp_(name) {
  const value = getProps_()[name];
  if (!value) throw new Error('Missing Apps Script property: ' + name);
  return value;
}

function fetchJson_(url) {
  const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  const code = response.getResponseCode();
  if (code < 200 || code >= 300) throw new Error('External API request failed.');
  return JSON.parse(response.getContentText());
}

function normalizePin_(pin) {
  return String(pin || '').replace(/\D/g, '').padStart(4, '0').slice(-4);
}

function createSession_(user) {
  const token = Utilities.getUuid() + Utilities.getUuid();
  const record = JSON.stringify({
    user: user,
    expiresAt: Date.now() + SESSION_TTL_SECONDS * 1000
  });

  CacheService.getScriptCache().put('sess:' + token, record, SESSION_TTL_SECONDS);
  return { ok: true, token: token, user: user };
}

function getSessionRecord_(token) {
  if (!token) return null;
  const raw = CacheService.getScriptCache().get('sess:' + token);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.user) return null;
    if (Date.now() > parsed.expiresAt) return null;
    return parsed;
  } catch (e) {
    return null;
  }
}

function requireSession_(token) {
  const sess = getSessionRecord_(token);
  if (!sess) throw new Error('Session expired. Please log in again.');
  return sess.user;
}

function requireAdmin_(token) {
  const user = requireSession_(token);
  if (!user || user.role !== 'admin') throw new Error('Admin access required.');
  return user;
}

function readUsers_() {
  const ss = openSpreadsheet_();
  const sh = ss.getSheetByName('Users') || ss.insertSheet('Users');

  if (sh.getLastRow() === 0) {
    sh.appendRow(USERS_HEADER);
    return [];
  }

  const values = sh.getDataRange().getValues();
  const headers = values[0].map(header => String(header || '').trim());
  const users = [];

  for (let i = 1; i < values.length; i++) {
    if (!values[i][0]) continue;
    const row = values[i];
    const name = String(row[0]).trim();
    const pinHash = String(row[headers.indexOf('pinHash')] || '').trim();
    const pinSalt = String(row[headers.indexOf('pinSalt')] || '').trim();
    const legacyPin = !pinHash ? String(row[1] || '').replace(/^'/, '').trim() : '';

    users.push({ name: name, pinHash: pinHash, pinSalt: pinSalt, legacyPin: legacyPin });
  }

  return users;
}

function writeUsers_(users) {
  const ss = openSpreadsheet_();
  const sh = ss.getSheetByName('Users') || ss.insertSheet('Users');
  sh.clearContents();
  sh.getRange(1, 1, 1, USERS_HEADER.length).setValues([USERS_HEADER]);

  if (users.length) {
    const rows = users.map(user => {
      if (user.pinHash && user.pinSalt) return [user.name, user.pinHash, user.pinSalt];
      const hashed = hashPin_(normalizePin_(user.legacyPin || '0000'));
      return [user.name, hashed.hash, hashed.salt];
    });
    sh.getRange(2, 1, rows.length, USERS_HEADER.length).setValues(rows);
  }

  sh.getRange('B:C').setNumberFormat('@');
}

function findUser_(name) {
  return readUsers_().find(user => user.name.toLowerCase() === String(name).trim().toLowerCase()) || null;
}

function upsertUser_(name, pin) {
  const users = readUsers_().filter(user => user.name.toLowerCase() !== name.toLowerCase());
  const hashed = hashPin_(pin);
  users.push({ name: name, pinHash: hashed.hash, pinSalt: hashed.salt });
  writeUsers_(users);
}

function verifyPin_(user, pin) {
  if (user.pinHash && user.pinSalt) {
    return hashPinWithSalt_(pin, user.pinSalt) === user.pinHash;
  }
  return normalizePin_(user.legacyPin) === pin;
}

function hashPin_(pin) {
  const salt = Utilities.getUuid();
  return { salt: salt, hash: hashPinWithSalt_(pin, salt) };
}

function hashPinWithSalt_(pin, salt) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + ':' + pin);
  return bytes.map(byte => {
    const value = byte < 0 ? byte + 256 : byte;
    return ('0' + value.toString(16)).slice(-2);
  }).join('');
}

function validateSheetName_(name) {
  if (!name) throw new Error('Name is required.');
  if (String(name).length > 90) throw new Error('Name is too long.');
  if (/[\\\/\?\*\[\]:]/.test(String(name))) throw new Error('Name contains invalid sheet characters.');
}

function ensureRatingHeader_(tab) {
  if (tab.getLastRow() === 0) {
    tab.appendRow(RATING_HEADER);
  }
}

function ensureSummaryHeader_(sum) {
  if (sum.getLastRow() === 0) {
    sum.appendRow(['Title', 'Year', 'Director', 'RT Audience', 'IMDb']);
  }
}

function updateSummary_(ss, userName, d) {
  const sum = ss.getSheetByName('Summary') || ss.insertSheet('Summary');
  ensureSummaryHeader_(sum);

  const data = sum.getDataRange().getValues();
  let rowIdx = -1;

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).toLowerCase() === String(d.title || '').toLowerCase()) {
      rowIdx = i + 1;
      break;
    }
  }

  if (rowIdx === -1) {
    sum.appendRow([clean_(d.title), clean_(d.year), clean_(d.director), clean_(d.rt), clean_(d.imdb)]);
    rowIdx = sum.getLastRow();
  }

  const headers = sum.getRange(1, 1, 1, Math.max(sum.getLastColumn(), 5)).getValues()[0];
  let userCol = headers.indexOf(userName);

  if (userCol === -1) {
    userCol = headers.length;
    sum.getRange(1, userCol + 1).setValue(userName);
  }

  sum.getRange(rowIdx, userCol + 1).setValue(clean_(d.score10));
}

function clean_(value) {
  return String(value == null ? '' : value).slice(0, 2000);
}

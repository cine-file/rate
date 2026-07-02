const SHEET_ID = '1peWX84Zu0qpJSfSIOhIYToJ9LrRr0kRecGAeY0xfunA';
const ADMIN_PIN = '2028';
const SESSION_TTL_SECONDS = 6 * 60 * 60; // 6 hours

const USERS_HEADER = ['name', 'pin'];
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
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('Cine-file')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function getUsersPublic() {
  return readUsers_().map(u => ({ name: u.name }));
}

function login(name, pin) {
  name = String(name || '').trim();
  pin = normalizePin_(pin);

  const user = findUser_(name);
  if (!user) throw new Error('Unknown user.');

  if (normalizePin_(user.pin) !== pin) {
    throw new Error('Incorrect PIN.');
  }

  return createSession_({ name: user.name, role: 'user' });
}

function loginAdmin(pin) {
  if (normalizePin_(pin) !== normalizePin_(ADMIN_PIN)) {
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
  if (/[\\\/\?\*\[\]:]/.test(name)) throw new Error('Name contains invalid sheet characters.');
  if (findUser_(name)) throw new Error('A user with that name already exists.');

  const users = readUsers_();
  users.push({ name, pin });
  writeUsers_(users);

  return { ok: true };
}

function deleteUser(token, name) {
  requireAdmin_(token);

  name = String(name || '').trim();
  const users = readUsers_().filter(u => u.name.toLowerCase() !== name.toLowerCase());
  writeUsers_(users);

  return { ok: true };
}

function saveRating(token, payload) {
  const session = requireSession_(token);
  const userName = session.name;

  const d = payload || {};
  const ss = openSpreadsheet_();
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const tab = ss.getSheetByName(userName) || ss.insertSheet(userName);
    ensureRatingHeader_(tab);

    const newRow = [
      d.date || '',
      d.title || '',
      d.year || '',
      d.director || '',
      d.rt || '',
      d.imdb || '',
      d.score10 || '',
      d.score100 || '',
      d.grade || '',
      d.plot || '',
      d.plotGrade || '',
      d.plotNotes || '',
      d.entertainment || '',
      d.entGrade || '',
      d.entNotes || '',
      d.acting || '',
      d.actingGrade || '',
      d.actingNotes || '',
      d.visuals || '',
      d.visualsGrade || '',
      d.visualsNotes || '',
      d.pacing || '',
      d.pacingGrade || '',
      d.pacingNotes || '',
      d.emotional || '',
      d.emotionalGrade || '',
      d.emotionalNotes || '',
      d.notes || ''
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

  const ss = openSpreadsheet_();
  const tab = ss.getSheetByName(target);
  if (!tab) return [];

  const values = tab.getDataRange().getValues();
  if (values.length < 2) return [];

  const keys = values[0];
  const out = [];

  for (let i = 1; i < values.length; i++) {
    const obj = {};
    keys.forEach((k, j) => { obj[k] = values[i][j]; });
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
        const s = parseFloat(data[i][j]);
        if (!isNaN(s)) {
          row.scores.push(s);
          row.userScores[headers[j]] = s;
        }
      }
    }

    rows.push(row);
  }

  return { rows };
}

/* ---------- helpers ---------- */

function openSpreadsheet_() {
  return SpreadsheetApp.openById(SHEET_ID);
}

function normalizePin_(pin) {
  return String(pin || '').replace(/\D/g, '').padStart(4, '0').slice(-4);
}

function createSession_(user) {
  const token = Utilities.getUuid();
  const record = JSON.stringify({
    user,
    expiresAt: Date.now() + SESSION_TTL_SECONDS * 1000
  });

  CacheService.getScriptCache().put(`sess:${token}`, record, SESSION_TTL_SECONDS);
  return { ok: true, token, user };
}

function getSessionRecord_(token) {
  const raw = CacheService.getScriptCache().get(`sess:${token}`);
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
  if (!user || user.role !== 'admin') {
    throw new Error('Admin access required.');
  }
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
  const users = [];

  for (let i = 1; i < values.length; i++) {
    if (values[i][0]) {
      users.push({
        name: String(values[i][0]),
        pin: String(values[i][1] || '').replace(/^'/, '').trim()
      });
    }
  }

  return users;
}

function writeUsers_(users) {
  const ss = openSpreadsheet_();
  const sh = ss.getSheetByName('Users') || ss.insertSheet('Users');
  sh.clearContents();

  sh.getRange(1, 1, 1, USERS_HEADER.length).setValues([USERS_HEADER]);

  if (users.length) {
    const rows = users.map(u => [String(u.name), String(u.pin)]);
    sh.getRange(2, 1, rows.length, 2).setValues(rows);
  }

  sh.getRange('B:B').setNumberFormat('@');
}

function findUser_(name) {
  const users = readUsers_();
  return users.find(u => u.name.toLowerCase() === String(name).trim().toLowerCase()) || null;
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
  const headers = data[0];
  let rowIdx = -1;

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(d.title || '')) {
      rowIdx = i + 1;
      break;
    }
  }

  if (rowIdx === -1) {
    sum.appendRow([d.title || '', d.year || '', d.director || '', d.rt || '', d.imdb || '']);
    rowIdx = sum.getLastRow();
  }

  const freshData = sum.getDataRange().getValues();
  const freshHeaders = freshData[0];
  let userCol = freshHeaders.indexOf(userName);

  if (userCol === -1) {
    userCol = freshHeaders.length;
    sum.getRange(1, userCol + 1).setValue(userName);
  }

  sum.getRange(rowIdx, userCol + 1).setValue(d.score10 || '');
}

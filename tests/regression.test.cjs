const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const html = read('index.html');
const scripts = [...html.matchAll(/<script[^>]+src="(assets\/[^"]+)"/g)].map(match => match[1]);
const plain = value => JSON.parse(JSON.stringify(value));
const response = (data, code = 200) => ({getContentText: () => JSON.stringify(data), getResponseCode: () => code});

function backend(properties = {}) {
  const cache = new Map(), requests = [], queue = [];
  const context = vm.createContext({
    console,
    Session: {getScriptTimeZone: () => 'America/Chicago'},
    PropertiesService: {getScriptProperties: () => ({getProperty: key => properties[key] ?? null, getProperties: () => properties})},
    CacheService: {getScriptCache: () => ({get: key => cache.get(key) ?? null, put: (key, value) => cache.set(key, value), remove: key => cache.delete(key)})},
    Utilities: {
      DigestAlgorithm: {SHA_256: 'sha256'}, Charset: {UTF_8: 'utf8'}, getUuid: () => crypto.randomUUID(),
      computeDigest: (algorithm, value) => [...crypto.createHash(algorithm).update(value).digest()],
      base64EncodeWebSafe: bytes => Buffer.from(bytes).toString('base64url'),
      formatDate: date => date.toISOString().slice(0, 10)
    },
    UrlFetchApp: {fetch: (url, options) => {
      requests.push({url, options});
      assert.ok(queue.length, 'Unexpected provider request: ' + new URL(url).hostname);
      const next = queue.shift();
      if (next instanceof Error) throw next;
      return next;
    }},
    ContentService: {MimeType: {JSON: 'application/json'}, createTextOutput: content => ({getContent: () => content, setMimeType() {return this;}})}
  });
  vm.runInContext(read('Code.gs'), context, {filename: 'Code.gs'});
  return {context, cache, requests, queue, properties, run: code => vm.runInContext(code, context)};
}

function element(id = '') {
  const classes = new Set(), properties = {}, events = {};
  return {
    id, value: '', innerHTML: '', textContent: '', disabled: false, dataset: {}, events,
    style: {setProperty: (key, value) => {properties[key] = value;}, getPropertyValue: key => properties[key]},
    classList: {add: (...names) => names.forEach(name => classes.add(name)), remove: (...names) => names.forEach(name => classes.delete(name)), contains: name => classes.has(name), toggle(name, force) {const add = force ?? !classes.has(name); add ? classes.add(name) : classes.delete(name); return add;}},
    addEventListener: (name, fn) => {events[name] = fn;}, focus() {}, blur() {}, setAttribute() {},
    querySelectorAll: () => [], querySelector: () => null
  };
}

function frontend() {
  const elements = new Map([...html.matchAll(/\bid="([^"]+)"/g)].map(match => [match[1], element(match[1])]));
  const listeners = [], storage = new Map();
  const fields = Array.from({length: 3}, () => ['city', 'region', 'country'].map(field => {
    const input = element(); input.dataset.restaurantLocationField = field; return input;
  })).flat();
  const hosts = Array.from({length: 3}, () => element());
  const selectors = {
    '[data-restaurant-location-field]': fields,
    '[data-restaurant-location-controls]': hosts,
    '[data-restaurant-location-status]': [element(), element(), element()],
    '.screen': [...elements].filter(([id]) => id.startsWith('screen-')).map(([, node]) => node)
  };
  const document = {
    body: element(), getElementById: id => elements.get(id) || null,
    querySelectorAll: selector => selectors[selector] || [], querySelector: selector => (selectors[selector] || [element()])[0],
    createElement: () => element(), addEventListener: (name, fn) => listeners.push({name, fn})
  };
  const context = vm.createContext({document, console, navigator: {},
    localStorage: {getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key)},
    setTimeout: () => 1, clearTimeout() {}, requestAnimationFrame: fn => fn(),
    fetch: async () => {throw new Error('Unexpected network call in frontend unit test');}
  });
  context.window = context;
  context.scrollTo = () => {};
  for (const file of scripts) vm.runInContext(read(file), context, {filename: file});
  return {context, elements, fields, hosts, listeners, storage, run: code => vm.runInContext(code, context)};
}

test('all frontend scripts compile and load together in HTML order', () => {
  assert.equal(scripts.length, 11);
  new vm.Script(scripts.map(read).join('\n'));
  const app = frontend();
  for (const name of ['generateFilmRecommendations', 'generateGenericRecommendations', 'startCatalogRating', 'switchUser']) {
    assert.equal(app.run('typeof ' + name), 'function', name);
  }
});

test('HTML inline handlers parse and reference available global functions', () => {
  const app = frontend();
  for (const [, handler] of html.matchAll(/\bon(?:click|change|input|keydown)="([^"]*)"/g)) {
    new vm.Script('(function(event){' + handler + '})');
    const match = handler.match(/^([a-zA-Z_$][\w$]*)\(/);
    if (match) assert.equal(app.run('typeof ' + match[1]), 'function', match[1]);
  }
});

test('restaurant filter defaults to US without fabricating 0,0 coordinates', () => {
  const app = frontend();
  app.run('currentUser={name:"Michael"}; loadRestaurantSearchArea(); syncRestaurantLocationInputs();');
  const area = plain(app.run('restaurantSearchPayload("pizza")'));
  assert.equal(area.country, 'United States');
  assert.equal(area.lat, null); assert.equal(area.lng, null);
  assert.equal(app.fields.filter(input => input.dataset.restaurantLocationField === 'region').length, 3);
  for (const select of app.fields.filter(input => input.dataset.restaurantLocationField === 'region')) {
    assert.match(select.innerHTML, /value="IL">Illinois/);
    assert.equal(select.disabled, false);
  }
});

test('full state names normalize and non-US selection clears/disables every state control', () => {
  const app = frontend();
  app.run('updateRestaurantSearchArea("region","Illinois");');
  assert.equal(app.run('restaurantSearchArea.region'), 'IL');
  app.run('updateRestaurantSearchArea("country","Canada");');
  assert.equal(app.run('restaurantSearchPayload("cafe").region'), '');
  for (const select of app.fields.filter(input => input.dataset.restaurantLocationField === 'region')) {
    assert.equal(select.disabled, true); assert.match(select.innerHTML, /N\/A/);
  }
  app.run('updateRestaurantSearchArea("country","USA");');
  assert.equal(app.run('restaurantSearchArea.country'), 'United States');
  assert.equal(app.fields[1].disabled, false);
});

test('saved restaurant location is isolated per user, with safe coordinate handling', () => {
  const app = frontend();
  app.run('currentUser={name:"Michael"}; updateRestaurantSearchArea("city","Chicago"); currentUser={name:"Megan"}; loadRestaurantSearchArea();');
  assert.equal(app.run('restaurantSearchArea.city'), '');
  app.run('currentUser={name:"Michael"}; loadRestaurantSearchArea();');
  assert.equal(app.run('restaurantSearchArea.city'), 'Chicago');
  assert.equal(app.run('restaurantCoordinate(null,90)'), null);
  assert.equal(app.run('restaurantCoordinate(0,90)'), 0);
  assert.equal(app.run('restaurantCoordinate(91,90)'), null);
});

test('Places New request includes selected area but no fake location bias', () => {
  const app = backend({GOOGLE_PLACES_KEY: 'test-key'});
  app.queue.push(response({places: [{id: 'abc', displayName: {text: "O'Brien's"}, formattedAddress: 'Chicago, IL', addressComponents: [{types: ['locality'], longText: 'Chicago'}], rating: 4.5, priceLevel: 'PRICE_LEVEL_MODERATE'}]}));
  const result = JSON.parse(app.context.doSearchRestaurants_({query: "O'Brien's", city: 'Chicago', region: 'IL', lat: null, lng: null}).getContent());
  const request = app.requests[0], payload = JSON.parse(request.options.payload);
  assert.match(request.url, /places:searchText$/);
  assert.equal(payload.textQuery, "O'Brien's Chicago IL United States");
  assert.equal(payload.regionCode, 'US'); assert.equal(payload.locationBias, undefined);
  assert.equal(result.results[0].name, "O'Brien's");
  assert.equal(result.results[0].city, 'Chicago'); assert.equal(result.results[0].price, '$$');
  app.context.doSearchRestaurants_({query: "O'Brien's", city: 'Chicago', region: 'IL', lat: null, lng: null});
  assert.equal(app.requests.length, 1, 'repeated search uses cache');
});

test('Places valid geolocation works, non-US filters omit state', () => {
  const app = backend();
  const req = app.run('placesNewRequest_("Cafe",restaurantSearchArea_({country:"Canada",region:"IL",lat:0,lng:1}),"key")');
  const body = JSON.parse(req.payload);
  assert.equal(body.textQuery, 'Cafe Canada');
  assert.equal(body.locationBias.circle.center.latitude, 0);
  assert.equal(body.regionCode, undefined);
});

test('Places unavailable New API falls back to legacy and remembers capability', () => {
  const app = backend({GOOGLE_PLACES_KEY: 'test-key'});
  app.queue.push(response({error: 'disabled'}, 403), response({status: 'OK', results: [{place_id: 'legacy', name: 'Cafe'}]}));
  const result = JSON.parse(app.context.doSearchRestaurants_({query: 'Cafe'}).getContent());
  assert.equal(result.results[0].placeId, 'legacy');
  assert.match(app.requests[1].url, /textsearch\/json/);
  assert.doesNotMatch(app.requests[1].url, /location=0,0/);
  app.queue.push(response({status: 'ZERO_RESULTS', results: []}));
  app.context.doSearchRestaurants_({query: 'Another Cafe'});
  assert.match(app.requests[2].url, /textsearch\/json/);
});

test('Places quota and configuration errors are actionable, not empty success', () => {
  const quota = backend({GOOGLE_PLACES_KEY: 'test-key'});
  quota.queue.push(response({}, 429));
  assert.throws(() => quota.context.doSearchRestaurants_({query: 'Cafe'}), /quota/i);
  const config = backend({GOOGLE_PLACES_KEY: 'test-key', PLACES_API_MODE: 'legacy'});
  config.queue.push(response({status: 'REQUEST_DENIED', error_message: 'secret key'}));
  assert.throws(() => config.context.doSearchRestaurants_({query: 'Cafe'}), /billing/);
});

test('OMDb uses IMDb identity, returns critic RT and caches successful metadata', () => {
  const app = backend({OMDB_API_KEY: 'test-key'});
  app.queue.push(response({Response: 'True', imdbRating: '8.6', Ratings: [{Source: 'Rotten Tomatoes', Value: '83%'}], tomatoUserMeter: '95'}));
  const movie = {imdb_id: 'tt0114369', title: 'Se7en', release_date: '1995-09-22'};
  const ratings = app.context.movieExternalRatings_(movie);
  assert.equal(ratings.imdb, '8.6'); assert.equal(ratings.rt, '83%');
  const url = new URL(app.requests[0].url);
  assert.equal(url.searchParams.get('i'), 'tt0114369'); assert.equal(url.searchParams.has('t'), false);
  app.context.movieExternalRatings_(movie); assert.equal(app.requests.length, 1);
});

test('OMDb title/year fallback handles absent scores without inventing N/A%', () => {
  const app = backend({OMDB_API_KEY: 'test-key'});
  app.queue.push(response({Response: 'True', imdbRating: 'N/A', Ratings: [], tomatoUserMeter: '90'}));
  const ratings = app.context.movieExternalRatings_({title: 'A New Film', release_date: '2026-10-01'});
  assert.equal(ratings.imdb, null); assert.equal(ratings.rt, null);
  assert.match(ratings.externalRatingsMessage, /does not currently provide/);
  assert.equal(new URL(app.requests[0].url).searchParams.get('y'), '2026');
  assert.equal(new URL(app.requests[0].url).searchParams.get('t'), 'A New Film');
});

test('OMDb missing configuration and transient errors stay distinct; failures are retried', () => {
  assert.equal(backend().context.movieExternalRatings_({}).externalRatingsStatus, 'not_configured');
  const app = backend({OMDB_API_KEY: 'test-key'});
  app.queue.push(response({Response: 'False', Error: 'Request limit reached!'}), response({Response: 'True', imdbRating: '7.5', Ratings: []}));
  assert.equal(app.context.movieExternalRatings_({imdb_id: 'tt123'}).externalRatingsStatus, 'unavailable');
  assert.equal(app.context.movieExternalRatings_({imdb_id: 'tt123'}).imdb, '7.5');
  assert.equal(app.requests.length, 2);
});

test('lookup transport errors never return credential-bearing URLs', () => {
  const app = backend();
  app.queue.push(new Error('Request failed for https://example.test/?key=private-value'));
  assert.throws(() => app.context.fetchJson_('https://example.test/?key=private-value'), error => /could not be reached/.test(error.message) && !error.message.includes('private-value'));
});

test('new film details carry IMDb/RT through to the database payload', () => {
  const app = backend({OMDB_API_KEY: 'key', TMDB_API_KEY: 'key'});
  app.queue.push(response({id: 807, title: 'Se7en', release_date: '1995-09-22', imdb_id: 'tt0114369', credits: {crew: [{job: 'Director', name: 'David Fincher'}]}}), response({Response: 'True', imdbRating: '8.6', Ratings: [{Source: 'Rotten Tomatoes', Value: '83%'}]}));
  const details = JSON.parse(app.context.doGetMovieDetails_({id: 807}).getContent());
  const row = app.context.filmPayloadToSheetRow_({...details, score10: 8.3}, 'Michael', {});
  assert.equal(row.imdb, '8.6'); assert.equal(row.rtAudience, '83%'); assert.equal(row.score10, 8.3);
});

test('Steam returns native percentage and review label without converting to personal scale', () => {
  const app = backend();
  app.queue.push(response({'620': {success: true, data: {name: 'Portal 2', developers: ['Valve'], release_date: {date: 'Apr 18, 2011'}}}}), response({success: 1, query_summary: {total_reviews: 100, total_positive: 98, review_score_desc: 'Overwhelmingly Positive'}}));
  const game = JSON.parse(app.context.doGetGameDetails_({id: '620'}).getContent());
  assert.equal(game.externalScore, '98% positive'); assert.equal(game.externalSummary, 'Overwhelmingly Positive');
  assert.equal(game.externalCount, '100 reviews');
  const url = new URL(app.requests[1].url);
  assert.equal(url.searchParams.get('filter'), 'all'); assert.equal(url.searchParams.get('purchase_type'), 'steam');
});

test('Steam without reviews shows no external score and rejects malformed IDs', () => {
  const app = backend();
  app.queue.push(response({'123': {success: true, data: {name: 'New Game'}}}), response({success: 1, query_summary: {total_reviews: 0}}));
  assert.equal(JSON.parse(app.context.doGetGameDetails_({id: '123'}).getContent()).externalScore, '');
  assert.throws(() => app.context.doGetGameDetails_({id: 'abc123'}), /Steam game ID/);
});

test('Books requires private key, supports author/ISBN queries, and caches searches', () => {
  assert.throws(() => backend().context.doSearchBooks_({query: 'Hobbit'}), /GOOGLE_BOOKS_API_KEY/);
  const app = backend({GOOGLE_BOOKS_API_KEY: 'test-key'});
  app.queue.push(response({items: [{id: 'book', volumeInfo: {title: 'The Hobbit', authors: ['J. R. R. Tolkien'], publishedDate: '1937', imageLinks: {thumbnail: 'http://example.test/book.jpg'}}}]}));
  const result = JSON.parse(app.context.doSearchBooks_({query: 'isbn:9780547928227'}).getContent());
  const url = new URL(app.requests[0].url);
  assert.equal(url.searchParams.get('q'), 'isbn:9780547928227'); assert.equal(url.searchParams.get('key'), 'test-key');
  assert.equal(result.results[0].posterUrl, 'https://example.test/book.jpg');
  app.context.doSearchBooks_({query: 'isbn:9780547928227'}); assert.equal(app.requests.length, 1);
});

test('Books missing community rating is blank, not a fabricated zero', () => {
  const app = backend({GOOGLE_BOOKS_API_KEY: 'test-key'});
  app.queue.push(response({id: 'book', volumeInfo: {title: 'Book'}}));
  const book = JSON.parse(app.context.doGetBookDetails_({id: 'book'}).getContent());
  assert.equal(book.externalScore, ''); assert.equal(book.externalCount, '');
});

test('valid zero scores and category scores survive re-ratings', () => {
  const app = backend();
  for (const fn of ['filmPayloadToSheetRow_', 'tvPayloadToSheetRow_', 'restaurantPayloadToSheetRow_']) {
    const row = app.context[fn]({score10: 0, score100: 0, plot: 0, food: 0}, 'Michael', {score10: 8, raw100: 80});
    assert.equal(row.score10, 0, fn); assert.equal(row.raw100, 0, fn);
    assert.equal(row.plot ?? row.food, 0, fn);
  }
});

test('Games enforces 1-10, tenths, and matching grades on the backend', () => {
  const app = backend();
  app.context.withScriptLock_ = () => 'validated';
  assert.throws(() => app.context.doSaveCatalogRating_({score10: 0.9}, 'Michael', 'game'), /between 1 and 10/);
  const payload = {score10: 9.56, grade: 'F'};
  app.context.doSaveCatalogRating_(payload, 'Michael', 'game');
  assert.equal(payload.score10, 9.6); assert.equal(payload.grade, 'A+');
  assert.equal(app.context.doSaveCatalogRating_({score10: 0}, 'Michael', 'book'), 'validated');
});

test('frontend and backend grade scales agree at every tenth', () => {
  const front = frontend(), back = backend();
  for (let tenth = 0; tenth <= 100; tenth++) assert.equal(front.context.grade(tenth / 10), back.context.gradeForScore10_(tenth / 10));
  assert.equal(front.context.grade(6.5), 'C+'); assert.equal(front.context.grade(9.9), 'A+'); assert.equal(front.context.grade(10), 'S');
});

test('restaurant identity protects separate branches and supports ID-less legacy rows', () => {
  const app = backend(), target = {user: 'Michael', placeId: 'manual_1', name: 'Cafe', city: 'Chicago', address: ''};
  const header = ['user', 'placeId', 'name', 'city', 'address'];
  const rows = [target, {...target, placeId: 'manual_2', city: 'Denver'}, {...target, user: 'Megan'}, {...target, placeId: ''}];
  const tab = {getDataRange: () => ({getValues: () => [header, ...rows.map(row => header.map(key => row[key]))]})};
  assert.deepEqual(plain(app.context.categoryRowsForPayload_(tab, header, target, 'placeId', 'name', 'address')), [2, 5]);
  assert.equal(app.context.restaurantMatches_(target, {...target, placeId: 'other'}), false);
  assert.deepEqual(plain(app.context.categoryRowsForPayload_(tab, header, {user: 'Michael'}, 'placeId', 'name', 'address')), []);
});

test('every Wishlist write route is authenticated and uses the same script lock', () => {
  const app = backend(); let locked = false;
  app.context.validateSession_ = () => ({username: 'Michael'});
  app.context.withScriptLock_ = fn => {locked = true; try {return fn();} finally {locked = false;}};
  const routes = {addFutureFilm: 'doAddFutureFilm_', deleteFutureFilm: 'doDeleteFutureFilm_', addFutureTv: 'doAddFutureTv_', deleteFutureTv: 'doDeleteFutureTv_', addFutureRestaurant: 'doAddFutureRestaurant_', deleteFutureRestaurant: 'doDeleteFutureRestaurant_', addFutureGame: 'doAddFutureCatalog_', deleteFutureGame: 'doDeleteFutureCatalog_', addFutureBook: 'doAddFutureCatalog_', deleteFutureBook: 'doDeleteFutureCatalog_'};
  for (const [action, fn] of Object.entries(routes)) {
    app.context[fn] = () => {assert.equal(locked, true, action); return 'ok';};
    assert.equal(app.context.doPost({postData: {contents: JSON.stringify({action, token: 'test'})}}), 'ok');
  }
  app.context.validateSession_ = () => null;
  assert.match(app.context.doPost({postData: {contents: JSON.stringify({action: 'addFutureFilm'})}}).getContent(), /Invalid or expired/);
});

test('successful rating/wishlist writes invalidate cached wishlist data', async () => {
  const app = frontend();
  app.context.fetch = async () => ({text: async () => '{"ok":true}'});
  app.run('wishlistCache.set("old",[]);');
  await app.context.apiCall('addFutureGame'); assert.equal(app.run('wishlistCache.size'), 0);
});

test('late API responses from another signed-in user are rejected', async () => {
  const app = frontend();
  app.run('sessionToken="new-user";');
  app.context.fetch = async () => ({text: async () => '[]'});
  await assert.rejects(app.context.apiCall('getRatings', {token: 'old-user'}), /signed-in user changed/);
});

test('switching user clears ratings, pending selections and all recommendation caches', () => {
  const app = frontend();
  app.run('currentUser={name:"Michael"}; sessionToken="token"; _ratingsCache=[1]; _lgRatingsCache=[1]; catalogRatingsCache.game=[1]; recommendationSources=[1]; recommendationResults=[1]; genericRecommendationState.tv.results=[1]; genericRecommendationState.restaurant.sources=[1]; wishlistCache.set("test",[]); switchUser();');
  assert.equal(app.run('_ratingsCache'), null); assert.equal(app.run('_lgRatingsCache'), null);
  assert.equal(app.run('catalogRatingsCache.game'), null); assert.equal(app.run('recommendationSources.length'), 0);
  assert.equal(app.run('genericRecommendationState.tv.results.length'), 0); assert.equal(app.run('wishlistCache.size'), 0);
  assert.equal(app.run('currentUser'), null);
});

test('recommendation action markup remains executable for TV and restaurant names with quotes', () => {
  const app = frontend();
  for (const kind of ['tv', 'restaurant']) {
    app.run('genericRecommendationState.' + kind + '.results=[{name:"O\'Brien\'s",title:"Someone\'s Show",ratedScore:"",genres:[]}]; renderGenericRecommendations("' + kind + '");');
    const markup = app.elements.get(kind + '-rec-results').innerHTML;
    const handlers = [...markup.matchAll(/onclick="([^"]+)"/g)];
    assert.equal(handlers.length, 3);
    for (const [, handler] of handlers) new vm.Script('(function(){' + handler + '})');
    assert.match(markup, /data-kind="(tv|restaurant)"/);
  }
});

test('all referenced theme variables have definitions', () => {
  const css = read('assets/styles.css');
  const definitions = new Set([...css.matchAll(/(--[\w-]+)\s*:/g)].map(match => match[1]));
  for (const [, variable] of css.matchAll(/var\((--(?:theme|lg)-[\w-]+)/g)) assert.ok(definitions.has(variable), variable);
});

test('scorecard renders Steam label and legitimate zero category scores', () => {
  const app = frontend();
  app.context.pushToSheets = () => {}; app.context.loadRankReveal = () => {};
  app.run('activeCategory="game"; currentMovie={title:"Portal 2",genres:[],externalScore:"98% positive",externalLabel:"Steam",externalSummary:"Overwhelmingly Positive",externalCount:"100 reviews"}; CATS=GAME_CATS; quickMode=false; scores={gameplay:0}; chosenScore10=1; generateCard();');
  assert.match(app.elements.get('score-boxes').innerHTML, /Overwhelmingly Positive/);
  assert.match(app.elements.get('card-table-body').innerHTML, /ct-score">0<\/td>/);
  assert.match(app.elements.get('card-table-body').innerHTML, /ct-grade">F<\/td>/);
});

test('a late film search cannot overwrite the shared Games search results', async () => {
  const app = frontend(); let resolve;
  app.context.apiCall = () => new Promise(done => {resolve = done;});
  app.run('activeCategory="film";');
  const pending = app.context.doSearch('Seven');
  app.run('activeCategory="game"; document.getElementById("dropdown").innerHTML="game results";');
  resolve({results: [{id: 807, title: 'Se7en'}]}); await pending;
  assert.equal(app.elements.get('dropdown').innerHTML, 'game results');
});

test('re-rate checks distinguish same-name films and derive the current grade', async () => {
  const app = frontend(); let loaded;
  app.context.loadMovie = movie => {loaded = movie;};
  app.run('activeCategory="film"; currentUser={name:"Michael"}; sessionToken="session"; _ratingsCache=[{Title:"The Thing",Year:"1982","TMDB ID":1091,"Score /10":6.5,Grade:"F"}]; _ratingsCacheTime=Date.now();');
  await app.context.checkAlreadyRated({id: 60935, title: 'The Thing', year: '2011'});
  assert.equal(loaded.id, 60935);
  await app.context.checkAlreadyRated({id: 1091, title: 'The Thing', year: '1982'});
  assert.equal(app.elements.get('ar-grade').textContent, 'C+');
});

test('a late location callback cannot overwrite a manually edited area', () => {
  const app = frontend(); let callback;
  app.context.navigator.geolocation = {getCurrentPosition: fn => {callback = fn;}};
  app.context.requestRestaurantLocation();
  app.context.updateRestaurantSearchArea('city', 'Chicago');
  callback({coords: {latitude: 20, longitude: 30}});
  assert.equal(app.run('restaurantSearchArea.city'), 'Chicago');
  assert.equal(app.run('restaurantSearchArea.lat'), null);
});

function mockSheets(app) {
  const sheets = new Map();
  app.context.withScriptLock_ = fn => fn();
  app.context.getExistingSheet_ = name => sheets.get(name) || null;
  app.context.getOrCreateSheet_ = (name, header) => {
    if (sheets.has(name)) return sheets.get(name);
    const values = [Array.from(header)];
    const sheet = {
      values, getDataRange: () => ({getValues: () => values}), getLastRow: () => values.length,
      getLastColumn: () => values[0].length, appendRow: row => values.push(Array.from(row)),
      deleteRow: row => values.splice(row - 1, 1),
      getRange: (row, col, count = 1, width = 1) => ({
        getValues: () => values.slice(row - 1, row - 1 + count).map(value => value.slice(col - 1, col - 1 + width)),
        setValues: input => input.forEach((value, index) => {values[row - 1 + index] = Array.from(value);})
      })
    };
    sheets.set(name, sheet); return sheet;
  };
  for (const fn of ['rebuildFilmSummary_', 'rebuildTvSummary_', 'rebuildRestaurantSummary_', 'rebuildCatalogSummary_', 'upsertRecentActivity_']) app.context[fn] = () => {};
  return sheets;
}

for (const [category, suffix, payload, add, save] of [
  ['film', 'Films', {tmdbId: 807, title: 'Se7en', year: '1995'}, 'doAddFutureFilm_', 'doSaveRating_'],
  ['tv', 'TV', {tmdbTvId: 1, seriesTitle: 'A Series', seriesYear: '2020', entryType: 'season', seasonNumber: 1}, 'doAddFutureTv_', 'doSaveTvRating_'],
  ['restaurant', 'Restaurants', {placeId: 'abc', name: "O'Brien's", address: '123 Main St', city: 'Chicago'}, 'doAddFutureRestaurant_', 'doSaveRestaurantRating_'],
  ['game', 'Games', {sourceId: '620', title: 'Portal 2', year: '2011'}, 'doAddFutureCatalog_', 'doSaveCatalogRating_'],
  ['book', 'Books', {sourceId: 'hobbit', title: 'The Hobbit', year: '1937'}, 'doAddFutureCatalog_', 'doSaveCatalogRating_']
]) {
  test(category + ' saves upsert the same row and remove the owner wishlist entry', () => {
    const app = backend(), sheets = mockSheets(app);
    app.context[add](payload, 'Michael', category);
    app.context[add](payload, 'Michael', category);
    app.context[add](payload, 'Megan', category);
    assert.equal(sheets.get('Future-' + suffix).values.length, 3, 'one row per user');
    app.context[save]({...payload, score10: 7.2, score100: 72}, 'Michael', category);
    app.context[save]({...payload, score10: 8.6, score100: 86}, 'Michael', category);
    const database = sheets.get('Database-' + suffix).values;
    assert.equal(database.length, 2, 're-rating updates instead of appending');
    assert.equal(database[1][database[0].indexOf('score10')], 8.6);
    const future = sheets.get('Future-' + suffix).values;
    assert.equal(future.length, 2); assert.equal(future[1][0], 'Megan');
    assert.equal(sheets.has('Films'), false); assert.equal(sheets.has('Restaurants'), false);
  });
}

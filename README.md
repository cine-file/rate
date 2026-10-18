# Cine-file Ratings Dashboard

**Build:** `2026.10.18-search-and-theme.18`

Cine-file is a private, small-group ratings dashboard. GitHub Pages serves the static frontend and Google Apps Script is the JSON backend for Google Sheets, third-party lookups, authentication, and recommendation generation.

## Files

- `index.html` - GitHub Pages entry point and application markup. It loads the CSS and scripts below.
- `assets/styles.css` - all application styling and theme overrides.
- `assets/js/config.js` - public Apps Script deployment URL only.
- `assets/js/core.js` - shared state, API calls, authentication, themes, settings, and user selection.
- `assets/js/films.js` - Film rating flow and shared stats helpers.
- `assets/js/tv.js` - TV search, season/overall ratings, and TV stats.
- `assets/js/restaurants.js` - Le Guide search, rating flow, restaurant stats, deletion, and navigation support.
- `assets/js/catalog.js` - shared Games and Books search, rating, Wishlist, and stats behavior.
- `assets/js/restaurant-location.js` - per-user Restaurant city/state/country filter and voluntary browser-location handling.
- `assets/js/wishlist.js`, `recommendations.js`, and `activity.js` - focused Wishlist, recommendations, and Recent Activity features.
- `assets/js/shell.js` - final navigation and startup wiring. It loads last so the existing inline controls remain globally available.
- `Code.gs` - Apps Script backend. This is the file to paste into the Apps Script editor.
- `tests/regression.test.cjs` - dependency-free Node regression tests; not loaded by the website.

The public GitHub repository may contain the Apps Script source. It must never contain API keys, the Sheet ID, or PIN values.

## User Flow

1. The site opens on the user selector. Users are sorted alphabetically in two columns.
2. A user enters their PIN and then lands on the category screen.
3. The category screen shows Film, TV, Le Guide (Restaurants), Games, and Books, plus shared Recent Activity.
4. Authenticated requests use a six-hour Apps Script session token. Refreshing or using Switch User requires logging in again.

Recent Activity is shared with every authenticated user, but it is not readable before login.

## Apps Script Properties

In Apps Script, open **Project Settings** then add these Script Properties:

| Property | Required | Purpose |
| --- | --- | --- |
| `SHEET_ID` | Yes | ID of the private Google Sheet. |
| `ADMIN_PIN` | Yes | Four-digit PIN used for Settings. |
| `TMDB_API_KEY` | Yes | Film and TV search/details. |
| `GOOGLE_PLACES_KEY` | Yes | Restaurant search/details and location lookup. |
| `GOOGLE_BOOKS_API_KEY` | For Books | Google Books search/details with your project's quota. |
| `OMDB_API_KEY` | No | IMDb and Rotten Tomatoes metadata. |
| `GEMINI_API_KEY` | For AI recommendations | Film recommendations have a deterministic fallback. TV and Restaurant recommendations require Gemini. |
| `PLACES_API_MODE` | No | Default `auto`: try Places API (New), then legacy if the new endpoint is unavailable to the project. Set `legacy` only to force an existing legacy setup. |

Do not put any of these values in the public frontend, GitHub Secrets, or the Google Sheet.

For the optional **Use my location** button to populate city, state/region, and country, enable the Google Maps **Geocoding API** for the same Google Cloud project as `GOOGLE_PLACES_KEY`. Restaurant search still works with manually entered fields if that API is unavailable or a user declines location permission.

For restaurant search, enable **Places API (New)** in the Google Cloud project, confirm billing is enabled, and permit it in the key's API restrictions. Existing legacy Places projects remain supported. These are server-side Apps Script calls: browser-only HTTP-referrer key restrictions will not work here. Keep API restrictions and appropriate quotas in place; never publish the key. Search uses Google's [Text Search API](https://developers.google.com/maps/documentation/places/web-service/text-search).

For Books, enable **Books API**, create a key restricted to that API, and put its value in the `GOOGLE_BOOKS_API_KEY` Script Property. No frontend key or OAuth login is needed. An unauthenticated public lookup hit a shared-quota error during this audit; the private key gives the application its own project quota. See [Google Books setup](https://developers.google.com/books/docs/v1/using#APIKey).

## Sheet Tabs

`setupActiveSheetTabs()` creates/formats the active backend tabs and rebuilds summary/activity data. It does not delete old tabs.

Core rating tabs:

- `Users`
- `Database-Films`, `Summary-Films`, `Future-Films`
- `Database-TV`, `Summary-TV`, `Future-TV`
- `Database-Games`, `Summary-Games`, `Future-Games`
- `Database-Books`, `Summary-Books`, `Future-Books`
- `Database-Restaurants`, `Summary-Restaurants`, `Future-Restaurants`
- `Recent-Activity`

Recommendation history tabs:

- `Recommendations-Films`, `Recommendation-Feedback`
- `Recommendations-TV`, `Recommendation-Feedback-TV`
- `Recommendations-Restaurants`, `Recommendation-Feedback-Restaurants`

Database tabs contain one row per user rating. Summary tabs contain one row per item and one score column per user. Re-rating an item updates that user’s database record and the corresponding summary cell instead of adding a duplicate.

TV has two views: Seasons and Overall Shows. A person's manual overall rating is used when present. Until then, that person’s average across rated seasons is shown as a derived overall score, while the original season ratings remain in the Seasons view.

Games use the Steam catalog: titles not listed on Steam are not discoverable through this search. Their external score is Steam's native positive-review percentage, with its review label/count when available; missing reviews stay blank. Personal game ratings are 1.0-10.0 in tenths, independent of Steam's percentage. Books use Google Books metadata and its available community rating out of 5; missing ratings stay blank. Book, Film, TV and Restaurant personal ratings remain 0.0-10.0 in tenths. Steam requires no new key. See [Steam reviews](https://partner.steamgames.com/doc/store/getreviews) and [Google Books volumes](https://developers.google.com/books/docs/v1/reference/volumes).

Restaurants can be entered manually from Rate or Wishlist. A manual entry requires a name plus a street address or city; the default country alone is not enough. Apps Script creates a stable `manual_` place identifier, so re-ratings update the original row and remove matching wishlist entries. Distinct known place IDs are never merged just because their names match. A manually entered restaurant and a later Google Places match retain different IDs; there is no automatic fuzzy merge that could combine separate branches.

`Megan` remains the canonical user name in `Users` and every database record. `Megs` is the display label in the UI and summary-table columns; this preserves joins to existing ratings.

## Deployment

1. Replace `Code.gs` in the Apps Script project.
2. Confirm the Script Properties above still exist.
3. Deploy a **new Web App version** using the existing deployment. The app must execute as the script owner and be reachable by the GitHub Pages frontend.
4. Replace `index.html` and the complete `assets/` folder in the GitHub Pages repository root. Update `README.md` and `Code.gs` there for version control; optionally include `tests/`. There is no new `appsscript.json` file to upload or paste.
5. Confirm `CONFIG.GAS_URL` in `assets/js/config.js` points to the active `/exec` deployment URL. It is normal for the URL to be public; access control lives in Apps Script sessions and Script Properties.

This update changes the backend, so pasting `Code.gs` without deploying a new Apps Script version is not sufficient. The script owner should update the existing deployment; keep the same `/exec` URL if possible. The frontend URL remains GitHub Pages.

You do **not** need to run `setupActiveSheetTabs()` again if all active tabs already exist. Run it if Games/Books tabs are missing, a summary needs rebuilding, or Recent Activity needs backfilling. This release does not migrate, delete, rename, or reset existing user data. `Summary-Films` labels its external RT column `RT Score` on its next rebuild.

Optional verification: select `checkExternalLookupServices` in the Apps Script editor's function dropdown and click **Run**. Inspect the execution log for Film/IMDb/RT, Restaurant, Steam, and Books availability. It makes a few provider API calls (using normal quota) but does not edit Sheets or print keys. It is an editor-only function, not a public web endpoint. A film check can succeed while reporting that external scores are unavailable.

After deployment, hard-refresh the site. Check Restaurant Rate/Wishlist in each theme, a film with known IMDb/RT scores, a Steam game, and a book. Rate a wishlist item and confirm it disappears for its owner. Check both a fresh rating and a re-rating, then My/Group/Individual stats. No data was written to your live Sheet during local testing.

Restaurant search areas are saved locally per signed-in user and are only sent with Restaurant Rate, Wishlist, or Recommendation searches. Repeated Restaurant searches are cached briefly, and autocomplete results intentionally omit downloaded photo data to keep lookups responsive.

The initial country is United States. US states are selected by full name; the request sends their two-letter codes. For other countries the state control displays N/A and is not sent. A previously chosen country is remembered. City/state/country are search context, not strict geographic boundaries, so check the returned address before choosing a result. A failed location permission request never sends artificial `0,0` coordinates, and a late GPS response cannot overwrite manual edits.

## IMDb and Rotten Tomatoes

Film metadata first comes from TMDB. Its IMDb ID is then used for the [OMDb lookup](https://www.omdbapi.com/); title/year are a fallback only when TMDB has no IMDb ID. This prevents many same-title mismatches. OMDb availability, provider coverage, and your key's quota determine which scores can be shown. It cannot guarantee both scores for every film, especially new releases.

New RT values use OMDb's Rotten Tomatoes critic entry, not its old audience field. The existing database/API field `rtAudience` / `RT Audience` is retained for backward compatibility; historical rows are not relabeled as critic scores or rewritten. Visible historical labels use the neutral `RT Score`. A new card explicitly labels its RT critic score. Missing metadata, absent configuration, and temporary failures have different messages; none prevents saving the user's own rating. Successful lookups are cached for six hours, while request failures are not cached. There is no automatic backfill of old ratings when a provider later adds a score.

## October Audit

This build starts from GitHub `origin/main` commit `ad6393a` and keeps GitHub Pages, the existing sheet schemas, user identities, TV season/overall behavior, and three themes.

Fixed findings:

- **Script loading:** `recommendations.js` in that snapshot was a duplicate of `films.js`, including conflicting top-level declarations. Restored the dedicated recommendation module, repaired its TV/Restaurant button quoting, and tested every script together in HTML order.
- **Search correctness:** removed accidental `0,0` location bias, added US state choices and visible quota/configuration errors, and used Places New with a legacy fallback for both restaurant search and recommendation validation. Later queries/category changes invalidate stale autocomplete results.
- **Metadata and latency:** corrected Steam review parameters, added catalog search/detail caching, and used stable IMDb identity with cached OMDb results. Restaurant searches cache for two minutes; Steam/Books searches for five minutes and details for one hour. Recommendation validation still runs in batches. Apps Script startup, network calls, and Gemini generation can still take time; no unsupported speed guarantee is made.
- **Rating integrity:** kept zero scores/category scores during saves; enforced the 1-10 game scale server-side; protected restaurant branch identity; synchronized Wishlist writes with rating-save locks; and cleared wishlist/recommendation caches on user changes. Re-rate dialogs use the current grade scale and match film ID/year instead of title alone.
- **Themes:** replaced hardcoded restaurant markup colors, fixed missing Le Guide theme variables and filled-grade colors, made scorecard stars theme-aware, and consolidated conflicting light/gold overrides onto shared tokens. Light mode uses darker aqua text for contrast. Removed redundant temporary star markup and unused catalog helpers.

Remaining maintenance work: several older generated views still contain inline presentation styles, and the large stylesheet retains historical overrides. Consolidating those into reusable view classes would be useful but should be done with browser screenshot coverage. Database reads and summary rebuilds still scan whole category sheets; that is reasonable for the current small group but should be revisited if data volume becomes large. This is a focused functional audit, not a penetration test or a claim that every unused CSS selector has been removed.

## Tests

Run from this folder with Node.js 18 or later; there are no npm dependencies:

```sh
node --test tests/regression.test.cjs
```

All 37 tests pass. They use mocked Apps Script services and lightweight DOM fixtures, covering cross-file loading, inline actions, filters, provider requests/errors/caches, grades, session changes, place matching, and re-rating/wishlist removal across all five categories. Summary rebuilding is stubbed in the save tests; these are not real Google Sheets integration tests. Public Steam search/review endpoints were also checked read-only. Browser visual verification was not performed because permission to launch the test browser was declined. Your private Places/OMDb keys and live deployed backend were not available for verification.

## Security Notes

- User PINs are stored as salted SHA-256 hashes in `Users` (`name`, `pinHash`, `pinSalt`). Older plain-PIN rows are migrated after a successful login.
- Login and admin-PIN attempts are throttled after repeated failures.
- Rating saves/deletes and Wishlist writes use a script lock so concurrent actions cannot race a summary rebuild or re-add a just-rated wishlist item.
- Admin-only deployment status checks and user management require an admin session.
- Deleting a rating also removes it from Recent Activity.

Four-digit PINs are deliberately lightweight for this trusted group. They are not suitable as the sole authentication mechanism for a public service.

## Maintenance

When making a feature change, update the relevant `assets/` file, `Code.gs` when backend behavior changes, and this README in the same commit. Keep the build value at the top of this README aligned with `BACKEND_VERSION` in `Code.gs`.

GitHub Pages still serves `index.html` first. Its relative `assets/...` references load the CSS and JavaScript files directly; no build step, server change, or package installation is required.

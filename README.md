# Cine-file Secure Film + Restaurant Version

This folder merges the latest restaurant UI work with the secure GitHub Pages + Apps Script backend approach.

## Project Overview

Cine-file is a small private ratings dashboard for a group of friends. GitHub Pages serves the public frontend at the normal site URL, while Google Apps Script acts as the private backend that reads/writes a Google Sheet.

The app currently has two rating areas:

- **Cine-file / Film** - movie search, full category rating, quick rating, generated rating card, already-rated detection, personal stats, group stats, and head-to-head stats.
- **Le Guide / Restaurant** - restaurant search, full category rating, quick rating, generated restaurant card, already-rated detection, personal restaurant stats, and group restaurant stats.

The dashboard is intentionally still a single-page app. Screens are shown/hidden with CSS classes rather than separate routes. The main user flow is:

1. User opens the GitHub Pages site.
2. User chooses Film or Restaurant.
3. User logs in with name + PIN.
4. Frontend receives a temporary session token from Apps Script.
5. Search/rating/stats actions call Apps Script with that token.
6. Apps Script validates the token and writes/reads the private Google Sheet.

Each user can change the site theme from the normal navigation bar without admin access. The theme choice is stored locally in the browser, not in Google Sheets.

The default theme for a browser that has not selected one is **Gold**. The available themes are Gold, Light, and Classic.

## Files

- `index.html` - GitHub Pages frontend.
- `Code.gs` - Apps Script backend.
- `appsscript.json` - optional Apps Script manifest for tooling such as `clasp`.

If you are manually copying code into the Apps Script editor, you only need to paste `Code.gs`. You do **not** need to do anything with `appsscript.json` unless you are managing the Apps Script project with a local sync tool.

## Required Apps Script Properties

Set these exact names in Apps Script Project Settings:

- `SHEET_ID`
- `ADMIN_PIN`
- `TMDB_API_KEY`
- `GOOGLE_PLACES_KEY`

Optional:

- `OMDB_API_KEY`

## Data Model

The backend now uses database tabs plus visual summary tabs:

- `Users` stores user names and PIN hashes: `name`, `pinHash`, `pinSalt`.
- `Database-Films` stores one row per film rating, with a `user` column plus film metadata, score fields, category scores, notes, `tmdbId`, `posterPath`, timestamps, genres, and runtime.
- `Summary-Films` stores one row per film for spreadsheet-friendly comparison: title, year, genre, director, movie length, RT Audience score, IMDb score, user score columns, and average rating.
- `Database-Restaurants` stores one row per restaurant rating, with a `user` column plus restaurant metadata, score fields, category scores, notes, `placeId`, and timestamps.
- `Summary-Restaurants` stores one row per restaurant for group comparison.

Legacy `Users` rows with plain PINs are supported for login and can be migrated to hashes by the backend after a successful login.

## Sheet Setup

The active website backend uses only these sheet tabs:

- `Database-Films`
- `Summary-Films`
- `Database-Restaurants`
- `Summary-Restaurants`
- `Users`

Paste and deploy `Code.gs`, then run `setupActiveSheetTabs` from the Apps Script editor. This formats the active tabs and rebuilds `Summary-Films` and `Summary-Restaurants` from the database tabs.

New film saves write to `Database-Films` and rebuild `Summary-Films`; new restaurant saves write to `Database-Restaurants` and rebuild `Summary-Restaurants`. The website still receives the same response shape it used before, so the UI and stats should behave the same.

The backend upserts ratings instead of appending duplicates:

- Rating the same film again updates that user's `Database-Films` row and replaces that user's score in the existing `Summary-Films` row.
- Rating the same restaurant again updates that user's `Database-Restaurants` row and replaces that user's score in the existing `Summary-Restaurants` row.

## Scoring and Grades

Final ratings use a 0.0–10.0 scale with one decimal place.

- Quick rating sliders allow every tenth from `0.0` through `10.0`.
- Full ratings accept category scores out of 100, calculate the weighted result, then derive one final deterministic score out of 10. There is no manual half-point rounding decision.
- Stored final scores and summary averages are displayed to one decimal place.

Grade bands are:

| Score | Grade |
| --- | --- |
| 10.0 | S |
| 9.5–9.9 | A+ |
| 9.0–9.4 | A |
| 8.5–8.9 | A- |
| 8.0–8.4 | B+ |
| 7.5–7.9 | B |
| 7.0–7.4 | B- |
| 6.5–6.9 | C+ |
| 6.0–6.4 | C |
| 5.5–5.9 | C- |
| 5.0–5.4 | D+ |
| 4.5–4.9 | D |
| 4.0–4.4 | D- |
| Below 4.0 | F |

## Stats Behavior

- **My Stats** has clickable rating rows and a search box for opening any of the current user's saved film ratings.
- **Group Stats** includes a film search that shows the current user's score when available, each group member's score, the group average, IMDb, and RT Audience.
- **Group Rankings** and all three Head-to-Head lists initially show five rows with an option to expand the full list.
- Film group data is returned by the authenticated `getSummary` action from `Database-Films`; the frontend does not read legacy sheet tabs.

## Security Model

The GitHub frontend is public, so it must not contain private values. These stay in Apps Script Script Properties:

- Google Sheet ID
- admin PIN
- TMDB API key
- OMDB API key
- Google Places key

The GitHub frontend does expose the Apps Script `/exec` URL in `CONFIG.GAS_URL`; that is expected. The backend assumes anyone can call that URL and validates login/session/admin tokens before sensitive actions.

Apps Script should be deployed as:

- **Execute as:** Me, meaning the script owner/deployer
- **Who has access:** Anyone

Users should continue visiting the GitHub Pages URL, not the Apps Script URL.

## Notes

The GitHub site still exposes the Apps Script `/exec` URL in `CONFIG.GAS_URL`; that is expected. API keys, sheet ID, admin PIN, user PINs, and Google Places key are read only from Apps Script Script Properties.

Restaurant thumbnails are fetched server-side and returned as small data URLs so Google Places photo URLs do not expose the API key.

## Manual Deployment

1. Replace GitHub `index.html` with this `index.html`.
2. Replace the GitHub copy of `Code.gs` for version control.
3. Paste this `Code.gs` into the Apps Script project.
4. Save the Apps Script project.
5. Confirm Script Properties are set.
6. Deploy a new web app version.
7. Confirm `CONFIG.GAS_URL` in `index.html` points to the deployed `/exec` URL.

Run `setupActiveSheetTabs` only when setting up the active tabs, rebuilding summary tabs, or repairing their formatting. A normal frontend-only change does not require it. A `Code.gs` change does require a new Apps Script deployment for the live GitHub Pages site to use it.

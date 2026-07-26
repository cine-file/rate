# Cine-file Secure Ratings Dashboard

This folder merges the latest restaurant UI work with the secure GitHub Pages + Apps Script backend approach.

## Project Overview

Cine-file is a small private ratings dashboard for a group of friends. GitHub Pages serves the public frontend at the normal site URL, while Google Apps Script acts as the private backend that reads/writes a Google Sheet.

The app currently has three rating areas:

- **Cine-file / Film** - movie search, full category rating, quick rating, generated rating card, already-rated detection, personal stats, group stats, and head-to-head stats.
- **Cine-file / TV** - series search, season ratings, optional manual overall-series ratings, quick and full category scoring, generated rating cards, separate season/overall stats, and a TV wishlist.
- **Le Guide / Restaurant** - restaurant search, full category rating, quick rating, generated restaurant card, already-rated detection, personal, group, head-to-head, and individual stats.

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
- `Future-Films` is one shared database tab with one row per saved film and a `user` column. It contains the film metadata needed by the wishlist plus the TMDB ID.
- `Future-Restaurants` is one shared database tab with one row per saved restaurant and a `user` column. It contains restaurant metadata plus the Google Place ID.
- `Database-TV` stores one row per user TV rating. It distinguishes `season` and `overall` entries using `entryType`, plus series metadata, season metadata, scores, category scores, and notes.
- `Summary-TV` stores one row per comparable TV unit: either a specific season or an optional overall-series rating.
- `Future-TV` is one shared database tab with one row per saved series and a `user` column.

Legacy `Users` rows with plain PINs are supported for login and can be migrated to hashes by the backend after a successful login.

## Sheet Setup

The active website backend uses only these sheet tabs:

- `Database-Films`
- `Summary-Films`
- `Database-Restaurants`
- `Summary-Restaurants`
- `Future-Films`
- `Future-Restaurants`
- `Database-TV`
- `Summary-TV`
- `Future-TV`
- `Users`

Paste and deploy `Code.gs`, then run `setupActiveSheetTabs` from the Apps Script editor. This formats the active tabs and rebuilds the Film, Restaurant, and TV summary tabs from their database tabs.

New film saves write to `Database-Films` and rebuild `Summary-Films`; new restaurant saves write to `Database-Restaurants` and rebuild `Summary-Restaurants`. The website still receives the same response shape it used before, so the UI and stats should behave the same.

The backend upserts ratings instead of appending duplicates:

- Rating the same film again updates that user's `Database-Films` row and replaces that user's score in the existing `Summary-Films` row.
- Rating the same restaurant again updates that user's `Database-Restaurants` row and replaces that user's score in the existing `Summary-Restaurants` row.

## Wishlist

The navigation label is **Wishlist** so it works for films, TV, restaurants, and future categories. It stays within the category selected from Home: choose Film, TV, or Le Guide first. The authenticated backend searches, adds, lists, and removes saved items.

- Saved items are personal, but the sheets are shared database tabs. Each row belongs to a user through its `user` column; no per-user future tabs are created.
- A user cannot save an item they have already rated.
- When a user saves a rating, the backend removes that matching item from that user's future tab. It does not remove other users' saved entries.
- Each saved film shows its metadata plus the group's average rating when friends have already rated it. Saved restaurants show the group average when available.
- Run `setupActiveSheetTabs` once after deploying this version to create and format `Future-Films`, `Future-Restaurants`, and `Future-TV`.

## TV Ratings

TV uses **TV** as the category label. Search for a series, then choose either a specific season or **Overall Series**.

- Seasons are the normal rating unit. A show such as *Survivor* can have independent entries for each season.
- Overall Series is optional and always stored separately from season ratings.
- The overall choice shows the current user's average across their rated seasons as a placeholder when they have not supplied a manual overall score. That calculated value is not stored as an overall rating.
- TV stats have a **Seasons / Overall Shows** selector above the same **My Stats**, **Group**, **Head to Head**, and **Individual Ratings** views used by Film. They never mix the two entry types in a ranking or average.
- Saving a season or overall TV rating removes that series from that user's `Future-TV` list.

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

- **My Stats** has clickable rating rows and a search box for opening any of the current user's saved film ratings. Rating detail cards calculate the grade from the stored final `/10` score, so old incorrect grade text does not affect the display.
- Rating detail cards show the user's score and grade, IMDb, RT Audience, and other users' scores when available.
- Film, TV, and Restaurant stats include **Individual Ratings**: select a user, then search their ratings or browse their complete score-sorted list. This view is derived from the same summary data used by group comparisons.
- Film, TV, and Restaurant **Head to Head** views compare two selected users, showing shared ratings, average scores, biggest disagreements, and strongest agreement.
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

Run `setupActiveSheetTabs` when setting up the active tabs, after deploying a version that adds new tabs, rebuilding summary tabs, or repairing formatting. This TV version creates `Database-TV`, `Summary-TV`, and `Future-TV`. A normal frontend-only change does not require it. A `Code.gs` change does require a new Apps Script deployment for the live GitHub Pages site to use it.

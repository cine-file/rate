# Cine-file Secure Ratings Dashboard

**Current build:** `2026.07.27-cross-category-recommendations.8`

This folder merges the latest restaurant UI work with the secure GitHub Pages + Apps Script backend approach.

## Project Overview

Cine-file is a small private ratings dashboard for a group of friends. GitHub Pages serves the public frontend at the normal site URL, while Google Apps Script acts as the private backend that reads/writes a Google Sheet.

The app currently has three rating areas:

- **Cine-file / Film** - movie search, advanced title/year search, full category rating, quick rating, generated rating card, already-rated detection, full personal/group/head-to-head/individual stats, genre-filtered comparisons, interactive score histograms, and secure self-service rating deletion.
- **Cine-file / TV** - series and advanced title/year search, season ratings, optional manual overall-series ratings, quick and full category scoring, generated rating cards, separate season/overall full stats, genre-filtered comparisons, interactive score histograms, secure deletion, and a TV wishlist.
- **Le Guide / Restaurant** - restaurant search, full category rating, quick rating, generated restaurant card, already-rated detection, full personal/group/head-to-head/individual stats, interactive score histograms, and secure deletion.

The dashboard is intentionally still a single-page app. Screens are shown/hidden with CSS classes rather than separate routes. The main user flow is:

1. User opens the GitHub Pages site.
2. User chooses Film, TV, or Restaurant.
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
- Film and TV stats have a persistent **Genre** filter above the stats tabs. The selected genre applies to My Stats, Group, Head to Head, and Individual Ratings, so averages and comparisons are calculated only from matching titles.

## Stats and Score Views

Film, TV, and Restaurant stats use the same four views: **My Stats**, **Group**, **Head to Head**, and **Individual Ratings**. The `/10 Score` and `Raw /100` toggle is shared across all three categories and all comparison views. Group summary API responses include both final `/10` values and raw `/100` values so the toggle does not have to estimate raw scores.

The score distribution is an interactive bar chart. In `/100` mode it uses 5-point bins on a 0-100 x-axis; in `/10` mode the same bins display as 0.5-point increments on a 0-10 x-axis. The y-axis counts ratings, the dashed vertical line marks the arithmetic average, and clicking a bar briefly shows only the number of ratings in that bin.

## Advanced Film and TV Search

Normal search remains fast and shows the first seven TMDB matches. The **Advanced Search** control can optionally narrow by release/first-air year and searches up to three result pages, returning up to 30 unique matches.

## Secure Rating Deletion

The bottom of each **My Stats** view contains **Delete a Rating**. Deletion requires the logged-in user to re-enter their PIN, choose a rating, and complete a separate final confirmation. The backend verifies the PIN again when processing the delete request, removes only that user's matching database row, and rebuilds the corresponding summary tab.

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


## AI-First Film Recommendations (v6)

Film recommendations now use Gemini as the recommendation brain and TMDB only for validation and metadata. Gemini receives the selected source film (when used), the user's source rating categories and notes, a compact taste profile, representative rating history, and exclusion lists. It proposes 15 real movie titles with years and explanations. The backend validates those suggestions against TMDB, applies the selected rated/wishlist exclusions, and keeps up to 10 eligible movies.

Each batch shows 5 movies and stores 5 instant replacements. After all 10 have been reviewed, the frontend automatically requests a fresh batch while excluding every movie already shown in that recommendation session. TMDB supplies IDs, posters, genres, runtime, and ratings; TMDB recommendations are used only as a fallback if Gemini is unavailable or fewer than 5 Gemini suggestions validate.

Diagnostics now show the active engine, AI model, number of AI proposals, number of validated movies, and backup count. All recommendation controls and diagnostics continue to use the active site theme variables.

## Manual Deployment

1. Replace GitHub `index.html` with this `index.html`.
2. Replace the GitHub copy of `Code.gs` for version control.
3. Paste this `Code.gs` into the Apps Script project.
4. Save the Apps Script project.
5. Confirm Script Properties are set.
6. Deploy a new web app version.
7. Confirm `CONFIG.GAS_URL` in `index.html` points to the deployed `/exec` URL.

Run `setupActiveSheetTabs` when setting up the active tabs, after deploying a version that adds new tabs, rebuilding summary tabs, or repairing formatting. This TV version creates `Database-TV`, `Summary-TV`, and `Future-TV`. A normal frontend-only change does not require it. This version changes `Code.gs` so Film group summaries include genre data; deploy a new Apps Script web-app version for genre filtering to work across group and head-to-head Film stats. This update changes both `index.html` and `Code.gs`; deploy a new Apps Script version after pasting the backend. No new sheet tabs or setup run are required.
## Film Recommendations

Film Wishlist now includes an additive recommendation room below the Saved Films to Watch list. Existing Film, TV, Restaurant, Wishlist, Stats, theme, rating, advanced-search, and deletion behavior remains in place.

Recommendation modes:

- **Based on a Movie** uses one of the current user's rated films as the source.
- **Based on My Taste** uses the user's complete film-rating history without requiring a source movie.

Recommendation pools:

- **New to Me** excludes films the user has already rated.
- **Not Rated or Wishlisted** excludes both rated films and existing wishlist films.
- **Include Rated Movies** permits previously rated films and labels the user's score.

Recommendation styles:

- Balanced
- Hidden Gems
- Something Different

The backend builds a validated candidate pool from TMDB recommendations, similar films, separate genre branches, source keywords, director work, lead-cast work, and taste-profile discovery. It scores candidates using the user's genres, directors, decades, runtimes, rating strength, and source-film similarity, then returns five films plus stored backups. Replace uses a backup without regenerating the whole set. Backup metadata is hydrated only when used, reducing initial generation time. Add to Wishlist uses the existing `Future-Films` flow.

New sheet tabs:

- `Recommendations-Films` records displayed recommendation sets and explanations.
- `Recommendation-Feedback` records actions such as add to wishlist, replace, and not interested.

Run `setupActiveSheetTabs` once after deploying this version to create and format the two new tabs.

### Optional AI Jury

Set the optional Apps Script property `GEMINI_API_KEY` to enable the Gemini ranking jury. The backend uses the stable `gemini-3.6-flash` model. The AI may select and explain recommendations only from the TMDB-validated candidate list. For source-movie recommendations, the jury receives the user's actual overall score, category scores, category notes, overall notes, source keywords, director, genres, and runtime. The website displays whether Gemini ran, whether deterministic fallback was used, the eligible candidate count, and a safe AI error when applicable. If this property is absent or the AI call fails, the deterministic taste-ranking engine still returns recommendations.

### Deployment for This Version

1. Replace GitHub `index.html`.
2. Replace the version-control copy of `Code.gs`.
3. Paste `Code.gs` into the Apps Script project.
4. Optionally add `GEMINI_API_KEY` in Apps Script Project Settings.
5. Save and deploy a new web-app version.
6. Run `setupActiveSheetTabs` once.


### Recommendation Diagnostics Update

- The Generate Film Recommendations control appears below the saved-film list.
- All diagnostic and recommendation elements use the existing theme variables and follow Gold, Light, and Classic schemes.
- Results identify `Gemini AI jury` or `Deterministic fallback`.
- Safe diagnostics show candidate counts and Gemini failure details without exposing the API key.
- This update changes both `index.html` and `Code.gs`; deploy a new Apps Script web-app version. Existing recommendation sheet tabs do not need to be recreated if they already exist.

### Gemini 3.6 Model Update

- The optional AI jury now calls the stable `gemini-3.6-flash` model.
- The Gemini request no longer sends `temperature`, `top_p`, or `top_k`, because these sampling parameters are deprecated for Gemini 3.6 and later models.
- The existing `GEMINI_API_KEY` Script Property remains valid; API keys are associated with a Google Cloud project, not locked to one Gemini model.
- Google AI Studio may be used to test the same key and model by selecting **Gemini 3.6 Flash** in the model selector. The live Cine-File website uses the model specified in `Code.gs`, regardless of the model last selected in AI Studio.
- This update changes `Code.gs` and the README only. Replace and redeploy `Code.gs`; no sheet setup or frontend replacement is required when upgrading from v4.

## Dynamic Rating Distribution and Food-Type Stats (v7)

Rating-distribution charts for Film, TV, and Le Guide now use a dynamic lower bound instead of always displaying the entire 0–100 or 0–10 scale. The chart keeps 100 or 10 as the maximum, rounds the lower bound down to a readable interval, includes additional space below the lowest score, and enforces a minimum visible span of 20 points in `/100` mode or 2 points in `/10` mode. Bars remain 5-point bins in `/100` mode and 0.5-point bins in `/10` mode. The note below the chart identifies the visible range, and the average marker remains in place.

Le Guide Stats now includes a **Food Type** filter matching the existing Film and TV genre-filter pattern. The selected food type applies to My Ratings, Group, Head to Head, and Individual Ratings. The selection is stored locally for the browser and follows the active Gold, Light, or Classic theme.

Le Guide My Ratings also includes **Food Type Averages**, ranking cuisine/food types by the current user's average rating and showing the number of ratings behind each average. The backend restaurant summary response now includes cuisine metadata so Group, Head to Head, and Individual Ratings can be filtered consistently.

This update changes both `index.html` and `Code.gs`. Replace both files and deploy a new Apps Script web-app version. No new sheet tabs or columns are required, and `setupActiveSheetTabs` does not need to be run solely for this update.


## Cross-Category Recommendations — v8

Film, TV, and Le Guide now each have a recommendation section below the category's saved-items list.

### Film

Film keeps the existing AI-first recommendation system. Gemini proposes titles from the logged-in user's ratings and notes, TMDB validates the titles and supplies metadata, five recommendations are shown, and five validated backups are held for replacement.

### TV

TV recommendations support:

- **Based on a Show** — choose one of the logged-in user's rated series.
- **Based on My Taste** — use the logged-in user's complete TV rating history.
- **New to Me**, **Not Rated or Wishlisted**, and **Include Rated Shows** pools.
- **Balanced**, **Hidden Gems**, and **Something Different** styles.
- Five visible series and up to five replacement series.
- TMDB validation before a recommendation is displayed.
- Direct **Add to Wishlist**, **Replace**, and **Not Interested** actions.

TV recommendations are personal to the authenticated user. Other users' ratings are not used unless a future group mode is deliberately added.

### Le Guide / Restaurants

Restaurant recommendations support:

- **Based on a Restaurant** — choose one of the logged-in user's rated restaurants.
- **Based on My Taste** — use the user's restaurant history and most common rated city.
- The same recommendation-pool and style choices as Film and TV.
- Five visible restaurants and up to five replacements.
- Google Places validation before a restaurant is displayed.
- Direct **Add to Wishlist**, **Replace**, and **Not Interested** actions.

For source-restaurant mode, the source restaurant's city anchors the search. For taste-only mode, the backend uses the most common city in that user's restaurant history. A user must therefore have at least one restaurant rating with a city before taste-only restaurant recommendations can be generated.

### Recommendation Architecture

The recommendation engine is AI-first:

1. Gemini reviews only the authenticated user's relevant rating history, category scores, and notes.
2. Gemini proposes 15 real candidates.
3. TMDB validates Film and TV titles; Google Places validates restaurants.
4. Rated, wishlisted, and previously shown items are removed according to the selected pool.
5. Up to 10 eligible items are retained: five shown and five held as replacements.
6. After all replacements are exhausted, the frontend generates a fresh batch while excluding previously shown IDs.

All recommendation controls reuse the existing recommendation CSS and theme variables. Gold, Light, and Classic themes therefore style the new TV and restaurant panels consistently with Film.

### Deployment for v8

Replace both `index.html` and `Code.gs`, save the Apps Script project, and deploy a new web-app version. In v8, TV and restaurant recommendations did not yet use persistent recommendation tabs. The v9 learning update below supersedes that behavior and requires one `setupActiveSheetTabs` run.


## Persistent TV and Restaurant Recommendation Learning — v9

TV and Le Guide recommendations now mirror the persistent Film recommendation pattern.

New tabs created by `setupActiveSheetTabs`:

- `Recommendations-TV`
- `Recommendation-Feedback-TV`
- `Recommendations-Restaurants`
- `Recommendation-Feedback-Restaurants`

Each generated batch stores all validated recommendations, including the five initially shown and the backup recommendations. User actions are stored permanently:

- Added to Wishlist
- Replaced
- Not Interested

Future Gemini prompts include the logged-in user's recent recommendation feedback so later TV and restaurant suggestions can avoid repeatedly rejected titles and learn from accepted recommendations. Recommendation history remains user-specific.

Run `setupActiveSheetTabs` once after deploying v9 to create and format the four new tabs.

### Theme Search Cleanup

Gold and Light/Cream themes no longer inherit Classic green or Le Guide red glow effects behind search controls. The search fields retain the active theme's surface and border styling without colored halos.

## Group Rating Distribution — v10

The Group tab for Film, TV, and Le Guide now includes a Group Rating Distribution chart.

- Every individual submitted rating is one observation. Ratings are not averaged by title before being placed into the chart.
- Film genre, TV genre/type, and restaurant food-type filters apply to the group chart.
- The chart follows the active `/10` or `/100` display mode.
- It uses the same dynamic lower-bound scaling, fixed maximum, bin sizes, average line, count popup, and theme styling as the individual distribution chart.
- The section title reports the total number of individual ratings represented.

This update changes only `index.html` and the README. `Code.gs` is carried forward unchanged from v9. No new spreadsheet tabs or columns are required, and `setupActiveSheetTabs` does not need to be run solely for v10.

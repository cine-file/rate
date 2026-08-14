# Cine-file Ratings Dashboard

**Build:** `2026.08.14-restaurant-location-performance.16`

Cine-file is a private, small-group ratings dashboard. GitHub Pages serves the static frontend and Google Apps Script is the JSON backend for Google Sheets, third-party lookups, authentication, and recommendation generation.

## Files

- `index.html` - GitHub Pages entry point and application markup. It loads the CSS and scripts below.
- `assets/styles.css` - all application styling and theme overrides.
- `assets/js/config.js` - public Apps Script deployment URL only.
- `assets/js/core.js` - shared state, API calls, authentication, themes, settings, and user selection.
- `assets/js/films.js` - Film rating flow and shared stats helpers.
- `assets/js/tv.js` - TV search, season/overall ratings, and TV stats.
- `assets/js/restaurants.js` - Le Guide search, rating flow, restaurant stats, deletion, and navigation support.
- `assets/js/restaurant-location.js` - per-user Restaurant city/state/country filter and voluntary browser-location handling.
- `assets/js/wishlist.js`, `recommendations.js`, and `activity.js` - focused Wishlist, recommendations, and Recent Activity features.
- `assets/js/shell.js` - final navigation and startup wiring. It loads last so the existing inline controls remain globally available.
- `Code.gs` - Apps Script backend. This is the file to paste into the Apps Script editor.
- `appsscript.json` - optional Apps Script manifest for `clasp` users.

The public GitHub repository may contain the Apps Script source. It must never contain API keys, the Sheet ID, or PIN values.

## User Flow

1. The site opens on the user selector. Users are sorted alphabetically in two columns.
2. A user enters their PIN and then lands on the category screen.
3. The category screen shows Film, TV, and Le Guide (Restaurants), plus shared Recent Activity.
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
| `OMDB_API_KEY` | No | IMDb and Rotten Tomatoes metadata. |
| `GEMINI_API_KEY` | No | Gemini-powered recommendations. The deterministic recommendation fallback still works without it. |

Do not put any of these values in the public frontend, GitHub Secrets, or the Google Sheet.

For the optional **Use my location** button to populate city, state/region, and country, enable the Google Maps **Geocoding API** for the same Google Cloud project as `GOOGLE_PLACES_KEY`. Restaurant search still works with manually entered fields if that API is unavailable or a user declines location permission.

## Sheet Tabs

`setupActiveSheetTabs()` creates/formats the active backend tabs and rebuilds summary/activity data. It does not delete old tabs.

Core rating tabs:

- `Users`
- `Database-Films`, `Summary-Films`, `Future-Films`
- `Database-TV`, `Summary-TV`, `Future-TV`
- `Database-Restaurants`, `Summary-Restaurants`, `Future-Restaurants`
- `Recent-Activity`

Recommendation history tabs:

- `Recommendations-Films`, `Recommendation-Feedback`
- `Recommendations-TV`, `Recommendation-Feedback-TV`
- `Recommendations-Restaurants`, `Recommendation-Feedback-Restaurants`

Database tabs contain one row per user rating. Summary tabs contain one row per film, TV unit, or restaurant and one score column per user. Re-rating an item updates that user’s database record and the corresponding summary cell instead of adding a duplicate.

## Deployment

1. Replace `Code.gs` in the Apps Script project.
2. Confirm the Script Properties above still exist.
3. Deploy a **new Web App version** using the existing deployment. The app must execute as the script owner and be reachable by the GitHub Pages frontend.
4. Commit the complete folder structure: `index.html`, `assets/`, `README.md`, and `appsscript.json` to the GitHub Pages repository root.
5. Confirm `CONFIG.GAS_URL` in `assets/js/config.js` points to the active `/exec` deployment URL. It is normal for the URL to be public; access control lives in Apps Script sessions and Script Properties.

Run `setupActiveSheetTabs()` only when tabs are missing, a summary needs rebuilding, or the Recent Activity index needs backfilling. It is not required for a normal frontend-only deployment.

Restaurant search areas are saved locally per signed-in user and are only sent with Restaurant Rate, Wishlist, or Recommendation searches. Repeated Restaurant searches are cached briefly, and autocomplete results intentionally omit downloaded photo data to keep lookups responsive.

## Security Notes

- User PINs are stored as salted SHA-256 hashes in `Users` (`name`, `pinHash`, `pinSalt`). Older plain-PIN rows are migrated after a successful login.
- Login and admin-PIN attempts are throttled after repeated failures.
- Rating saves/deletes use a document lock so concurrent actions cannot race a summary rebuild.
- Admin-only deployment status checks and user management require an admin session.
- Deleting a rating also removes it from Recent Activity.

Four-digit PINs are deliberately lightweight for this trusted group. They are not suitable as the sole authentication mechanism for a public service.

## Maintenance

When making a feature change, update the relevant `assets/` file, `Code.gs` when backend behavior changes, and this README in the same commit. Keep the build value at the top of this README aligned with `BACKEND_VERSION` in `Code.gs`.

GitHub Pages still serves `index.html` first. Its relative `assets/...` references load the CSS and JavaScript files directly; no build step, server change, or package installation is required.

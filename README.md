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

The backend keeps the existing spreadsheet style:

- `Users` tab stores user names and hashed PINs.
- Each film user has a personal tab named after the user.
- Film group data goes into `Summary`.
- Each restaurant user has a tab named `{UserName}-Restaurants`.
- Restaurant group data goes into `Restaurant Summary`.

Legacy `Users` rows with plain PINs are supported for login and can be migrated to hashes by the backend after a successful login.

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

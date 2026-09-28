# Tempo — browser edition

A private habit dashboard: daily limits, goal counters, tally marks (çetele),
session timers, event countdowns and time-since milestones. Six themes with a
light/dark toggle, live seconds, progress rings, history, undo and archives.

**No backend, Python runtime, database server, framework, package install, API
keys or build step.** GitHub Actions tests and deploys the static `site/` folder
to GitHub Pages. After loading the assets, all tracking runs on the visitor's
device. IndexedDB stores each browser's profiles. No tracking data is sent to
GitHub or a third-party service. GitHub still serves the static assets and may
keep its normal hosting/access logs.

## Publish on GitHub Pages

1. Create a GitHub repository with a `main` branch.
2. Upload the **contents** of this project into the repository root. Include
   `.github/workflows/pages.yml`, `site/`, `tests/`, `tools/`, and this README.
   Do not upload only the ZIP file, or put the whole project under another folder.
3. Open **Settings → Pages → Build and deployment → Source → GitHub Actions**.
4. Commit/push to `main`, or choose **Actions → Test and deploy Tempo to GitHub
   Pages → Run workflow** after enabling Pages.
5. Open the URL reported by the deploy job / Settings → Pages.

For an account site, use a repository named `YOUR_USERNAME.github.io`. For a
project site, any repository name works. All asset paths are relative, so root
and `/repository-name/` URLs both work. No custom domain is required.

The workflow deploys only `site/`; test files, this README and migration tools
are not served. Pull requests run tests without deploying. If you use a branch
other than `main`, change the workflow's two branch filters and its deployment
conditions accordingly.

## Local preview (optional)

Serve the `site/` folder with any static HTTP server. For example, from this
project directory if you already have Python:

```bash
python -m http.server 8080 --directory site
```

Open `http://localhost:8080`. Do not double-click `index.html`: browsers restrict
ES modules, IndexedDB and service workers on `file://` URLs. Python is only one
optional way to preview files; it is not part of the hosted application.

## Profiles and backups

- Each browser/device starts with its own empty **My space** profile.
- Create or rename local profiles using the selector and Data & settings.
  A profile holds its own trackers, history and theme. Different tabs may select
  different profiles. Updates to a shared profile appear in other open tabs.
- **Export profile JSON** downloads a portable backup of the selected profile.
  Exported timers are paused at the export instant, without pausing the live app.
- **Import backup** validates the full file and previews its contents. By default
  it creates a separate profile. Replacing the current profile requires typing
  its exact name; a revision check rejects replacement if another tab changed it.
- CSV export is for spreadsheets. JSON is the lossless, re-importable backup.
- JSON files are not encrypted. Store them wherever you keep personal backups.

Profiles are local organizational spaces, **not authenticated accounts**.
Anyone using the same browser profile can open them. There is no automatic
cross-device sync or server recovery. Clearing site data, private browsing,
storage eviction, or changing the site's address/path may make previous data
unavailable. Export before changing domains or repository paths. The optional
“Request persistent storage” control can reduce eviction risk when the browser
grants it; external backups are still important.

Limits: 25 profiles per installation, 500 trackers and 100,000 logged entry rows
per profile, 20 MB maximum import. Data is designed for personal tracking, not
large shared analytics datasets.

## Timers and daily reset

Running timers store a timestamp and continue through reloads, sleep and closed
tabs until paused. This does **not** require a background process. Daily totals
use device-local midnight; daylight-saving days can be shorter or longer than
24 hours. Paused sessions split across those boundaries, and Undo removes the
entire session as one action. Historical entries retain their recorded date.

Screen time is logged manually; the app does not observe other applications.
Count limits stop at zero remaining. Time budgets may be exceeded so actual time
is preserved. Countdown “days from now” means exact 24-hour durations.

## Offline use and updates

After a successful first load, the service worker caches the app's static files.
No server is needed for normal tracking. An internet connection is needed for
initial loading and app updates. Installation as a standalone app is available
where the browser supports it; ordinary tabs work too.

**When editing assets, bump `VERSION` in `site/sw.js`.** Existing tabs keep their
current version; close all tabs for the site and reopen to activate an update.
The app does not automatically replace a running session's files underneath it.
The service worker caches app files only, never user backups or tracker data.

## Tests

Node.js 24 is used in GitHub Actions. No npm installation is required:

```bash
node --test tests/*.test.mjs
```

Tests cover counters, timers, undo, midnight and DST transitions, backup
round-trips, malformed imports, data isolation, deployment paths and frontend
logic. IndexedDB integration and the visual layout should also be checked in
your target browsers after deploying.

## Migrate from the original Python app

Use the original app's SQLite backup or database. The optional utility opens it
read-only and creates a new JSON file:

```bash
python tools/migrate_sqlite.py ~/.tempo/tempo.sqlite3 --output my-tempo.json --name Heath
```

Then import `my-tempo.json` in the browser version. The original database remains
unchanged. This one-time converter is not deployed to GitHub Pages.

## Donations

The BTC and ETH addresses below match the public
[KanaFlip donation section](https://kanaflip.github.io/), as requested:

- **Bitcoin / BTC:** `bc1qjjvvddxsmefkqc9d6kvfr60k90kspt5uusr9ne`
- **Ethereum mainnet / ETH:** `0x455A377aC826c474fd0d9849EE01FBa9FA37a7B8`

They appear in the app with copy buttons. No wallet provider, payment SDK,
automatic transaction or third-party donation widget is loaded. To change them,
edit the two `wallet-*` elements in `site/index.html`.

## File layout

| File | Purpose |
| --- | --- |
| `site/index.html` | Dashboard, dialogs and donation section |
| `site/styles.css` | Responsive design and six themes |
| `site/app.mjs` | User interface and local import/export |
| `site/engine.mjs` | Pure tracking logic and strict backup validation |
| `site/storage.mjs` | IndexedDB transactions and cross-tab notifications |
| `site/sw.js` | Offline app cache and version lifecycle |
| `.github/workflows/pages.yml` | Test, package and Pages deployment |
| `tools/migrate_sqlite.py` | Optional migration from Tempo 1.x |

Deployment follows [GitHub's custom Pages workflow documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

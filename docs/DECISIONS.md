# Decisions

Short records of the choices that shape the project, newest last.

## 1. One Vercel project with two services
The React frontend (`frontend/`) and the FastAPI backend (`backend/`) deploy together through Vercel Services.
`vercel.json` sends `/api/*` to the backend and everything else to the frontend, so the browser talks to one
origin (no CORS) and every push deploys both halves at once.

## 2. The analysis core keeps the prototype's logic but drops pandas
`backend/dla/analysis.py` has the same dictionaries, sentence splitter, VADER scoring and formulas as the
Streamlit prototype. It now uses plain Python lists and dicts instead of pandas DataFrames, which keeps the
serverless function small (no 100 MB of pandas/NumPy) and its cold start fast. The ported tests guard the
numbers, including "sum counts first, then divide" for country-year totals.

## 3. Postgres on Neon, SQLite only for local work and tests
Production data lives in Neon Postgres (provisioned through the Vercel Marketplace, `DATABASE_URL`). Without
`DATABASE_URL` the backend uses `data/local.sqlite3`, except on Vercel, where it refuses to start without a
database instead of writing to a disposable file system. Schema changes go through Alembic migrations; a test
checks that the migrations and the models match, and CI runs every backend test on both SQLite and Postgres.

## 4. The UN corpus is scored offline, once
`python -m dla load-un` reads the UNGDC archive directly (no extraction), verifies its MD5 against Harvard
Dataverse, scores all statements in parallel (about 1.5 minutes for 11,141 speeches), caches the scores, and
replaces the UN tables in a single transaction, so re-running is safe and the live site never sees half-loaded
data. It runs on a computer or CI job, never inside a web request.

Only scores, keyword rates and the 15 most notable sentences per speech are stored (about 160,000 sentences),
not the full texts, which keeps the database well inside Neon's free tier. Consequence: new keywords can be
counted for uploaded datasets at any time, but for the UN data only the pre-counted keyword list is available.

Harvard Dataverse requires a short guestbook form before the archive can be downloaded. The pipeline never
fills it in; it explains the manual download and then works from the local file.

## 5. Datasets without accounts
Uploaded texts are stored in the database. A dataset is reachable by an unguessable id (view-only link); adding,
rescoring and deleting need an edit token that is returned once and kept in the creator's browser (the server
stores only its SHA-256 hash). This makes the tool usable without sign-up while keeping other people's data
safe from edits. The UI warns users not to upload confidential material.

## 6. Respecting Vercel's limits
- Request bodies are capped below Vercel's 4.5 MB limit: files up to 4 MB, texts up to 200,000 characters.
- CSVs are parsed and validated in the browser and sent in batches of at most 100 texts, each scored on arrival,
  so no request runs long; rescoring after a dictionary change also works in batches of 200.
- Per-dataset (5,000 texts) and global (200,000 texts) caps protect the free database tier.
- UN endpoints send `Cache-Control: s-maxage=3600`, so Vercel's CDN answers most UN queries without
  touching the function or the database.

## 7. The transformer model is optional and local-only
A zero-shot NLI model (`MoritzLaurer/deberta-v3-base-zeroshot-v2.0`) can label each sentence as hostile,
cooperative or neutral by reading it in context. PyTorch is far too large for a serverless function, so it is an
optional extra (`uv sync --extra context`, `DLA_CONTEXT_MODEL=1`) and is always off on Vercel. The interface
only offers it when the backend reports it as available.

## 8. Charts
Recharts, with a categorical palette validated for colour-vision deficiencies in light and dark mode. A country
keeps its colour when others are added or removed. Every chart has a legend, end-of-line labels (up to four
series) and a table view with the same numbers, so no value is reachable only by hovering.

## 9. Dependencies are pinned and slightly behind
Python dependencies are locked with uv (`uv.lock`, `exclude-newer` two weeks back) and JavaScript dependencies
with `package-lock.json` at exact versions, all published at least two weeks before they were adopted. Python
3.12 is used both locally and on Vercel.

## 10. Local development runs without Vercel
`npm run dev` starts the backend (port 8020) and the Vite dev server (port 5173, which forwards `/api`), installs
dependencies on the first run and migrates the database. `vercel dev` can run both services too, but on Windows it
sometimes gives up while the Python service is still starting, so `npm run dev` is the supported command. Under
`vercel dev` (`VERCEL_ENV=development`) the backend still falls back to SQLite; only real deployments insist on
`DATABASE_URL`.

## 11. Neon is connected to every environment
Database variables that a Marketplace integration creates for production and preview only are stored as
*sensitive*: deployments can read them, but nobody can download them, so the migrations and the UN load could not
run from a computer. The Neon resource is therefore also connected to the development environment, which makes
`vercel env pull` work. Operator commands use the direct connection (`DATABASE_URL_UNPOOLED`), the app the pooled
one. While no UN data is loaded, `/api/un/summary` answers `Cache-Control: no-store`, so the CDN never keeps an
empty answer once the data arrives.

## 12. 3D views where a third dimension carries meaning
- **Flags by year** (UN page): flags on poles, pole height = the chosen metric in one year, Play animates
  1946–2025, a flag at half-mast means no statement that year. Shows the chart's countries or the year's highest
  or lowest. One height scale spans all years, so heights stay comparable while it plays; the data arrives in one
  request (`/api/un/matrix`, ~30 KB compressed). This replaced a large 3D globe: the owner does not want a big
  globe as every project's centrepiece, and flags are specific to diplomacy.
- **Assembly hall** (UN page, next to the flags, same year and Play button): the General Assembly seen from the
  rostrum, one desk per delegation that spoke that year, with a column for the metric (colour and height; for tone
  balance and VADER the height is the distance from 0). Seats run from the lowest value on the left to the highest on
  the right (or alphabetically), so the year's spread reads at a glance; the hall has as many rows as the largest
  assembly needs, and earlier, smaller assemblies fill the front rows. The chart's countries get a flag at their desk.
  Desks are instanced (one draw call for ~200 desks), and delegations glide to their new seats as the years play.
- **Balance scale** (Analyze): one block per hostile or cooperative word (or per few words for long texts, the same
  unit on both sides) drops into its pan, and the beam tips by the tone balance; the needle's dial marks the UN
  average. Hovering a block names its word.
- **Podium** (Country ranking): the year's three highest values with their flags; tapping one opens that speech.
- **Speaker's rostrum** (Close reading): a General Assembly-style lectern with the speaking country's flag and a
  plaque with session and year. Decorative context only; the UN emblem is deliberately not used.
- **Rhetoric space** (UN and dataset pages): hostile words × cooperative words × year, with the "tone balance = 0"
  plane drawn in; each path ends in a small waving flag, so lines can be told apart without the legend.
- **Sentence landscape** (Analyze): every sentence in reading order, with hostile and cooperative columns.
- **Intro globe** (start page): small and decorative.

All 3D is three.js, loaded lazily (pages show before it arrives), drawn only while visible and only when something
changes (waving flags excepted), lighter on phones (fewer polygons, pixel density capped, fewer flags), tap instead
of hover, and vertical swipes still scroll the page. Each view frames itself for the screen's shape. Flags come
from flag-icons (MIT) and are downloaded one by one, only when shown; states without an ISO flag (Yugoslavia,
Czechoslovakia…) get a plain flag with their code. Every 3D view has a 2D equivalent with the same numbers.

## 13. Fonts
The requested Gastromond and Europa are commercial fonts (Adobe Fonts, or paid self-hosting licences). As agreed,
the app uses free, open-licensed stand-ins served with the app: **Fraunces** (heavy old-style display serif, in the
spirit of Gastromond's Garamond-based fat face) for headings and figures, and **Jost** at weight 300 (geometric,
Futura-like, close to Europa Light) for text; labels and buttons use Jost 500 for legibility at small sizes.

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
dependencies on the first run and migrates the database. `vercel dev` also works once the project is linked.

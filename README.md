# Diplomatic Language Analyzer

Measure **hostility**, **cooperation** and **rhetorical shifts** in diplomatic texts: speeches, joint statements and
state-media articles, and 80 years of UN General Debate statements (1946–2025).

**Live app: https://diplomatic-language-analyzer.vercel.app** · API documentation: https://diplomatic-language-analyzer.vercel.app/api/docs

## What you can do

| Page | What it does |
|---|---|
| **Analyze a text** | Paste a text or upload a `.txt`/`.pdf`. Get five tone metrics, a comparison with recent UN speeches, the text with hostile and cooperative words highlighted, a **3D balance scale** (one block per hostile or cooperative word, and the beam tips towards the heavier pan), a **3D sentence landscape** (every sentence as a tile, with columns for its hostile and cooperative words), a score for every sentence (CSV export), and save it to a dataset. |
| **UN General Debate** | **Flags by year**: countries' flags on 3D poles whose height shows the chosen metric (your chart's countries, or the highest/lowest of the year); press Play to watch 1946–2025, tap a flag to read that speech. Or switch to the **3D Assembly hall**: every delegation that spoke that year at its desk, with a column showing the metric, seated from lowest to highest or alphabetically. Explore 11,141 statements from 200 delegations by country, years and metric (or keyword), with the all-country average and key events, and follow each country through a **3D rhetoric space** (hostile × cooperative words × time, each path ending in its flag). See the biggest year-to-year shifts, read any speech at a **3D speaker's rostrum** with its most notable sentences, rank all countries in a year (top three on a **3D podium**), export CSV. |
| **My datasets** | Upload a CSV (`country`, `year`, `text`, optional `source`, `title`) and follow how its tone changes by country and year (chart and 3D rhetoric space), compare it with the same countries' UN speeches, track keywords, rescore, export, delete. |
| **Dictionaries** | Edit the hostile and cooperative word lists for your research question. |
| **Method** | How every number is computed, and the method's limitations. |

## How it works

```
Browser ──► Vercel ─┬─ /api/*  ──► FastAPI backend (backend/, Python 3.12) ──► Neon Postgres
                    └─ else    ──► React frontend (frontend/, static files)
```

- **Frontend** (`frontend/`): React + TypeScript + Vite, Recharts for the charts, three.js for the 3D views
  (loaded only on the pages that use them, lighter on phones). Fonts: Fraunces (headings) and Jost Light (text),
  both open-licensed and served with the app.
- **Backend** (`backend/`): FastAPI REST API under `/api`, with automatic docs at `/api/docs`. The analysis core is
  `backend/dla/analysis.py` (VADER + diplomatic dictionaries).
- **Database**: Postgres on Neon in production (SQLAlchemy + Alembic migrations); SQLite on your computer when no
  `DATABASE_URL` is set.
- **UN data pipeline**: `python -m dla load-un` verifies, scores and loads the UN General Debate Corpus. It runs on
  a computer, not on Vercel.
- **Tests**: pytest (backend, run on SQLite and Postgres), Vitest (frontend), Playwright (real browser, desktop
  and phone). GitHub Actions runs all of them on every push.

Design decisions are recorded in [docs/DECISIONS.md](docs/DECISIONS.md).

## Run it on your computer (Windows)

You need [Node.js](https://nodejs.org) 20+ and [uv](https://docs.astral.sh/uv/) (`winget install astral-sh.uv`).
In the project folder:

```
npm run dev
```

Then open **http://localhost:5173**. The first run installs everything (a few minutes). Press `Ctrl+C` to stop.
`npm run dev -- --sqlite` always uses the local test database, even when `.env.local` points to the live one.

The local app uses `data/local.sqlite3`. To fill it with the UN data, download `UNGDC_1946-2025.tar.gz` from
[Harvard Dataverse](https://doi.org/10.7910/DVN/0TJX8Y) (it asks you to fill in a short guestbook form), put it in
`data/raw/`, and run:

```
cd backend
uv run python -m dla load-un
```

To work against the production database instead, run `vercel env pull .env.local` in the project folder; the
backend then uses its `DATABASE_URL`. **Careful:** while `.env.local` exists, the local app reads and writes the
live database. Delete or rename the file to go back to SQLite.

### Tests

```
npm run test          # backend (pytest) + frontend (Vitest)
npm run e2e           # end-to-end tests in a real browser (starts its own servers with demo data)
```

To run the browser tests against the live site: `cd frontend`, `set E2E_BASE_URL=https://diplomatic-language-analyzer.vercel.app`, then
`npx playwright test`.

### Operator commands (in `backend/`)

| Command | What it does |
|---|---|
| `uv run python -m dla migrate` | create or upgrade the database tables |
| `uv run python -m dla download-un` | download and verify the corpus (explains the guestbook if needed) |
| `uv run python -m dla load-un` | score the corpus and replace the UN data in one transaction (safe to re-run) |
| `uv run python -m dla seed-demo` | load small fictional demo data (for testing only) |
| `uv run python -m dla status` | show which database is in use and what it contains |

## Deployment

- One Vercel project with two services (`vercel.json`): `/api/*` goes to the FastAPI backend, everything else to
  the React frontend.
- The Vercel project is connected to this GitHub repository: **every push to `main` deploys to production**, and
  other branches get preview deployments. GitHub Actions runs the tests on every push.
- The database is Neon Postgres from the Vercel Marketplace, connected to the project's production, preview and
  development environments. Its connection strings live only in Vercel's environment variables (`DATABASE_URL`,
  pooled, for the app; `DATABASE_URL_UNPOOLED`, direct, which the operator commands use automatically), never in
  the code.
- After changing the dictionaries or the pipeline, reload the UN data against Neon from a computer:
  `vercel env pull .env.local`, then `npm run migrate` and `npm run load-un` (about 4 minutes; the live site keeps
  the old data until the new data is complete).

## Method and limitations

- **Diplomatic dictionaries**: hostile and cooperative words counted per 1,000 words (`*` = any ending).
- **Tone balance** = (cooperative − hostile) / (cooperative + hostile), from −1 (confrontational) to +1
  (conciliatory).
- **VADER**: sentence-level sentiment (−1 to +1), averaged; share of sentences at or below −0.05.
- Country-year values add up the counts of all texts first and then divide.
- **Limitations**: word counting ignores context ("we do not seek confrontation" still counts one hostile word);
  VADER was built for social media; texts must be in English (UN texts are official translations); tone is not
  policy. Always read the highlighted sentences before trusting a number.
- An optional transformer model (zero-shot NLI) can read each sentence in context. It needs PyTorch, so it runs
  only locally (`uv sync --extra context`, then set `DLA_CONTEXT_MODEL=1`; the first use downloads about 400 MB).

## Data

Jankin, S., Baturo, A., & Dasandi, N. (2024). *Words to unite nations: The complete United Nations General Debate
Corpus, 1946–present.* Journal of Peace Research. Harvard Dataverse, https://doi.org/10.7910/DVN/0TJX8Y (CC0).

Flags: [flag-icons](https://github.com/lipis/flag-icons) (MIT). Map outlines for the intro globe: Natural Earth via
[world-atlas](https://github.com/topojson/world-atlas) (public domain).

The `notebook/` folder holds the original step-by-step Google Colab notebook.

## Licence

MIT. Built by Tuan Dung Nguyen.

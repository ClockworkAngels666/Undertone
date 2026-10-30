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

Scores, keyword rates and the 15 most notable sentences per speech are stored (about 160,000 sentences). The full
texts were added later for listening (see 16), zlib-compressed: 78 MB instead of 202 MB, which keeps the database
well inside Neon's free tier. New keywords can be counted for uploaded datasets at any time, but for the UN data
only the pre-counted keyword list is available (the texts are not rescored on request).

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

## 14. Accessibility and phone pass
Checked every page on desktop and phone, light and dark, with axe (WCAG 2.2 AA), worst-case data (the longest real
country names, one-sentence and 200,000-character texts) and a 320px-wide screen. Changes:
- Scrolling tables and the highlighted text can be reached and scrolled with the keyboard; a browser test now runs
  axe on every page in both colour schemes.
- Phones: hover styles only apply to devices that can hover, so nothing stays highlighted after a tap; buttons
  answer on press; no grey tap flash or tap delay; long-pressing a control no longer selects its text; small
  targets (chip remove buttons, link buttons, the table toggle, footer links) are at least 28px tall.
- Long country names no longer widen the page: chart end labels shorten to whole words ("Saint Vincent…", full
  name in the legend and on hover), and form rows and fields shrink with the screen.
- Counts read "1 sentence", "1,990 sentences"; tables and metric values use tabular figures.
- Play, pause and remove use small drawn icons instead of text symbols; the small kicker lines above page titles
  were removed.
- 3D tooltips follow the mouse without re-rendering the page on every move, and disappear when the pointer leaves
  the view.

## 15. Name
The project is called **Undertone Lab**: the tone underneath diplomatic wording is what it measures, and the tool
is a workbench for measuring it. The header shows "Undertone Lab" with "Diplomatic language analyzer" beneath it.
The GitHub repository is dungnguyen0309/UndertoneLab and the site is undertonelab.vercel.app; the old
repository names and the old web address forward to the new ones. Kept on purpose: the Python package `dla` and
its `python -m dla` commands, and the `dla.` prefix on browser storage keys, so datasets, dictionaries and voice
settings people saved before the rename are still there.

## 16. Listening
Texts are read aloud by the voices built into the visitor's browser and operating system (Web Speech API). There
are no recordings of the speeches and no paid text-to-speech service, so it costs nothing. Voices differ by device.
The default is a voice that runs on the device; online voices (Chrome's Google voices, Edge's natural voices)
sound better but send the text to Google's or Microsoft's servers, so they are marked "(online)" and only used
when chosen.
- Each sentence is its own utterance, so the page can light up the sentence being read, start from any sentence
  (tap it, use the slider, or a notable sentence's "sentence N" link) and change voice or speed mid-way. Long
  sentences are spoken in parts of at most 180 characters, because Chrome's online voices stop after about 15
  seconds of one utterance. Pause is a stop that remembers the sentence, as pause/resume is unreliable in Chrome.
- `reading_text` splits the whole text exactly like the scorer but keeps short pieces ("Thank you."), so nothing
  is skipped and a notable sentence's number points at the same sentence. Checked against all 11,141 speeches.
- The voice is not the delegate's: the Method page says so. The chosen voice and speed are remembered per browser.

## 17. Look: a working tool, not a template
In October 2026 the owner said the site still looked machine-made. The pages now read as a research tool:
- Each page opens with its title and one line about the data, set on the page itself. The blue gradient banners,
  the decorative globe on the start page and the wave pattern are gone; the row of flagpoles in front of UN
  headquarters now closes the footer instead.
- No resting shadows, coloured stripes or short bars under headings: surfaces are told apart by a 1px edge. The five
  metrics sit in one strip divided by thin lines rather than five striped cards. Titles are app-sized (28px).
- UN blue is kept for data, links and the one main button; the active menu item and the selected tab are marked in
  ink. Dark mode uses neutral greys instead of navy.
- The header shows the wave mark on its own (no blue tile), with the subtitle in sentence case.
- The all-country average in the flag view is named in the caption under it: a label inside the 3D scene ended up
  behind whichever flag reached that height.
- A polish pass followed: cards side by side keep their own height instead of stretching over a blank band;
  negative numbers carry a real minus sign everywhere (a hyphen read faint on chart axes); table headers sit on the
  card's surface instead of a filled band; the CSV picker's button matches the others; dark-mode charts and 3D
  labels use the same neutral greys as the page; and pages leave 32px between the header and the title.

## 18. Hardening after the design critique
A design critique (October 2026, 23/40) found controls that broke under real use. Fixed:
- Year fields (From, To, ranking year) take a typed year: a complete year in range applies at once, anything else
  is checked on Enter or when the field is left, with the allowed range shown beside it.
- Every table row that opens a speech (Biggest shifts, the year table, the rhetoric-space table, the ranking) does
  the same thing: Close reading shows it, the page scrolls there and focus moves to its heading. Row names are
  buttons, so Enter and Space work.
- After Analyze the page scrolls to the results, focus moves to them and a status line announces them; an empty
  submit marks the text box itself. Ctrl/Cmd+Enter analyzes.
- While a text is read aloud, Pause/Resume, Stop and the position stay pinned to the foot of the screen once the
  main controls scroll away.
- The flag and hall views and the rhetoric space each have a table of the same numbers; the year numeral no longer
  announces itself every 0.7 s during Play; the year tabs work with the arrow keys.
- The country search understands UK, US, UAE, USSR and similar, and asks instead of guessing when a search fits
  several countries ("Korea").
- Reset to default on the Dictionaries page can be undone.
- Chart labels and input placeholders pass 4.5:1 contrast in both themes; the chart is no longer an extra Tab stop
  (its numbers are in the table under it).
- The owner then asked to keep the deep blue background: page titles sit on a banner again, now one flat field of
  deep UN blue (no gradient, no wave line) with the flagpole row along its foot; the footer is a plain deep-blue
  close.

## 19. Saying what a result means
The critique also found the Analyze result overclaimed: a 141-word sample was called "more hostile than all"
UN statements while its tone balance was positive. Now:
- The result opens with a verdict in words taken from the tone balance (clearly or leaning conciliatory, evenly
  balanced, leaning or clearly confrontational), then one sentence placing both its hostile and its cooperative
  word rates among the UN statements of the last ten years (`cooperation_share_below` joins
  `hostility_share_below` in the API).
- Texts under 500 words (`config.SHORT_TEXT_WORDS`) get a warning that rates per 1,000 words swing widely, with
  the median length of the UN statements for scale.
- The metric explanations give the tone-balance formula and say what VADER is; the sentence table explains its
  columns; the datasets page title matches the menu; a disabled Create dataset says it is waiting for a file.

## 20. The UN page as tabs
The UN page had grown into one 5,500px scroll with Close reading at the bottom. Under the filters it now has four
tabs, kept in the address (`?v=`): Over time (the chart and the biggest shifts), Year by year (flags or the
Assembly hall, and the country ranking, all showing one shared year), Rhetoric space, and Close reading. Opening
a speech from any tab, table or 3D view switches to Close reading, scrolls there and moves focus to its heading.
On wide screens the tab bar stays under the header while the page scrolls. Loading placeholders keep each
section's height, so the page no longer jumps as data arrives.

## 21. The rest of the critique
- **Who held the seat.** The corpus files the Soviet Union's statements under RUS (to 1991) and the Republic of
  China's under CHN (to 1971, resolution 2758). `lib/history.ts` gives the name and flag for a code in a year, and
  the flags, the hall, the podium, the rostrum and the tables use it: 1960 shows the Soviet Union (a plain "USSR"
  flag) and the Republic of China.
- **Metaphors that judged.** The podium is not shown for metrics where a high value is a bad one (hostility, share
  of negative sentences), so it never crowns the most hostile delegation; the Assembly hall seats delegations
  alphabetically by default, as the real Assembly does, with colour and height carrying the value (seating by
  score is still an option).
- **Red means hostile words.** Differences from the UN average are shown in plain ink, not red and green; the
  eighth chart colour was the same red as hostile words and close to the second colour, and is now plum.
- **Smaller fixes.** Chart years fall on round steps (1990, 2000…); on phones the event names move under the chart;
  phones get short menu and tab names (the tabs keep their full accessible names); the ranking's values have their
  own right-aligned column; Close reading says "scored sentences"; Save text is a secondary button; the keyword
  rule sits under its field; a missing dataset gets a title and a way back; Copy link says it copied; the 404 page
  sets its tab title; the notable sentences lose their side bar; and the small type sizes collapse onto three steps.
- **Not changed:** the transcript headers that VADER scores as negative (fixing them means rescoring all UN data in
  the live database), legend clicks to isolate a line, and dictionary hit counts.

## 22. The second critique
A second review scored the app 26/40: the result still read as a list of numbers, Close reading only worked for
the chart's countries, and several controls behaved differently from page to page.
- **The record.** The Analyze result opens with one card: the verdict, the tone balance as a figure, one sentence
  placing it among the UN statements of the period (`tone_share_below` joins the other two shares), and a
  histogram of every statement's tone balance (`tone_histogram`, twenty bands from −1 to +1) with this text marked
  on it. "Edit the text" goes back to the box. The metric explanations are one "What these measures mean" list
  instead of a line under every card; saving to a dataset sits behind a button; the limitations follow the
  sentence table.
- **Close reading for any delegation.** The delegation list has the chart's countries first and then every
  delegation with statements; the years come from the data for that delegation. The speech comes first, with the
  notable sentences beside it; selecting one scrolls the speech to it (or plays from it while listening).
  Transcript headers ("Mr. President…") are left out of the notable lists.
- **Controls that agree.** A start year after the end year is marked as an error and nothing is fetched; a year
  outside the data is corrected with a note saying so. The ranking follows the year player, and its rows open the
  speech. Every tab bar uses the same underline; the chart options sit in the chart's card; each UN view sets its
  own tab title; the 404 page links the main pages.
- **Smaller fixes.** Highlighted words carry a hidden "(hostile)" or "(cooperative)" for screen readers; the file
  button shows a focus ring; the phone menu only fades below 400px, where it scrolls; flags say "no statement
  yet" before a delegation's first statement; phone flag labels alternate heights; the Soviet flag is red with a
  gold name; the 3D captions say "select" rather than "tap".
- **A crash.** The trend chart called a hook after its "no data" return, so a chart that first rendered empty
  and then received data (a dataset page, sometimes the UN page) blanked the whole app. The hook now runs first,
  and a unit test renders the chart empty and then with data.
- **Not changed:** the transcript headers inside the UN data (rescoring needs the live database), legend clicks
  to isolate a line, and dictionary hit counts.

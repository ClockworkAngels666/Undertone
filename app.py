"""
app.py – the web interface of the tool (built with Streamlit).

Run locally:      streamlit run app.py
Put it online:    see README.md (Streamlit Community Cloud, free)

Layout of this file:
  0. Settings & labels
  1. Helpers (country names, colours, charts, file reading)
  2. Sidebar (about, custom dictionaries)
  3. Tab 1 – Analyze a single text
  4. Tab 2 – Compare many texts over time (the user's CSV)
  5. Tab 3 – Explore the UN General Debate data (pre-scored)
"""
import hashlib
import io
from pathlib import Path

import pandas as pd
import plotly.graph_objects as go
import streamlit as st

import analysis as an

# ═════════════════════════════════════════════════════════════════════════════
# 0. SETTINGS
# ═════════════════════════════════════════════════════════════════════════════
AUTHOR = "Your Name"          # ✏️ change to your name
GITHUB_URL = ""              # ✏️ e.g. "https://github.com/your-name/diplomatic-language-analyzer"

APP_DIR = Path(__file__).parent
PALETTE = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"]
AVERAGE_COLOR = "#8a8984"
MAX_COUNTRIES = len(PALETTE)

st.set_page_config(page_title="Diplomatic Language Analyzer", page_icon="🌐", layout="wide")

METRICS = {  # column: (label, explanation, number format)
    "tone_balance": ("Tone balance", "−1 = fully confrontational, +1 = fully conciliatory", "{:+.2f}"),
    "hostility": ("Hostile words / 1,000", "Hostile dictionary words per 1,000 words", "{:.1f}"),
    "cooperation": ("Cooperative words / 1,000", "Cooperative dictionary words per 1,000 words", "{:.1f}"),
    "vader_mean": ("Avg sentiment (VADER)", "Mean VADER compound score per sentence, −1 to +1", "{:+.2f}"),
    "negative_share": ("Share of negative sentences", "Share of sentences with VADER ≤ −0.05", "{:.0%}"),
}
HIGHER_IS_WORSE = {"hostility", "negative_share"}   # for these, an increase is shown in red

EVENTS = {1956: "Suez/Hungary", 1962: "Cuban Missile Crisis", 1979: "Afghanistan", 1991: "USSR dissolves",
          2001: "9/11", 2003: "Iraq War", 2008: "Financial crisis", 2014: "Crimea", 2020: "COVID-19",
          2022: "Russia–Ukraine", 2023: "Gaza"}

# Short names for codes where the official name is long, or codes that are not ISO countries
COUNTRY_NAME_OVERRIDES = {
    "RUS": "Russia", "VNM": "Vietnam", "IRN": "Iran", "PRK": "North Korea", "KOR": "South Korea",
    "SYR": "Syria", "VEN": "Venezuela", "BOL": "Bolivia", "TZA": "Tanzania", "LAO": "Laos",
    "MDA": "Moldova", "PSE": "Palestine", "GBR": "United Kingdom", "USA": "United States",
    "EU": "European Union", "YUG": "Yugoslavia", "CSK": "Czechoslovakia", "DDR": "East Germany",
    "SUN": "Soviet Union", "YMD": "South Yemen",
}
# Fallback names, used only if the pycountry library is unavailable
COMMON_NAMES = {
    "CHN": "China", "FRA": "France", "DEU": "Germany", "JPN": "Japan", "IND": "India", "UKR": "Ukraine",
    "ISR": "Israel", "TUR": "Türkiye", "BRA": "Brazil", "ZAF": "South Africa", "PHL": "Philippines",
    "AUS": "Australia", "CAN": "Canada", "IDN": "Indonesia", "THA": "Thailand", "KHM": "Cambodia",
    "MYS": "Malaysia", "SGP": "Singapore", "MMR": "Myanmar", "CUB": "Cuba", "SAU": "Saudi Arabia",
    "EGY": "Egypt", "PAK": "Pakistan", "IRQ": "Iraq", "AFG": "Afghanistan", "MEX": "Mexico",
    "ARG": "Argentina", "NGA": "Nigeria", "ITA": "Italy", "ESP": "Spain", "POL": "Poland",
    "BLR": "Belarus", "GEO": "Georgia", "SRB": "Serbia", "KAZ": "Kazakhstan",
}

SAMPLE_TEXT = (
    "Mr. President, on behalf of the Republic of Valdoria, I congratulate you on your election. "
    "Our nation remains committed to multilateralism, dialogue and mutual respect among all States. "
    "We welcome the agreement reached on regional connectivity and stand ready to deepen cooperation with our partners.\n\n"
    "Yet we cannot remain silent. The unilateral sanctions imposed on our people are illegal and violate "
    "the Charter of the United Nations. Some powers still cling to a Cold War mentality and a bloc mentality, "
    "using disinformation to justify interference in the internal affairs of sovereign nations. "
    "We condemn these double standards. Hegemony has no place in the twenty-first century.\n\n"
    "Let us instead build bridges, restore trust and work together for a peaceful, inclusive and prosperous future. "
    "Valdoria extends the hand of friendship to every nation willing to engage on the basis of equality and goodwill."
)  # Valdoria is a FICTIONAL country – the sample text is for illustration only

SAMPLE_CSV = (
    "country,year,source,title,text\n"
    'VNM,2023,Ministry of Foreign Affairs,Joint Statement (example),"Paste the FULL ENGLISH TEXT here, inside double quotes."\n'
    'VNM,2024,Viet Nam News Agency (English),Article title (example),"Several texts in the same year are fine."\n'
    'CHN,2024,Xinhua (English edition),Article title (example),"Use ISO 3-letter codes (VNM, CHN, RUS, USA...)."\n'
)

DATA_CITATION = ("Data: Jankin, Baturo & Dasandi (2024), *Words to unite nations: The complete United Nations "
                 "General Debate Corpus, 1946–present*, Journal of Peace Research. Texts are the official UN "
                 "English versions.")

# ═════════════════════════════════════════════════════════════════════════════
# 1. HELPERS
# ═════════════════════════════════════════════════════════════════════════════
def label(col):
    if col.startswith("kw::"):
        return f"Keyword: {col[4:].replace('*', '…')} / 1,000 words"
    return METRICS[col][0]


def explanation(col):
    return METRICS[col][1] if col in METRICS else None


def fmt(col, value):
    if pd.isna(value):
        return "–"
    return (METRICS[col][2] if col in METRICS else "{:.2f}").format(value)


try:
    import pycountry
except ImportError:
    pycountry = None


@st.cache_data
def country_name(code):
    if code in COUNTRY_NAME_OVERRIDES:
        return COUNTRY_NAME_OVERRIDES[code]
    if pycountry is not None:
        try:
            c = pycountry.countries.get(alpha_3=code)
            if c is not None:
                return getattr(c, "common_name", None) or c.name
        except (KeyError, LookupError):
            pass
    return COMMON_NAMES.get(code, code)


def stable_colors(memory_key, codes):
    """Each country keeps its own colour when the user adds or removes other countries."""
    memory = st.session_state.setdefault(memory_key, {})
    for code in [c for c in memory if c not in codes]:
        del memory[code]
    for code in codes:
        if code not in memory:
            used = set(memory.values())
            memory[code] = next(i for i in range(len(PALETTE)) if i not in used)
    return {code: PALETTE[memory[code]] for code in codes}


def _spread_labels(last_y, gap):
    """Push end-of-line labels apart so they don't overlap."""
    positions, previous = {}, None
    for code in sorted(last_y, key=last_y.get):
        y = last_y[code] if previous is None else max(last_y[code], previous + gap)
        positions[code], previous = y, y
    return positions


def line_chart(table, col, colors, average=None, show_events=True, key=None):
    """Interactive line chart: one fixed colour per country, dashed average line, event markers."""
    table = table.dropna(subset=[col])
    if table.empty:
        st.info("No data for this selection.")
        return
    fig = go.Figure()
    last_x, last_y = {}, {}
    for code, color in colors.items():
        d = table[table.country == code].sort_values("year")
        if d.empty:
            continue
        fig.add_trace(go.Scatter(
            x=d.year, y=d[col], name=country_name(code), mode="lines+markers",
            line=dict(color=color, width=2), marker=dict(size=7, color=color, line=dict(width=1, color="white")),
            hovertemplate=f"<b>{country_name(code)}</b> · %{{x}}<br>{label(col)}: %{{y:.3f}}<extra></extra>"))
        last_x[code], last_y[code] = d.year.iloc[-1], d[col].iloc[-1]
    if average is not None and col in average:
        fig.add_trace(go.Scatter(
            x=average.year, y=average[col], name="All-country average", mode="lines",
            line=dict(color=AVERAGE_COLOR, width=1.6, dash="dash"),
            hovertemplate="<b>All-country average</b> · %{x}<br>%{y:.3f}<extra></extra>"))

    first_year, last_year = int(table.year.min()), int(table.year.max())
    if len(last_y) <= 4:   # direct labels at the end of each line
        span = (table[col].max() - table[col].min()) or 1
        for code, y in _spread_labels(last_y, span * 0.07).items():
            fig.add_annotation(x=last_x[code], y=y, text=country_name(code), xanchor="left", xshift=10,
                               showarrow=False, font=dict(size=12))
    if show_events:
        shown = sorted(y for y in EVENTS if first_year <= y <= last_year)
        for i, year in enumerate(shown):
            fig.add_vline(x=year, line_width=1, line_dash="dot", line_color="rgba(138,137,132,0.7)")
            fig.add_annotation(x=year, y=1, yref="paper", yanchor="bottom", yshift=4 + 17 * (i % 3),
                               text=EVENTS[year], showarrow=False, font=dict(size=11, color=AVERAGE_COLOR))
    right_pad = max(2, (last_year - first_year) * 0.13)
    fig.update_xaxes(range=[first_year - 0.6, last_year + right_pad], showgrid=False)
    fig.update_layout(height=500, yaxis_title=label(col), hovermode="closest",
                      margin=dict(l=10, r=10, t=90 if show_events else 30, b=10),
                      legend=dict(orientation="h", yanchor="top", y=-0.1, x=0))
    st.plotly_chart(fig, width="stretch", key=key)


def read_text_file(upload):
    if upload.name.lower().endswith(".pdf"):
        from pypdf import PdfReader
        return "\n".join((page.extract_text() or "") for page in PdfReader(upload).pages)
    data = upload.getvalue()
    if data[:2] in (b"\xff\xfe", b"\xfe\xff"):
        return data.decode("utf-16")
    try:
        return data.decode("utf-8-sig")
    except UnicodeDecodeError:
        return data.decode("cp1252", errors="replace")


@st.cache_resource
def get_vader():
    from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer
    return SentimentIntensityAnalyzer()


def make_scorer(hostile_terms, coop_terms):
    return an.Scorer(list(hostile_terms), list(coop_terms), vader=get_vader())


@st.cache_data(max_entries=30, show_spinner=False)
def score_text(text, hostile_terms, coop_terms):
    return make_scorer(hostile_terms, coop_terms).score(text)


@st.cache_data(show_spinner=False)
def load_un_data():
    for folder in (APP_DIR, APP_DIR / "data"):
        scores_file, sentences_file = folder / "un_scores.csv.gz", folder / "un_sentences.csv.gz"
        if scores_file.exists():
            scores = an.add_metrics(pd.read_csv(scores_file))
            sentences = pd.read_csv(sentences_file) if sentences_file.exists() else None
            return scores, sentences
    return None, None


def csv_download(table, file_name, key):
    st.download_button("⬇️ Download as CSV", table.to_csv(index=False).encode("utf-8-sig"),
                       file_name=file_name, mime="text/csv", key=key)


# ═════════════════════════════════════════════════════════════════════════════
# 2. SIDEBAR
# ═════════════════════════════════════════════════════════════════════════════
DEFAULT_HOSTILE, DEFAULT_COOP = ", ".join(an.HOSTILE_TERMS), ", ".join(an.COOPERATIVE_TERMS)
st.session_state.setdefault("hostile_terms", DEFAULT_HOSTILE)
st.session_state.setdefault("coop_terms", DEFAULT_COOP)


def reset_dictionaries():
    st.session_state["hostile_terms"], st.session_state["coop_terms"] = DEFAULT_HOSTILE, DEFAULT_COOP


with st.sidebar:
    with st.expander("ℹ️ How does it work?", expanded=True):
        st.markdown(
            "**1. Diplomatic dictionaries** – count *hostile* words (aggression, hegemony, sanctions…) "
            "and *cooperative* words (dialogue, mutual, win-win…) per 1,000 words.\n\n"
            "**2. Tone balance** = (cooperative − hostile) / (cooperative + hostile), "
            "from −1 (confrontational) to +1 (conciliatory).\n\n"
            "**3. VADER** – sentence-level sentiment (−1 to +1), averaged.\n\n"
            "**Limitations:** word counting ignores context (negation, irony). Texts must be in **English**. "
            "Always read the highlighted sentences to validate the numbers.")
    with st.expander("⚙️ Customize dictionaries", expanded=False):
        st.caption("Comma-separated. * = any word ending. Applies to tabs 1 and 2 "
                   "(the UN data uses the default dictionaries).")
        st.text_area("Hostile words", key="hostile_terms", height=180)
        st.text_area("Cooperative words", key="coop_terms", height=180)
        st.button("Reset to default", on_click=reset_dictionaries)
    st.divider()
    credit = f"Built by **{AUTHOR}**"
    if GITHUB_URL:
        credit += f" · [GitHub]({GITHUB_URL})"
    st.caption(credit)

HOSTILE = tuple(an.parse_term_list(st.session_state["hostile_terms"]))
COOP = tuple(an.parse_term_list(st.session_state["coop_terms"]))
DEFAULT_DICTIONARIES = HOSTILE == tuple(an.HOSTILE_TERMS) and COOP == tuple(an.COOPERATIVE_TERMS)

UN_SCORES, UN_SENTENCES = load_un_data()

st.title("🌐 Diplomatic Language Analyzer")
st.markdown("Measure **hostility**, **cooperation** and **rhetorical shifts** in diplomatic texts – "
            "speeches, joint statements, state-media articles.")
tab1, tab2, tab3 = st.tabs(["🔍 Analyze a text", "📈 Compare over time", "🌐 UN General Debate data"])

# ═════════════════════════════════════════════════════════════════════════════
# 3. TAB 1 – ANALYZE A SINGLE TEXT
# ═════════════════════════════════════════════════════════════════════════════
st.session_state.setdefault("text_input", "")

SORT_OPTIONS = {"hostile": "Most hostile", "negative": "Most negative (VADER)",
                "cooperative": "Most cooperative", "original": "Original order"}


def use_sample_text():
    st.session_state["text_input"] = SAMPLE_TEXT


def show_text_results(text):
    totals, sentences = score_text(text, HOSTILE, COOP)
    if totals["sentences"] == 0:
        st.warning("The text is too short – at least one full sentence (4+ words) is needed.")
        return
    m = an.add_metrics(pd.DataFrame([totals])).iloc[0]

    # Baseline: UN speeches from the last 10 years (only meaningful with the default dictionaries)
    baseline = None
    if UN_SCORES is not None and DEFAULT_DICTIONARIES:
        latest = int(UN_SCORES.year.max())
        baseline = UN_SCORES[UN_SCORES.year > latest - 10]

    delta_formats = {"negative_share": "{:+.0%}", "hostility": "{:+.1f}", "cooperation": "{:+.1f}"}
    for column, col in zip(st.columns(len(METRICS)), METRICS):
        delta = None
        if baseline is not None and pd.notna(m[col]):
            delta = delta_formats.get(col, "{:+.2f}").format(m[col] - baseline[col].mean()) + " vs UN avg"
        column.metric(label(col), fmt(col, m[col]), delta=delta, help=explanation(col),
                      delta_color="inverse" if col in HIGHER_IS_WORSE else "normal")
    if baseline is not None and pd.notna(m["hostility"]):
        share = (baseline["hostility"] < m["hostility"]).mean()
        st.markdown(f"This text is **more hostile than {share:.0%}** of UN General Debate speeches in "
                    f"{int(baseline.year.min())}–{int(baseline.year.max())}.")

    scorer = make_scorer(HOSTILE, COOP)
    left, right = st.columns([3, 2])
    with left:
        st.subheader("Highlighted text")
        st.markdown(f"<span style='{an.HOSTILE_STYLE}'>hostile</span> &nbsp; "
                    f"<span style='{an.COOP_STYLE}'>cooperative</span>", unsafe_allow_html=True)
        with st.container(height=420, border=True):
            st.markdown(an.highlight_html(text, scorer.hostile_rx, scorer.coop_rx), unsafe_allow_html=True)
    with right:
        for title, rx in (("🔴 Most frequent hostile words", scorer.hostile_rx),
                          ("🟢 Most frequent cooperative words", scorer.coop_rx)):
            st.markdown(f"**{title}**")
            terms = an.top_terms(text, rx)
            st.markdown(" · ".join(f"{term} ×{count}" for term, count in terms) if terms else "(none)")

    st.subheader("Sentence scores")
    order = st.radio("Sort by", list(SORT_OPTIONS), format_func=SORT_OPTIONS.get,
                     horizontal=True, key="sentence_sort")
    if order == "hostile":
        sentences = sentences.sort_values(["hostile_hits", "vader"], ascending=[False, True])
    elif order == "negative":
        sentences = sentences.sort_values("vader")
    elif order == "cooperative":
        sentences = sentences.sort_values(["coop_hits", "vader"], ascending=[False, False])
    st.dataframe(sentences, hide_index=True, column_config={
        "sentence": st.column_config.TextColumn("Sentence", width="large"),
        "vader": st.column_config.NumberColumn("VADER", format="%.2f"),
        "hostile_hits": st.column_config.NumberColumn("Hostile words"),
        "coop_hits": st.column_config.NumberColumn("Cooperative words"),
    })
    csv_download(sentences, "sentence_scores.csv", key="download_tab1")


with tab1:
    st.markdown("Paste an **English** text (speech, statement, article…) or upload a file.")
    col_a, col_b = st.columns([4, 1])
    with col_a:
        upload = st.file_uploader("Upload a file (.txt or .pdf)", type=["txt", "pdf"], key="text_file")
    with col_b:
        st.write("")
        st.button("Use sample text", on_click=use_sample_text, width="stretch")
    st.text_area("Text", key="text_input", height=200)

    text = st.session_state["text_input"]
    if upload is not None:
        try:
            text = read_text_file(upload)
            st.caption(f"Analyzing file: **{upload.name}**")
        except Exception as err:
            st.error(f"Could not read this file: {err}")
            text = ""
    if text.strip():
        show_text_results(text)
    else:
        st.info("👆 Paste a text or click “Use sample text” to try it.")

# ═════════════════════════════════════════════════════════════════════════════
# 4. TAB 2 – COMPARE MANY TEXTS OVER TIME
# ═════════════════════════════════════════════════════════════════════════════
def score_csv(table, keywords):
    """Score each text (with a progress bar), then add them up per country–year."""
    scorer = make_scorer(HOSTILE, COOP)
    kw_regexes = an.keyword_regexes(keywords)
    progress = st.progress(0.0)
    rows = []
    for i, r in enumerate(table.itertuples(index=False), 1):
        totals, _ = scorer.score(r.text)
        rows.append({"country": r.country, "year": r.year, **totals,
                     **an.count_keywords(an.clean_text(r.text), kw_regexes)})
        if i % 5 == 0 or i == len(table):
            progress.progress(i / len(table), text=f"Scoring {i}/{len(table)} texts...")
    progress.empty()
    return an.aggregate_by_year(pd.DataFrame(rows))


with tab2:
    st.markdown("Upload a CSV with at least 3 columns: **country** (code, e.g. VNM), **year** and **text** "
                "(full English text). Several texts per country–year are fine; they are added up.")
    st.download_button("⬇️ Download sample CSV", SAMPLE_CSV.encode("utf-8-sig"), file_name="sample_data.csv",
                       mime="text/csv")
    csv_upload = st.file_uploader("Upload your CSV", type=["csv"], key="csv_file")
    keywords = an.parse_term_list(st.text_input("Keywords to track (comma-separated)",
                                                value="sovereign*, sanction*, NATO", key="csv_keywords"))
    if csv_upload is not None:
        raw = csv_upload.getvalue()
        table = pd.read_csv(io.BytesIO(raw))
        table.columns = [str(c).strip().lower() for c in table.columns]
        missing = {"country", "year", "text"} - set(table.columns)
        if missing:
            st.error(f"Missing columns: {', '.join(sorted(missing))}. Required: country, year, text.")
        else:
            table["country"] = table["country"].astype(str).str.strip().str.upper()
            table["year"] = pd.to_numeric(table["year"], errors="coerce")
            table = table.dropna(subset=["year", "text"])
            table["year"] = table["year"].astype(int)
            table["text"] = table["text"].astype(str)

            cache_key = (hashlib.md5(raw).hexdigest(), HOSTILE, COOP, tuple(keywords))
            if st.session_state.get("csv_result_key") != cache_key:
                st.session_state["csv_result"] = score_csv(table, keywords)
                st.session_state["csv_result_key"] = cache_key
            result = st.session_state["csv_result"]
            st.success(f"Analyzed {len(table)} texts from {result.country.nunique()} countries.")

            countries = list(result.groupby("country")["documents"].sum().sort_values(ascending=False).index)
            if len(countries) > MAX_COUNTRIES:
                st.caption(f"Charts show at most {MAX_COUNTRIES} countries.")
            chosen = st.multiselect(f"Countries (max {MAX_COUNTRIES})", countries, default=countries[:4],
                                    max_selections=MAX_COUNTRIES,
                                    format_func=lambda c: f"{country_name(c)} ({c})", key="countries_tab2")
            options = list(METRICS) + [c for c in result.columns if c.startswith("kw::")]
            col = st.selectbox("Metric", options, format_func=label, key="metric_tab2")
            line_chart(result[result.country.isin(chosen)], col, stable_colors("colors_tab2", chosen),
                       show_events=False, key="chart_tab2")
            st.dataframe(result[result.country.isin(chosen)], hide_index=True)
            csv_download(result, "results_by_year.csv", key="download_tab2")

# ═════════════════════════════════════════════════════════════════════════════
# 5. TAB 3 – UN GENERAL DEBATE DATA
# ═════════════════════════════════════════════════════════════════════════════
KIND_TITLES = {"hostile": "🔴 Sentences with the most hostile words",
               "negative": "🟠 Most negative sentences (VADER)",
               "cooperative": "🟢 Most cooperative sentences"}

with tab3:
    if UN_SCORES is None:
        st.info("UN data not found. The maintainer must run `build_un_data.py` once and place "
                "`un_scores.csv.gz` and `un_sentences.csv.gz` next to `app.py` (see README).")
    else:
        st.markdown("Country statements at the UN General Assembly General Debate, pre-scored.")
        all_countries = sorted(UN_SCORES.country.unique(), key=country_name)
        defaults = [c for c in ["RUS", "USA", "CHN", "VNM"] if c in all_countries]
        first_year, last_year = int(UN_SCORES.year.min()), int(UN_SCORES.year.max())

        c1, c2, c3 = st.columns([3, 2, 2])
        chosen = c1.multiselect(f"Countries (max {MAX_COUNTRIES})", all_countries, default=defaults,
                                max_selections=MAX_COUNTRIES,
                                format_func=lambda c: f"{country_name(c)} ({c})", key="countries_tab3")
        start, end = c2.slider("Years", first_year, last_year, (max(first_year, 1990), last_year), key="years_tab3")
        options = list(METRICS) + [c for c in UN_SCORES.columns if c.startswith("kw::")]
        col = c3.selectbox("Metric", options, format_func=label, key="metric_tab3")
        c4, c5 = st.columns(2)
        show_average = c4.checkbox("Show average of all countries", value=True, key="average_tab3")
        show_events = c5.checkbox("Show key events", value=True, key="events_tab3")

        in_range = UN_SCORES[UN_SCORES.year.between(start, end)]
        selected = in_range[in_range.country.isin(chosen)]
        average = in_range.groupby("year", as_index=False)[options].mean() if show_average else None
        if chosen:
            line_chart(selected, col, stable_colors("colors_tab3", chosen), average, show_events, key="chart_tab3")

            st.subheader("⚡ Biggest shifts")
            st.caption("Largest changes from the previous year. Read these years closely below.")
            shifts = an.biggest_shifts(selected, col)
            shifts.insert(0, "Country", shifts.country.map(country_name))
            st.dataframe(shifts.drop(columns="country").rename(columns={
                "from_year": "From", "year": "To", col: label(col), "change": "Change"}).round(3),
                hide_index=True)

            st.subheader("📖 Close reading")
            r1, r2 = st.columns(2)
            read_country = r1.selectbox("Country", chosen, format_func=country_name, key="read_country")
            years = sorted(selected.loc[selected.country == read_country, "year"].unique(), reverse=True)
            if years:
                read_year = r2.selectbox("Year", years, key="read_year")
                row = selected[(selected.country == read_country) & (selected.year == read_year)].iloc[0]
                st.markdown(" · ".join(f"{label(c)}: **{fmt(c, row[c])}**" for c in METRICS))
                if UN_SENTENCES is not None:
                    speech = UN_SENTENCES[(UN_SENTENCES.country == read_country) & (UN_SENTENCES.year == read_year)]
                    for kind, title in KIND_TITLES.items():
                        group = speech[speech.kind == kind]
                        st.markdown(f"**{title}**")
                        if group.empty:
                            st.caption("(none)")
                        for _, s in group.iterrows():
                            st.markdown(f"> {s.sentence}")

        st.subheader("🏆 Country ranking for a year")
        k1, k2 = st.columns([1, 3])
        rank_year = k1.selectbox("Year", sorted(in_range.year.unique(), reverse=True), key="rank_year")
        ranking = (UN_SCORES[UN_SCORES.year == rank_year][["country", col]].dropna()
                   .sort_values(col, ascending=False).reset_index(drop=True))
        ranking.insert(0, "#", ranking.index + 1)
        ranking.insert(1, "Country", ranking.country.map(country_name))
        k2.dataframe(ranking.rename(columns={col: label(col)}), hide_index=True, height=320)

        csv_download(selected, "un_data_selection.csv", key="download_tab3")
        st.caption(DATA_CITATION)

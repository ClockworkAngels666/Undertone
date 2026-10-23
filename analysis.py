"""
analysis.py – the "brain" of the tool.

All calculations live here, separate from the user interface (app.py), so that:
  • app.py and build_un_data.py share ONE scoring method → consistent results;
  • the interface can change later (web, Excel, API...) without rewriting the analysis.
"""
import html
import re
from collections import Counter

import numpy as np
import pandas as pd

# ─────────────────────────────────────────────────────────────────────────────
# 1. DIPLOMATIC DICTIONARIES  (* = any word ending: sanction* → sanction, sanctions...)
# ─────────────────────────────────────────────────────────────────────────────
HOSTILE_TERMS = [
    "aggress*", "hostil*", "threat*", "provocat*", "confrontation*", "belligeren*", "warmonger*",
    "invasion*", "invade*", "occupation", "occupying", "occupier*", "annex*", "interfer*",
    "sanction*", "blockade*", "embargo*", "coerc*", "blackmail*", "intimidat*",
    "hegemon*", "imperialis*", "neo-colonial*", "neocolonial*", "colonialis*", "expansionis*",
    "destabili*", "subversi*", "regime change", "colour revolution*", "color revolution*",
    "double standard*", "hypocri*", "propaganda", "disinformation", "falsif*",
    "condemn*", "denounce*", "violat*", "illegal*", "illegitimate", "unlawful",
    "atrocit*", "genocid*", "massacre*", "terroris*", "extremis*", "nazi*", "neo-nazi*", "fascis*",
    "enemy", "enemies", "attack*", "war", "wars", "bombing*", "cold war", "zero-sum",
    "bloc mentality", "unilateralis*", "arrogan*", "domination", "dictat*",
]

COOPERATIVE_TERMS = [
    "cooperat*", "co-operat*", "collaborat*", "partner*", "dialogue*", "negotiat*", "consultation*",
    "multilateral*", "mutual*", "reciproc*", "friendship", "friendly", "solidarity", "together",
    "trust", "confidence-building", "reconcil*", "consensus", "compromise*", "understanding",
    "peaceful*", "peacebuilding", "win-win", "common interest*", "shared future", "common future",
    "common destiny", "jointly", "integrat*", "connectivity", "assist*", "goodwill",
    "good-neighbo*", "good neighbo*", "harmon*", "inclusive*", "welcome*", "agreement*",
    "build bridges", "bridge-building",
]

# Keywords pre-counted for the whole UN dataset (edit this list, then re-run build_un_data.py)
DEFAULT_KEYWORDS = [
    "NATO", "sovereign*", "multipolar*", "sanction*", "hegemon*", "terroris*", "climate",
    "nuclear", "human rights", "democra*", "colonial*", "Ukrain*", "Taiwan", "Palestin*",
    "South China Sea", "pandemic", "cyber*", "artificial intelligence",
]

NEGATIVE_THRESHOLD = -0.05   # a sentence with VADER ≤ −0.05 counts as negative (common convention)


def build_regex(terms):
    """Turn a list of terms (optionally ending in *) into one search pattern (regex)."""
    patterns = []
    for term in terms:
        term = term.strip().lower()
        if not term.rstrip("*"):
            continue
        stem = re.escape(term.rstrip("*")).replace(r"\ ", r"\s+")
        patterns.append(stem + (r"[\w-]*" if term.endswith("*") else ""))
    if not patterns:
        return re.compile(r"(?!x)x")                   # a regex that never matches
    patterns.sort(key=len, reverse=True)               # longer phrases first ("cold war" before "war")
    return re.compile(r"\b(?:" + "|".join(patterns) + r")\b", flags=re.IGNORECASE)


def parse_term_list(text):
    """'a, b\\nc' → ['a', 'b', 'c'] (used for the dictionary boxes in the interface)."""
    return [t.strip() for t in re.split(r"[,\n;]+", text or "") if t.strip()]


# ─────────────────────────────────────────────────────────────────────────────
# 2. CLEANING & SENTENCE SPLITTING
# ─────────────────────────────────────────────────────────────────────────────
_ABBREVIATIONS = re.compile(r"\b(Mr|Mrs|Ms|Dr|St|No|Nos|Art|Arts|Vol|para|paras|U\.S|U\.N|U\.K|E\.U|H\.E)\.")
_SENTENCE_BREAK = re.compile(r"(?<=[.!?])\s+(?=[\"“'(\[]?[A-Z])")


def clean_text(text):
    text = str(text).replace("﻿", " ")
    text = re.sub(r"(?m)^\s*\d{1,3}\.\s+", "", text)     # paragraph numbers at the start of a line
    return re.sub(r"\s+", " ", text).strip()


def split_sentences(clean):
    protected = _ABBREVIATIONS.sub(lambda m: m.group(0).replace(".", "§"), clean)
    sentences = [s.replace("§", ".").strip() for s in _SENTENCE_BREAK.split(protected)]
    return [s for s in sentences if len(s.split()) >= 4]


# ─────────────────────────────────────────────────────────────────────────────
# 3. SCORING
# ─────────────────────────────────────────────────────────────────────────────
COUNT_COLUMNS = ["words", "sentences", "hostile_hits", "coop_hits", "vader_sum", "negative_sentences"]


class Scorer:
    """Scores a text with two layers: VADER (per sentence) and the diplomatic dictionaries."""

    def __init__(self, hostile_terms=None, coop_terms=None, vader=None):
        if vader is None:
            from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer
            vader = SentimentIntensityAnalyzer()
        self.vader = vader
        self.hostile_rx = build_regex(hostile_terms if hostile_terms is not None else HOSTILE_TERMS)
        self.coop_rx = build_regex(coop_terms if coop_terms is not None else COOPERATIVE_TERMS)

    def score(self, text):
        """Return (totals: dict of counts, sentences: DataFrame with one row per sentence)."""
        clean = clean_text(text)
        parts = split_sentences(clean)
        sentences = pd.DataFrame({
            "sentence": parts,
            "vader": [self.vader.polarity_scores(s)["compound"] for s in parts],
            "hostile_hits": [len(self.hostile_rx.findall(s)) for s in parts],
            "coop_hits": [len(self.coop_rx.findall(s)) for s in parts],
        })
        totals = {
            "words": len(clean.split()),
            "sentences": len(sentences),
            "hostile_hits": len(self.hostile_rx.findall(clean)),
            "coop_hits": len(self.coop_rx.findall(clean)),
            "vader_sum": float(sentences["vader"].sum()) if len(sentences) else 0.0,
            "negative_sentences": int((sentences["vader"] <= NEGATIVE_THRESHOLD).sum()) if len(sentences) else 0,
        }
        return totals, sentences


def add_metrics(table):
    """From the count columns (COUNT_COLUMNS) → normalised metrics (per 1,000 words, shares...)."""
    t = table.copy()
    words = t["words"].replace(0, np.nan)
    sentences = t["sentences"].replace(0, np.nan)
    t["hostility"] = t["hostile_hits"] / words * 1000
    t["cooperation"] = t["coop_hits"] / words * 1000
    t["tone_balance"] = (t["coop_hits"] - t["hostile_hits"]) / (t["coop_hits"] + t["hostile_hits"]).replace(0, np.nan)
    t["vader_mean"] = t["vader_sum"] / sentences
    t["negative_share"] = t["negative_sentences"] / sentences
    for col in [c for c in t.columns if c.startswith("kwcount::")]:
        t["kw::" + col[len("kwcount::"):]] = t[col] / words * 1000      # keyword per 1,000 words
    return t


def aggregate_by_year(table):
    """Add up several texts to country–year level (sum counts FIRST), then compute metrics."""
    sum_cols = COUNT_COLUMNS + [c for c in table.columns if c.startswith("kwcount::")]
    g = table.groupby(["country", "year"], as_index=False)[sum_cols].sum()
    g["documents"] = table.groupby(["country", "year"]).size().values
    return add_metrics(g)


def keyword_regexes(keywords):
    return {"kwcount::" + kw: build_regex([kw]) for kw in keywords}


def count_keywords(clean, regexes):
    return {col: len(rx.findall(clean)) for col, rx in regexes.items()}


def key_sentences(sentences, n=3, max_len=600):
    """Pick the sentences most worth reading: most hostile, most negative (VADER), most cooperative."""
    if sentences.empty:
        return pd.DataFrame(columns=["kind", "score", "sentence"])
    s = sentences.drop_duplicates("sentence")
    parts = [
        s[s.hostile_hits > 0].sort_values(["hostile_hits", "vader"], ascending=[False, True]).head(n)
         .assign(kind="hostile", score=lambda d: d.hostile_hits),
        s[s.vader <= NEGATIVE_THRESHOLD].nsmallest(n, "vader").assign(kind="negative", score=lambda d: d.vader),
        s[s.coop_hits > 0].sort_values(["coop_hits", "vader"], ascending=[False, False]).head(n)
         .assign(kind="cooperative", score=lambda d: d.coop_hits),
    ]
    out = pd.concat(parts, ignore_index=True)[["kind", "score", "sentence"]]
    out["sentence"] = out["sentence"].str.slice(0, max_len)
    return out


def biggest_shifts(yearly, column, n=8):
    """Largest changes from the previous year with data, per country."""
    b = yearly.sort_values(["country", "year"]).copy()
    b["from_year"] = b.groupby("country")["year"].shift()
    b["change"] = b.groupby("country")[column].diff()
    b = b.dropna(subset=["change"])
    b = b.reindex(b["change"].abs().sort_values(ascending=False).index).head(n)
    b["from_year"] = b["from_year"].astype(int)
    return b[["country", "from_year", "year", column, "change"]]


# ─────────────────────────────────────────────────────────────────────────────
# 4. DISPLAY HELPERS: highlighting & most frequent terms
# ─────────────────────────────────────────────────────────────────────────────
HOSTILE_STYLE = "background:rgba(227,73,72,.25);border-radius:3px;padding:0 2px"
COOP_STYLE = "background:rgba(27,175,122,.25);border-radius:3px;padding:0 2px"


def highlight_html(text, hostile_rx, coop_rx):
    """Return safe HTML: hostile terms on a red background, cooperative terms on green."""
    matches = [(m.start(), m.end(), HOSTILE_STYLE) for m in hostile_rx.finditer(text)]
    matches += [(m.start(), m.end(), COOP_STYLE) for m in coop_rx.finditer(text)]
    matches.sort()
    out, pos = [], 0
    for start, end, style in matches:
        if start < pos:          # skip overlapping matches
            continue
        out.append(html.escape(text[pos:start]))
        out.append(f'<span style="{style}">{html.escape(text[start:end])}</span>')
        pos = end
    out.append(html.escape(text[pos:]))
    return "".join(out).replace("\n", "<br>")


def top_terms(text, regex, n=10):
    counts = Counter(re.sub(r"\s+", " ", m.lower()) for m in regex.findall(text))
    return counts.most_common(n)

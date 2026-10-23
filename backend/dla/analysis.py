"""
Analysis core: cleaning, sentence splitting, VADER scoring, diplomatic dictionaries and metrics.

The API, the data pipeline and the tests all import this module, so every number in the app
comes from one scoring method. It deliberately avoids pandas so the serverless API stays small
and starts fast.
"""
from __future__ import annotations

import re
from collections import Counter
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from functools import lru_cache

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

# Keywords pre-counted for the whole UN dataset (edit this list, then re-run the UN pipeline)
DEFAULT_KEYWORDS = [
    "NATO", "sovereign*", "multipolar*", "sanction*", "hegemon*", "terroris*", "climate",
    "nuclear", "human rights", "democra*", "colonial*", "Ukrain*", "Taiwan", "Palestin*",
    "South China Sea", "pandemic", "cyber*", "artificial intelligence",
]

NEGATIVE_THRESHOLD = -0.05   # a sentence with VADER ≤ −0.05 counts as negative (common convention)

# Metric id → (label, explanation, higher_is_worse)
METRICS = {
    "tone_balance": ("Tone balance", "−1 = fully confrontational, +1 = fully conciliatory", False),
    "hostility": ("Hostile words / 1,000", "Hostile dictionary words per 1,000 words", True),
    "cooperation": ("Cooperative words / 1,000", "Cooperative dictionary words per 1,000 words", False),
    "vader_mean": ("Avg sentiment (VADER)", "Mean VADER compound score per sentence, −1 to +1", False),
    "negative_share": ("Share of negative sentences", "Share of sentences with VADER ≤ −0.05", True),
}
KEYWORD_PREFIX = "kw::"         # metric id of a keyword rate, e.g. "kw::NATO" (hits per 1,000 words)
KEYWORD_COUNT_PREFIX = "kwcount::"

MAX_TERMS = 500                 # limits for user-supplied dictionaries and keyword lists
MAX_TERM_LENGTH = 60


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
    """'a, b\\nc' → ['a', 'b', 'c'] (used for dictionary and keyword boxes)."""
    return [t.strip() for t in re.split(r"[,\n;]+", text or "") if t.strip()]


def normalize_terms(terms):
    """Clean a user-supplied term list: trim, drop empties and duplicates, keep the original order."""
    seen, out = set(), []
    for term in terms:
        term = re.sub(r"\s+", " ", str(term)).strip()
        key = term.lower()
        if term.rstrip("*").strip() and key not in seen:
            seen.add(key)
            out.append(term)
    return out


def validate_terms(terms, what="term list"):
    """Raise ValueError if a user-supplied list is too long or has an overlong term."""
    if len(terms) > MAX_TERMS:
        raise ValueError(f"The {what} has {len(terms)} entries; the maximum is {MAX_TERMS}.")
    too_long = [t for t in terms if len(t) > MAX_TERM_LENGTH]
    if too_long:
        raise ValueError(f"Entries in the {what} must be at most {MAX_TERM_LENGTH} characters "
                         f"(“{too_long[0][:20]}…”).")


def is_default_dictionaries(hostile_terms, coop_terms):
    """True when the lists equal the defaults (ignoring case and order)."""
    def key(terms):
        return {t.strip().lower() for t in terms if t.strip()}
    return key(hostile_terms) == key(HOSTILE_TERMS) and key(coop_terms) == key(COOPERATIVE_TERMS)


# ─────────────────────────────────────────────────────────────────────────────
# 2. CLEANING & SENTENCE SPLITTING
# ─────────────────────────────────────────────────────────────────────────────
_ABBREVIATIONS = re.compile(r"\b(Mr|Mrs|Ms|Dr|St|No|Nos|Art|Arts|Vol|para|paras|U\.S|U\.N|U\.K|E\.U|H\.E)\.")
_SENTENCE_BREAK = re.compile(r"(?<=[.!?])\s+(?=[\"“'(\[]?[A-Z])")


def clean_text(text):
    text = str(text).replace("\ufeff", " ")
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


@dataclass(frozen=True)
class SentenceScore:
    index: int           # position in the text (0-based)
    sentence: str
    vader: float
    hostile_hits: int
    coop_hits: int


@lru_cache(maxsize=1)
def get_vader():
    """One shared VADER analyzer (loading its lexicon takes a moment)."""
    from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer
    return SentimentIntensityAnalyzer()


class Scorer:
    """Scores a text with two layers: VADER (per sentence) and the diplomatic dictionaries."""

    def __init__(self, hostile_terms=None, coop_terms=None, vader=None):
        self.vader = vader if vader is not None else get_vader()
        self.hostile_terms = list(hostile_terms if hostile_terms is not None else HOSTILE_TERMS)
        self.coop_terms = list(coop_terms if coop_terms is not None else COOPERATIVE_TERMS)
        self.hostile_rx = build_regex(self.hostile_terms)
        self.coop_rx = build_regex(self.coop_terms)

    def score(self, text):
        """Return (totals: dict of counts, sentences: list of SentenceScore)."""
        clean = clean_text(text)
        sentences = [
            SentenceScore(i, s, float(self.vader.polarity_scores(s)["compound"]),
                          len(self.hostile_rx.findall(s)), len(self.coop_rx.findall(s)))
            for i, s in enumerate(split_sentences(clean))
        ]
        totals = {
            "words": len(clean.split()),
            "sentences": len(sentences),
            "hostile_hits": len(self.hostile_rx.findall(clean)),
            "coop_hits": len(self.coop_rx.findall(clean)),
            "vader_sum": sum(s.vader for s in sentences),
            "negative_sentences": sum(1 for s in sentences if s.vader <= NEGATIVE_THRESHOLD),
        }
        return totals, sentences


def _ratio(numerator, denominator, scale=1.0):
    return numerator / denominator * scale if denominator else None


def add_metrics(row: Mapping):
    """From the count columns (COUNT_COLUMNS) → normalised metrics (per 1,000 words, shares...).

    Returns a new dict. A metric that cannot be computed (division by zero) is None.
    """
    t = dict(row)
    words, sentences = row.get("words") or 0, row.get("sentences") or 0
    hostile, coop = row.get("hostile_hits") or 0, row.get("coop_hits") or 0
    t["hostility"] = _ratio(hostile, words, 1000)
    t["cooperation"] = _ratio(coop, words, 1000)
    t["tone_balance"] = _ratio(coop - hostile, coop + hostile)
    t["vader_mean"] = _ratio(row.get("vader_sum") or 0.0, sentences)
    t["negative_share"] = _ratio(row.get("negative_sentences") or 0, sentences)
    for key in [k for k in row if k.startswith(KEYWORD_COUNT_PREFIX)]:
        t[KEYWORD_PREFIX + key[len(KEYWORD_COUNT_PREFIX):]] = _ratio(row[key] or 0, words, 1000)
    return t


def aggregate_by_year(rows: Iterable[Mapping]):
    """Add up several texts to country–year level (sum counts FIRST), then compute metrics."""
    groups = {}
    for row in rows:
        key = (row["country"], int(row["year"]))
        g = groups.setdefault(key, {"country": key[0], "year": key[1], "documents": 0,
                                    **{c: 0 for c in COUNT_COLUMNS}})
        g["documents"] += 1
        for col, value in row.items():
            if col in COUNT_COLUMNS or col.startswith(KEYWORD_COUNT_PREFIX):
                g[col] = g.get(col, 0) + (value or 0)
    return [add_metrics(groups[k]) for k in sorted(groups)]


def keyword_regexes(keywords):
    return {KEYWORD_COUNT_PREFIX + kw: build_regex([kw]) for kw in keywords}


def count_keywords(clean, regexes):
    return {col: len(rx.findall(clean)) for col, rx in regexes.items()}


def key_sentences(sentences, n=3, max_len=600):
    """Pick the sentences most worth reading: most hostile, most negative (VADER), most cooperative.

    Returns a list of dicts with kind, score, sentence and index (position in the text).
    """
    unique, seen = [], set()
    for s in sentences:
        if s.sentence not in seen:
            seen.add(s.sentence)
            unique.append(s)
    picks = [
        ("hostile", sorted((s for s in unique if s.hostile_hits > 0),
                           key=lambda s: (-s.hostile_hits, s.vader))[:n], lambda s: s.hostile_hits),
        ("negative", sorted((s for s in unique if s.vader <= NEGATIVE_THRESHOLD),
                            key=lambda s: s.vader)[:n], lambda s: s.vader),
        ("cooperative", sorted((s for s in unique if s.coop_hits > 0),
                               key=lambda s: (-s.coop_hits, -s.vader))[:n], lambda s: s.coop_hits),
    ]
    return [{"kind": kind, "score": score(s), "sentence": s.sentence[:max_len], "index": s.index}
            for kind, chosen, score in picks for s in chosen]


def biggest_shifts(yearly: Iterable[Mapping], column, n=8):
    """Largest changes from the previous year with data, per country."""
    by_country = {}
    for row in yearly:
        if row.get(column) is not None:
            by_country.setdefault(row["country"], []).append(row)
    shifts = []
    for country, rows in by_country.items():
        rows = sorted(rows, key=lambda r: r["year"])
        for before, after in zip(rows, rows[1:], strict=False):
            shifts.append({"country": country, "from_year": int(before["year"]), "year": int(after["year"]),
                           "from_value": before[column], "value": after[column],
                           "change": after[column] - before[column]})
    shifts.sort(key=lambda s: abs(s["change"]), reverse=True)
    return shifts[:n]


# ─────────────────────────────────────────────────────────────────────────────
# 4. DISPLAY HELPERS: highlighting & most frequent terms
# ─────────────────────────────────────────────────────────────────────────────
def highlight_spans(text, hostile_rx, coop_rx):
    """Non-overlapping [start, end, kind] spans of dictionary hits, in text order.

    The frontend renders these as highlighted text, so no HTML is ever built on the server.
    """
    matches = [(m.start(), m.end(), "hostile") for m in hostile_rx.finditer(text)]
    matches += [(m.start(), m.end(), "cooperative") for m in coop_rx.finditer(text)]
    matches.sort()
    spans, pos = [], 0
    for start, end, kind in matches:
        if start < pos:          # skip overlapping matches
            continue
        spans.append((start, end, kind))
        pos = end
    return spans


def top_terms(text, regex, n=10):
    counts = Counter(re.sub(r"\s+", " ", m.lower()) for m in regex.findall(text))
    return counts.most_common(n)

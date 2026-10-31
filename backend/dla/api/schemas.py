"""Request and response models (they also generate the API docs at /api/docs)."""
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from .. import config

Metrics = dict[str, float | None]


class Counts(BaseModel):
    words: int
    sentences: int
    hostile_hits: int
    coop_hits: int
    vader_sum: float
    negative_sentences: int


# ── Meta ──────────────────────────────────────────────────────────────────────────────────────
class MetricInfo(BaseModel):
    id: str
    label: str
    explanation: str
    higher_is_worse: bool


class EventInfo(BaseModel):
    year: int
    label: str


class ContextModelInfo(BaseModel):
    available: bool
    name: str | None = None


class Meta(BaseModel):
    version: str
    metrics: list[MetricInfo]
    default_dictionaries: dict[str, list[str]]
    default_keywords: list[str]
    events: list[EventInfo]
    limits: dict[str, int]
    context_model: ContextModelInfo
    citation: str


class Health(BaseModel):
    status: str
    database: str
    un_data: dict | None = None
    version: str


# ── Analyze ───────────────────────────────────────────────────────────────────────────────────
class AnalyzeRequest(BaseModel):
    text: str = Field(max_length=config.MAX_TEXT_CHARS)
    hostile_terms: list[str] | None = Field(default=None, description="Custom hostile dictionary")
    coop_terms: list[str] | None = Field(default=None, description="Custom cooperative dictionary")
    context_model: bool = Field(default=False, description="Also run the transformer model (local only)")


class SentenceOut(BaseModel):
    index: int
    sentence: str
    vader: float
    hostile_hits: int
    coop_hits: int
    context: dict | None = None


class ReadingSentence(BaseModel):
    text: str
    index: int | None = Field(description="Number of the scored sentence (null for pieces under 4 words)")
    highlights: list[tuple[int, int, str]]


Reading = list[list[ReadingSentence]]   # paragraphs of sentences, the whole text in order


class Baseline(BaseModel):
    first_year: int
    last_year: int
    statements: int
    averages: Metrics
    median_words: int | None = Field(default=None, description="Median length of those statements, in words")
    hostility_share_below: float | None = Field(
        description="Share of UN statements in the baseline years that are less hostile than this text")
    cooperation_share_below: float | None = Field(
        default=None, description="Share of those statements with fewer cooperative words per 1,000 than this text")
    tone_share_below: float | None = Field(
        default=None, description="Share of those statements with a lower tone balance than this text")
    tone_histogram: list[int] = Field(
        default_factory=list, description="Those statements counted in 20 bands of tone balance, −1 to +1")


class AnalyzeResponse(BaseModel):
    counts: Counts
    metrics: Metrics
    default_dictionaries: bool
    baseline: Baseline | None
    highlights: list[tuple[int, int, str]]
    reading: Reading
    top_terms: dict[str, list[tuple[str, int]]]
    sentences: list[SentenceOut]
    context_model: dict
    warnings: list[str] = []


class ExtractedText(BaseModel):
    filename: str
    text: str
    characters: int
    pages: int | None = None
    truncated: bool = False


# ── UN data ───────────────────────────────────────────────────────────────────────────────────
class CountryInfo(BaseModel):
    code: str
    name: str
    first_year: int
    last_year: int
    statements: int


class UNSummary(BaseModel):
    loaded: bool
    demo: bool = False
    statements: int = 0
    first_year: int | None = None
    last_year: int | None = None
    countries: list[CountryInfo] = []
    keywords: list[str] = []
    loaded_at: datetime | None = None


class Point(BaseModel):
    year: int
    value: float | None


class Series(BaseModel):
    country: str
    name: str
    points: list[Point]


class SeriesResponse(BaseModel):
    metric: str
    series: list[Series]
    average: list[Point] | None = None


class CountryRef(BaseModel):
    code: str
    name: str


class Matrix(BaseModel):
    metric: str
    years: list[int]
    countries: list[CountryRef]
    values: dict[str, list[float | None]]


class Shift(BaseModel):
    country: str
    name: str
    from_year: int
    year: int
    from_value: float
    value: float
    change: float


class RankingRow(BaseModel):
    rank: int
    country: str
    name: str
    value: float


class TermCount(BaseModel):
    kind: str
    term: str
    hits: int
    statements: int


class TermCounts(BaseModel):
    statements: int
    first_year: int | None = None
    last_year: int | None = None
    terms: list[TermCount]


class Ranking(BaseModel):
    year: int
    metric: str
    rows: list[RankingRow]


class NotableSentence(BaseModel):
    kind: str
    score: float
    position: int
    sentence: str
    highlights: list[tuple[int, int, str]]


class Statement(BaseModel):
    country: str
    name: str
    year: int
    session: int
    counts: Counts
    metrics: Metrics
    keywords: dict[str, float | None]
    sentences: list[NotableSentence]


class StatementText(BaseModel):
    country: str
    year: int
    reading: Reading


# ── Datasets ──────────────────────────────────────────────────────────────────────────────────
class DatasetCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    keywords: list[str] = Field(default_factory=list)
    hostile_terms: list[str] | None = None
    coop_terms: list[str] | None = None


class DocumentIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    country: str = Field(max_length=8)
    year: int
    text: str = Field(max_length=config.MAX_TEXT_CHARS)
    source: str | None = Field(default=None, max_length=200)
    title: str | None = Field(default=None, max_length=300)


class DocumentBatch(BaseModel):
    documents: list[DocumentIn] = Field(min_length=1, max_length=config.MAX_BATCH_DOCUMENTS)


class RowProblem(BaseModel):
    row: int
    reason: str


class BatchResult(BaseModel):
    added: int
    skipped: list[RowProblem]
    total_documents: int


class DatasetOut(BaseModel):
    id: str
    name: str
    created_at: datetime
    updated_at: datetime
    keywords: list[str]
    hostile_terms: list[str]
    coop_terms: list[str]
    uses_default_dictionaries: bool
    documents: int
    countries: list[str]
    first_year: int | None
    last_year: int | None
    stale_documents: int


class DatasetCreated(BaseModel):
    dataset: DatasetOut
    edit_token: str = Field(description="Keep this: it is needed to add, rescore or delete. Shown once.")


class DocumentSummary(BaseModel):
    id: int
    country: str
    year: int
    source: str | None
    title: str | None
    preview: str
    counts: Counts
    metrics: Metrics


class DocumentPage(BaseModel):
    total: int
    items: list[DocumentSummary]


class RescoreRequest(BaseModel):
    hostile_terms: list[str] | None = None
    coop_terms: list[str] | None = None
    keywords: list[str] | None = None


class RescoreResult(BaseModel):
    rescored: int
    remaining: int

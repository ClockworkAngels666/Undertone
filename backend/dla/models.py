"""Database tables. Change them only together with a new Alembic migration (migrations/versions)."""
from datetime import UTC, datetime

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


def utcnow():
    return datetime.now(UTC)


class Base(DeclarativeBase):
    pass


class CountsMixin:
    """Raw counts from analysis.Scorer. Metrics are always derived from these (sum first, then divide)."""

    words: Mapped[int] = mapped_column(Integer, default=0)
    sentences: Mapped[int] = mapped_column(Integer, default=0)
    hostile_hits: Mapped[int] = mapped_column(Integer, default=0)
    coop_hits: Mapped[int] = mapped_column(Integer, default=0)
    vader_sum: Mapped[float] = mapped_column(Float, default=0.0)
    negative_sentences: Mapped[int] = mapped_column(Integer, default=0)


class Country(Base):
    __tablename__ = "countries"

    code: Mapped[str] = mapped_column(String(8), primary_key=True)
    name: Mapped[str] = mapped_column(String(120))


# ── UN General Debate data (written only by the pipeline) ──────────────────────────────────────
class UNCountryYear(CountsMixin, Base):
    """One country's General Debate statement(s) in one year, scored with the default dictionaries."""

    __tablename__ = "un_country_years"
    __table_args__ = (UniqueConstraint("country_code", "year", name="uq_un_country_year"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    country_code: Mapped[str] = mapped_column(String(8), index=True)
    year: Mapped[int] = mapped_column(Integer, index=True)
    session: Mapped[int] = mapped_column(Integer)
    documents: Mapped[int] = mapped_column(Integer, default=1)
    # Stored copies of the metrics so the database can average and rank them directly.
    hostility: Mapped[float | None] = mapped_column(Float)
    cooperation: Mapped[float | None] = mapped_column(Float)
    tone_balance: Mapped[float | None] = mapped_column(Float)
    vader_mean: Mapped[float | None] = mapped_column(Float)
    negative_share: Mapped[float | None] = mapped_column(Float)

    keywords: Mapped[list["UNKeywordRate"]] = relationship(
        back_populates="country_year", cascade="all, delete-orphan", passive_deletes=True)


class UNKeywordRate(Base):
    __tablename__ = "un_keyword_rates"
    __table_args__ = (Index("ix_un_keyword_rates_keyword", "keyword"),)

    country_year_id: Mapped[int] = mapped_column(
        ForeignKey("un_country_years.id", ondelete="CASCADE"), primary_key=True)
    keyword: Mapped[str] = mapped_column(String(80), primary_key=True)
    hits: Mapped[int] = mapped_column(Integer)
    per_1000: Mapped[float | None] = mapped_column(Float)

    country_year: Mapped[UNCountryYear] = relationship(back_populates="keywords")


class UNSentence(Base):
    """The most hostile, most negative and most cooperative sentences of each statement."""

    __tablename__ = "un_sentences"
    __table_args__ = (Index("ix_un_sentences_country_year", "country_code", "year"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    country_code: Mapped[str] = mapped_column(String(8))
    year: Mapped[int] = mapped_column(Integer)
    kind: Mapped[str] = mapped_column(String(16))          # hostile | negative | cooperative
    score: Mapped[float] = mapped_column(Float)
    position: Mapped[int] = mapped_column(Integer)          # sentence number within the statement
    sentence: Mapped[str] = mapped_column(Text)


class PipelineRun(Base):
    __tablename__ = "pipeline_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    source: Mapped[str] = mapped_column(String(200))        # archive file name, or "demo"
    source_md5: Mapped[str | None] = mapped_column(String(32))
    dictionary_fingerprint: Mapped[str] = mapped_column(String(64))
    speeches: Mapped[int] = mapped_column(Integer)
    countries: Mapped[int] = mapped_column(Integer)
    first_year: Mapped[int] = mapped_column(Integer)
    last_year: Mapped[int] = mapped_column(Integer)
    finished_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


# ── User datasets ────────────────────────────────────────────────────────────────────────────
class Dataset(Base):
    """Texts a visitor uploaded. Anyone with the id can view it; changes need the edit token."""

    __tablename__ = "datasets"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    edit_token_hash: Mapped[str] = mapped_column(String(64))
    hostile_terms: Mapped[list[str]] = mapped_column(JSON)
    coop_terms: Mapped[list[str]] = mapped_column(JSON)
    keywords: Mapped[list[str]] = mapped_column(JSON)
    uses_default_dictionaries: Mapped[bool] = mapped_column(Boolean, default=True)
    scoring_version: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    documents: Mapped[list["Document"]] = relationship(
        back_populates="dataset", cascade="all, delete-orphan", passive_deletes=True)


class Document(CountsMixin, Base):
    __tablename__ = "documents"
    __table_args__ = (Index("ix_documents_dataset_country_year", "dataset_id", "country_code", "year"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    dataset_id: Mapped[str] = mapped_column(ForeignKey("datasets.id", ondelete="CASCADE"))
    country_code: Mapped[str] = mapped_column(String(8))
    year: Mapped[int] = mapped_column(Integer)
    source: Mapped[str | None] = mapped_column(String(200))
    title: Mapped[str | None] = mapped_column(String(300))
    text: Mapped[str] = mapped_column(Text)
    keyword_counts: Mapped[dict[str, int]] = mapped_column(JSON, default=dict)
    scoring_version: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    dataset: Mapped[Dataset] = relationship(back_populates="documents")

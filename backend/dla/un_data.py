"""Queries over the pre-scored UN General Debate data."""
import bisect
import statistics
import time

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .analysis import KEYWORD_PREFIX, METRICS
from .models import PipelineRun, UNCountryYear, UNKeywordRate

BASELINE_YEARS = 10
_CACHE_SECONDS = 600
_baseline_cache: dict = {}


class UnknownMetric(ValueError):
    pass


def metric_column(metric: str):
    """(column, keyword): a stored metric column, or the keyword rate column plus its keyword."""
    if metric in METRICS:
        return getattr(UNCountryYear, metric), None
    if metric.startswith(KEYWORD_PREFIX) and len(metric) > len(KEYWORD_PREFIX):
        return UNKeywordRate.per_1000, metric[len(KEYWORD_PREFIX):]
    raise UnknownMetric(f"Unknown metric “{metric}”.")


def metric_query(metric: str, *columns):
    """SELECT columns + the metric value, joined to the keyword table when needed."""
    column, keyword = metric_column(metric)
    query = select(*columns, column.label("value"))
    if keyword is not None:
        query = query.join(UNKeywordRate, UNKeywordRate.country_year_id == UNCountryYear.id).where(
            UNKeywordRate.keyword == keyword)
    return query


def keywords(session: Session) -> list[str]:
    """The pre-counted keywords (the pipeline stores every keyword for every country-year)."""
    first_id = select(func.min(UNKeywordRate.country_year_id)).scalar_subquery()
    return list(session.scalars(select(UNKeywordRate.keyword).where(UNKeywordRate.country_year_id == first_id)
                                .order_by(UNKeywordRate.keyword)))


def latest_run(session: Session) -> PipelineRun | None:
    return session.scalars(select(PipelineRun).order_by(PipelineRun.id.desc()).limit(1)).first()


def baseline(session: Session):
    """Averages over the last BASELINE_YEARS years of UN statements (cached for a few minutes)."""
    cached = _baseline_cache.get("value")
    if cached is not None and time.monotonic() - _baseline_cache["at"] < _CACHE_SECONDS:
        return cached
    last_year = session.scalar(select(func.max(UNCountryYear.year)))
    value = None
    if last_year is not None:
        first_year = last_year - BASELINE_YEARS + 1
        recent = UNCountryYear.year >= first_year
        row = session.execute(select(func.count(), *[func.avg(getattr(UNCountryYear, m)) for m in METRICS])
                              .where(recent)).one()
        def sorted_values(column):
            return sorted(session.scalars(select(column).where(recent, column.is_not(None))))
        words = sorted_values(UNCountryYear.words)
        value = {
            "first_year": first_year,
            "last_year": last_year,
            "statements": row[0],
            "averages": {m: (float(v) if v is not None else None) for m, v in zip(METRICS, row[1:], strict=True)},
            "median_words": int(statistics.median(words)) if words else None,
            "_hostility": sorted_values(UNCountryYear.hostility),
            "_cooperation": sorted_values(UNCountryYear.cooperation),
            "_tone_balance": sorted_values(UNCountryYear.tone_balance),
        }
        value["tone_histogram"] = tone_histogram(value["_tone_balance"])
    _baseline_cache.update(value=value, at=time.monotonic())
    return value


def share_below(base, metric, value):
    """Share of baseline statements with a lower value of `metric` ("hostility" or "cooperation") than `value`."""
    values = base[f"_{metric}"]
    if value is None or not values:
        return None
    return bisect.bisect_left(values, value) / len(values)


TONE_BINS = 20                  # tone balance runs from −1 to +1: bins 0.1 wide


def tone_histogram(values):
    """How many statements fall in each 0.1-wide band of tone balance, from −1 to +1."""
    counts = [0] * TONE_BINS
    for v in values:
        counts[min(TONE_BINS - 1, max(0, int((v + 1) / 2 * TONE_BINS)))] += 1
    return counts


def hostility_share_below(base, hostility):
    """Share of baseline statements less hostile than the given value."""
    return share_below(base, "hostility", hostility)


def clear_cache():
    _baseline_cache.clear()

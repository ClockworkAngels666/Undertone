"""Queries over the pre-scored UN General Debate data."""
import bisect
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
    return list(session.scalars(select(UNKeywordRate.keyword).distinct().order_by(UNKeywordRate.keyword)))


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
        hostility = sorted(session.scalars(select(UNCountryYear.hostility).where(
            recent, UNCountryYear.hostility.is_not(None))))
        value = {
            "first_year": first_year,
            "last_year": last_year,
            "statements": row[0],
            "averages": {m: (float(v) if v is not None else None) for m, v in zip(METRICS, row[1:], strict=True)},
            "_hostility": hostility,
        }
    _baseline_cache.update(value=value, at=time.monotonic())
    return value


def hostility_share_below(base, hostility):
    """Share of baseline statements less hostile than the given value."""
    values = base["_hostility"]
    if hostility is None or not values:
        return None
    return bisect.bisect_left(values, hostility) / len(values)


def clear_cache():
    _baseline_cache.clear()

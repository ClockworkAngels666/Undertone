"""Explore the pre-scored UN General Debate Corpus: trends, shifts, close reading, rankings, export."""
import csv
import io

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ... import analysis, config, un_data
from ...countries import country_name, normalize_code
from ...models import UNCountryYear, UNKeywordRate, UNSentence
from ..deps import get_db, public_cache
from ..schemas import Ranking, SeriesResponse, Shift, Statement, UNSummary

router = APIRouter(prefix="/un", tags=["un"], dependencies=[Depends(public_cache)])

CountriesParam = Query(default="", description="Comma-separated country codes, e.g. RUS,USA,CHN")


def parse_countries(value: str, limit=config.MAX_CHART_COUNTRIES):
    codes = list(dict.fromkeys(normalize_code(c) for c in value.split(",") if c.strip()))
    if len(codes) > limit:
        raise HTTPException(status_code=422, detail=f"Choose at most {limit} countries.")
    return codes


def check_metric(metric: str):
    try:
        return un_data.metric_column(metric)
    except un_data.UnknownMetric as err:
        raise HTTPException(status_code=422, detail=str(err)) from err


def year_range(start: int | None, end: int | None):
    if start is not None and end is not None and start > end:
        raise HTTPException(status_code=422, detail="The start year must not be after the end year.")
    return start if start is not None else 0, end if end is not None else 9999


@router.get("/summary", response_model=UNSummary)
def summary(db: Session = Depends(get_db)):
    """Which countries and years are loaded, and which keywords were pre-counted."""
    run = un_data.latest_run(db)
    if run is None:
        return {"loaded": False}
    rows = db.execute(select(UNCountryYear.country_code, func.min(UNCountryYear.year),
                             func.max(UNCountryYear.year), func.count())
                      .group_by(UNCountryYear.country_code)).all()
    countries = sorted(({"code": c, "name": country_name(c), "first_year": a, "last_year": b, "statements": n}
                        for c, a, b, n in rows), key=lambda c: c["name"])
    return {
        "loaded": True,
        "demo": run.source == "demo",
        "statements": sum(c["statements"] for c in countries),
        "first_year": run.first_year,
        "last_year": run.last_year,
        "countries": countries,
        "keywords": un_data.keywords(db),
        "loaded_at": run.finished_at,
    }


@router.get("/series", response_model=SeriesResponse)
def series(countries: str = CountriesParam, metric: str = "tone_balance", start: int | None = None,
           end: int | None = None, average: bool = True, db: Session = Depends(get_db)):
    """Yearly values of one metric for up to 8 countries, plus the all-country average."""
    codes = parse_countries(countries)
    column, _ = check_metric(metric)
    first, last = year_range(start, end)
    in_range = UNCountryYear.year.between(first, last)
    rows = db.execute(un_data.metric_query(metric, UNCountryYear.country_code, UNCountryYear.year)
                      .where(in_range, UNCountryYear.country_code.in_(codes))
                      .order_by(UNCountryYear.country_code, UNCountryYear.year)).all() if codes else []
    points = {code: [] for code in codes}
    for code, year, value in rows:
        points[code].append({"year": year, "value": value})
    result = {"metric": metric, "series": [{"country": c, "name": country_name(c), "points": points[c]}
                                           for c in codes]}
    if average:
        query = un_data.metric_query(metric, UNCountryYear.year).where(in_range).subquery()
        avg_rows = db.execute(select(query.c.year, func.avg(query.c.value)).group_by(query.c.year)
                              .order_by(query.c.year)).all()
        result["average"] = [{"year": y, "value": float(v) if v is not None else None} for y, v in avg_rows]
    return result


@router.get("/shifts", response_model=list[Shift])
def shifts(countries: str = CountriesParam, metric: str = "tone_balance", start: int | None = None,
           end: int | None = None, n: int = Query(default=8, ge=1, le=50), db: Session = Depends(get_db)):
    """The largest changes from one statement to the next, among the chosen countries."""
    codes = parse_countries(countries)
    check_metric(metric)
    first, last = year_range(start, end)
    rows = db.execute(un_data.metric_query(metric, UNCountryYear.country_code, UNCountryYear.year)
                      .where(UNCountryYear.year.between(first, last), UNCountryYear.country_code.in_(codes))
                      ).all() if codes else []
    yearly = [{"country": c, "year": y, metric: v} for c, y, v in rows]
    return [s | {"name": country_name(s["country"])} for s in analysis.biggest_shifts(yearly, metric, n)]


@router.get("/statements/{country}/{year}", response_model=Statement)
def statement(country: str, year: int, db: Session = Depends(get_db)):
    """Scores, keyword rates and the most notable sentences of one country's statement."""
    code = normalize_code(country)
    row = db.scalars(select(UNCountryYear).where(UNCountryYear.country_code == code,
                                                 UNCountryYear.year == year)).first()
    if row is None:
        raise HTTPException(status_code=404, detail=f"No General Debate statement for {code} in {year}.")
    counts = {c: getattr(row, c) for c in analysis.COUNT_COLUMNS}
    hostile_rx, coop_rx = analysis.build_regex(analysis.HOSTILE_TERMS), analysis.build_regex(
        analysis.COOPERATIVE_TERMS)
    sentences = db.scalars(select(UNSentence).where(UNSentence.country_code == code, UNSentence.year == year)
                           .order_by(UNSentence.id)).all()
    return {
        "country": code,
        "name": country_name(code),
        "year": year,
        "session": row.session,
        "counts": counts,
        "metrics": {m: getattr(row, m) for m in analysis.METRICS},
        "keywords": {k.keyword: k.per_1000 for k in sorted(row.keywords, key=lambda k: k.keyword)},
        "sentences": [{"kind": s.kind, "score": s.score, "position": s.position, "sentence": s.sentence,
                       "highlights": analysis.highlight_spans(s.sentence, hostile_rx, coop_rx)}
                      for s in sentences],
    }


@router.get("/ranking", response_model=Ranking)
def ranking(year: int, metric: str = "tone_balance", db: Session = Depends(get_db)):
    """All countries in one year, ranked by a metric (highest first)."""
    check_metric(metric)
    query = un_data.metric_query(metric, UNCountryYear.country_code).where(UNCountryYear.year == year)
    rows = sorted(((c, v) for c, v in db.execute(query).all() if v is not None), key=lambda r: -r[1])
    return {"year": year, "metric": metric,
            "rows": [{"rank": i, "country": c, "name": country_name(c), "value": v}
                     for i, (c, v) in enumerate(rows, 1)]}


@router.get("/export.csv", response_class=Response)
def export_csv(countries: str = CountriesParam, start: int | None = None, end: int | None = None,
               db: Session = Depends(get_db)):
    """All metrics and keyword rates per country and year, as CSV (all countries if none are given)."""
    codes = parse_countries(countries, limit=500)
    first, last = year_range(start, end)
    selected = [UNCountryYear.year.between(first, last)]
    if codes:
        selected.append(UNCountryYear.country_code.in_(codes))
    stored = ["id", "country_code", "year", "session", "documents", *analysis.COUNT_COLUMNS, *analysis.METRICS]
    rows = db.execute(select(*[getattr(UNCountryYear, c) for c in stored]).where(*selected)
                      .order_by(UNCountryYear.country_code, UNCountryYear.year)).all()
    keywords = un_data.keywords(db)
    rates = {}
    for country_year_id, keyword, value in db.execute(
            select(UNKeywordRate.country_year_id, UNKeywordRate.keyword, UNKeywordRate.per_1000)
            .join(UNCountryYear, UNKeywordRate.country_year_id == UNCountryYear.id).where(*selected)):
        rates[(country_year_id, keyword)] = value
    columns = (["country", "country_name", "year", "session", "documents", *analysis.COUNT_COLUMNS,
                *analysis.METRICS, *[analysis.KEYWORD_PREFIX + k for k in keywords]])
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(columns)
    for row_id, code, *values in rows:
        writer.writerow([code, country_name(code), *values, *[rates.get((row_id, k)) for k in keywords]])
    return Response(content="\ufeff" + buffer.getvalue(), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": 'attachment; filename="un_general_debate_scores.csv"'})

"""
User datasets: texts uploaded in batches, scored on arrival, compared over time.

There are no accounts. A dataset is reachable by its random id; adding, rescoring and deleting
also need the edit token returned once at creation (stored only as a hash).
"""
import csv
import hashlib
import hmac
import io
import secrets
import uuid

from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from fastapi.responses import Response
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from ... import analysis, config
from ...countries import country_name, is_valid_code, normalize_code
from ...models import Dataset, Document, utcnow
from ..deps import get_db
from ..schemas import (
    BatchResult,
    DatasetCreate,
    DatasetCreated,
    DatasetOut,
    DocumentBatch,
    DocumentPage,
    RescoreRequest,
    RescoreResult,
)
from .analyze import dictionaries

router = APIRouter(prefix="/datasets", tags=["datasets"])

MIN_YEAR, MAX_YEAR = 1800, 2100


def _cell(value):
    """Neutralise spreadsheet formulas in user-supplied text cells (CSV injection)."""
    if isinstance(value, str) and value[:1] in ('=', '+', '-', '@', "\t", "\r"):
        return "'" + value
    return value


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _keywords(values):
    keywords = analysis.normalize_terms(values or [])
    try:
        analysis.validate_terms(keywords, "keyword list")
    except ValueError as err:
        raise HTTPException(status_code=422, detail=str(err)) from err
    return keywords


def get_dataset(dataset_id: str, db: Session) -> Dataset:
    dataset = db.get(Dataset, dataset_id)
    if dataset is None:
        raise HTTPException(status_code=404, detail="Dataset not found. It may have been deleted.")
    return dataset


def editable_dataset(dataset_id: str, db: Session, token: str | None) -> Dataset:
    dataset = get_dataset(dataset_id, db)
    if not token or not hmac.compare_digest(_hash(token), dataset.edit_token_hash):
        raise HTTPException(status_code=403, detail="This dataset can only be changed with its edit token.")
    return dataset


def dataset_out(dataset: Dataset, db: Session):
    docs = Document.dataset_id == dataset.id
    total, first, last = db.execute(select(func.count(), func.min(Document.year), func.max(Document.year))
                                    .where(docs)).one()
    countries = list(db.scalars(select(Document.country_code).where(docs).distinct()
                                .order_by(Document.country_code)))
    stale = db.scalar(select(func.count()).where(docs, Document.scoring_version != dataset.scoring_version))
    return {
        "id": dataset.id, "name": dataset.name, "created_at": dataset.created_at,
        "updated_at": dataset.updated_at, "keywords": dataset.keywords, "hostile_terms": dataset.hostile_terms,
        "coop_terms": dataset.coop_terms, "uses_default_dictionaries": dataset.uses_default_dictionaries,
        "documents": total, "countries": countries, "first_year": first, "last_year": last,
        "stale_documents": stale,
    }


def score_document(doc: Document, scorer: analysis.Scorer, kw_regexes, version: int):
    counts, _ = scorer.score(doc.text)
    for column, value in counts.items():
        setattr(doc, column, value)
    clean = analysis.clean_text(doc.text)
    doc.keyword_counts = {k[len(analysis.KEYWORD_COUNT_PREFIX):]: v
                          for k, v in analysis.count_keywords(clean, kw_regexes).items()}
    doc.scoring_version = version
    return counts


def document_rows(db: Session, dataset: Dataset):
    """Per-document counts in the shape analysis.aggregate_by_year expects (no texts loaded)."""
    query = select(Document.country_code, Document.year, Document.keyword_counts,
                   *[getattr(Document, c) for c in analysis.COUNT_COLUMNS]).where(Document.dataset_id == dataset.id)
    for country, year, kw_counts, *counts in db.execute(query):
        row = {"country": country, "year": year, **dict(zip(analysis.COUNT_COLUMNS, counts, strict=True))}
        for keyword in dataset.keywords:
            row[analysis.KEYWORD_COUNT_PREFIX + keyword] = (kw_counts or {}).get(keyword, 0)
        yield row


@router.post("", response_model=DatasetCreated, status_code=status.HTTP_201_CREATED)
def create_dataset(body: DatasetCreate, db: Session = Depends(get_db)):
    """Create an empty dataset. Save the returned edit token: it is shown only once."""
    hostile, coop = dictionaries(body.hostile_terms, body.coop_terms)
    token = secrets.token_urlsafe(24)
    dataset = Dataset(id=str(uuid.uuid4()), name=body.name.strip(), edit_token_hash=_hash(token),
                      hostile_terms=hostile, coop_terms=coop, keywords=_keywords(body.keywords),
                      uses_default_dictionaries=analysis.is_default_dictionaries(hostile, coop))
    db.add(dataset)
    db.commit()
    return {"dataset": dataset_out(dataset, db), "edit_token": token}


@router.get("/{dataset_id}", response_model=DatasetOut)
def read_dataset(dataset_id: str, db: Session = Depends(get_db)):
    return dataset_out(get_dataset(dataset_id, db), db)


@router.delete("/{dataset_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_dataset(dataset_id: str, db: Session = Depends(get_db),
                   x_edit_token: str | None = Header(default=None)):
    """Delete a dataset and all its texts."""
    dataset = editable_dataset(dataset_id, db, x_edit_token)
    db.execute(delete(Document).where(Document.dataset_id == dataset.id))
    db.delete(dataset)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{dataset_id}/documents", response_model=BatchResult)
def add_documents(dataset_id: str, batch: DocumentBatch, db: Session = Depends(get_db),
                  x_edit_token: str | None = Header(default=None)):
    """Add up to 100 texts (send larger CSVs in several batches). Each text is scored on arrival."""
    dataset = editable_dataset(dataset_id, db, x_edit_token)
    existing = db.scalar(select(func.count()).where(Document.dataset_id == dataset.id))
    if existing + len(batch.documents) > config.MAX_DATASET_DOCUMENTS:
        raise HTTPException(status_code=413, detail=(
            f"A dataset can hold at most {config.MAX_DATASET_DOCUMENTS:,} texts "
            f"(this one has {existing:,})."))
    if db.scalar(select(func.count()).select_from(Document)) + len(batch.documents) > config.MAX_TOTAL_DOCUMENTS:
        raise HTTPException(status_code=507, detail="The app's storage is full. Please try again later.")

    scorer = analysis.Scorer(dataset.hostile_terms, dataset.coop_terms)
    kw_regexes = analysis.keyword_regexes(dataset.keywords)
    added, skipped = 0, []
    for i, item in enumerate(batch.documents):
        code = normalize_code(item.country)
        if not is_valid_code(code):
            skipped.append({"row": i, "reason": f"“{item.country}” is not a country code (use e.g. VNM, CHN)."})
            continue
        if not MIN_YEAR <= item.year <= MAX_YEAR:
            skipped.append({"row": i, "reason": f"{item.year} is not a plausible year."})
            continue
        if not item.text.strip():
            skipped.append({"row": i, "reason": "The text is empty."})
            continue
        doc = Document(dataset_id=dataset.id, country_code=code, year=item.year, text=item.text,
                       source=item.source or None, title=item.title or None)
        if score_document(doc, scorer, kw_regexes, dataset.scoring_version)["sentences"] == 0:
            skipped.append({"row": i, "reason": "Too short: needs at least one sentence of 4+ words."})
            continue
        db.add(doc)
        added += 1
    dataset.updated_at = utcnow()
    db.commit()
    return {"added": added, "skipped": skipped, "total_documents": existing + added}


@router.get("/{dataset_id}/documents", response_model=DocumentPage)
def list_documents(dataset_id: str, offset: int = Query(default=0, ge=0),
                   limit: int = Query(default=50, ge=1, le=200), db: Session = Depends(get_db)):
    """The dataset's texts with their scores (texts shortened to a preview)."""
    dataset = get_dataset(dataset_id, db)
    where = Document.dataset_id == dataset.id
    total = db.scalar(select(func.count()).where(where))
    docs = db.scalars(select(Document).where(where).order_by(Document.country_code, Document.year, Document.id)
                      .offset(offset).limit(limit)).all()
    items = []
    for d in docs:
        counts = {c: getattr(d, c) for c in analysis.COUNT_COLUMNS}
        metrics = analysis.add_metrics(counts)
        items.append({"id": d.id, "country": d.country_code, "year": d.year, "source": d.source,
                      "title": d.title, "preview": d.text[:240], "counts": counts,
                      "metrics": {m: metrics[m] for m in analysis.METRICS}})
    return {"total": total, "items": items}


@router.delete("/{dataset_id}/documents/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_document(dataset_id: str, document_id: int, db: Session = Depends(get_db),
                    x_edit_token: str | None = Header(default=None)):
    dataset = editable_dataset(dataset_id, db, x_edit_token)
    result = db.execute(delete(Document).where(Document.id == document_id, Document.dataset_id == dataset.id))
    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="Text not found in this dataset.")
    dataset.updated_at = utcnow()
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{dataset_id}/yearly")
def yearly(dataset_id: str, db: Session = Depends(get_db)):
    """Country–year totals: counts are summed first, then the metrics are computed."""
    dataset = get_dataset(dataset_id, db)
    rows = analysis.aggregate_by_year(document_rows(db, dataset))
    for row in rows:
        row["name"] = country_name(row["country"])
    return {"keywords": dataset.keywords, "rows": rows}


@router.post("/{dataset_id}/rescore", response_model=RescoreResult)
def rescore(dataset_id: str, body: RescoreRequest | None = None, db: Session = Depends(get_db),
            x_edit_token: str | None = Header(default=None)):
    """Change the dictionaries or keywords and/or rescore the next batch of out-of-date texts.

    Call repeatedly until `remaining` is 0. Each call handles at most 200 texts.
    """
    dataset = editable_dataset(dataset_id, db, x_edit_token)
    body = body or RescoreRequest()
    if body.hostile_terms is not None or body.coop_terms is not None or body.keywords is not None:
        hostile, coop = dictionaries(
            body.hostile_terms if body.hostile_terms is not None else dataset.hostile_terms,
            body.coop_terms if body.coop_terms is not None else dataset.coop_terms)
        dataset.hostile_terms, dataset.coop_terms = hostile, coop
        dataset.uses_default_dictionaries = analysis.is_default_dictionaries(hostile, coop)
        if body.keywords is not None:
            dataset.keywords = _keywords(body.keywords)
        dataset.scoring_version += 1
        dataset.updated_at = utcnow()
    stale = Document.dataset_id == dataset.id, Document.scoring_version != dataset.scoring_version
    docs = db.scalars(select(Document).where(*stale).order_by(Document.id).limit(config.RESCORE_BATCH)).all()
    scorer = analysis.Scorer(dataset.hostile_terms, dataset.coop_terms)
    kw_regexes = analysis.keyword_regexes(dataset.keywords)
    for doc in docs:
        score_document(doc, scorer, kw_regexes, dataset.scoring_version)
    db.commit()
    remaining = db.scalar(select(func.count()).where(*stale))
    return {"rescored": len(docs), "remaining": remaining}


@router.get("/{dataset_id}/export.csv", response_class=Response)
def export_csv(dataset_id: str, level: str = Query(default="yearly", pattern="^(yearly|documents)$"),
               db: Session = Depends(get_db)):
    """Download the country–year results, or every text with its scores."""
    dataset = get_dataset(dataset_id, db)
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    kw_cols = [analysis.KEYWORD_PREFIX + k for k in dataset.keywords]
    if level == "yearly":
        columns = ["country", "country_name", "year", "documents", *analysis.COUNT_COLUMNS,
                   *analysis.METRICS, *kw_cols]
        writer.writerow(columns)
        for row in analysis.aggregate_by_year(document_rows(db, dataset)):
            row["country_name"] = country_name(row["country"])
            writer.writerow([row.get(c) for c in columns])
    else:
        columns = ["country", "year", "source", "title", *analysis.COUNT_COLUMNS, *analysis.METRICS,
                   *kw_cols, "text"]
        writer.writerow(columns)
        for d in db.scalars(select(Document).where(Document.dataset_id == dataset.id)
                            .order_by(Document.country_code, Document.year, Document.id)).yield_per(200):
            counts = {c: getattr(d, c) for c in analysis.COUNT_COLUMNS}
            for k in dataset.keywords:
                counts[analysis.KEYWORD_COUNT_PREFIX + k] = (d.keyword_counts or {}).get(k, 0)
            m = analysis.add_metrics(counts)
            writer.writerow([d.country_code, d.year, _cell(d.source), _cell(d.title),
                             *[counts[c] for c in analysis.COUNT_COLUMNS], *[m[c] for c in analysis.METRICS],
                             *[m.get(c) for c in kw_cols], _cell(d.text)])
    safe = "".join(ch if ch.isalnum() else "_" for ch in dataset.name)[:40] or "dataset"
    return Response(content="﻿" + buffer.getvalue(), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="{safe}_{level}.csv"'})

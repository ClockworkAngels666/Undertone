"""Analyze one text, and turn an uploaded .txt/.pdf file into text."""
import logging
from dataclasses import asdict

from fastapi import APIRouter, HTTPException, UploadFile

from ... import analysis, config, context_model, un_data
from ...db import new_session
from ...textio import UnreadableFile, read_upload
from ..schemas import AnalyzeRequest, AnalyzeResponse, ExtractedText

router = APIRouter(tags=["analyze"])
log = logging.getLogger("dla")


def dictionaries(hostile_terms, coop_terms):
    """The dictionaries to use: the defaults, or cleaned and validated custom lists."""
    hostile = analysis.HOSTILE_TERMS if hostile_terms is None else analysis.normalize_terms(hostile_terms)
    coop = analysis.COOPERATIVE_TERMS if coop_terms is None else analysis.normalize_terms(coop_terms)
    try:
        analysis.validate_terms(hostile, "hostile dictionary")
        analysis.validate_terms(coop, "cooperative dictionary")
    except ValueError as err:
        raise HTTPException(status_code=422, detail=str(err)) from err
    return hostile, coop


@router.post("/analyze", response_model=AnalyzeResponse)
def analyze(req: AnalyzeRequest):
    """Score one English text: metrics, highlighted words, per-sentence scores and a UN comparison."""
    if not req.text.strip():
        raise HTTPException(status_code=422, detail="The text is empty.")
    hostile, coop = dictionaries(req.hostile_terms, req.coop_terms)
    scorer = analysis.Scorer(hostile, coop)
    counts, sentences = scorer.score(req.text)
    if counts["sentences"] == 0:
        raise HTTPException(status_code=422,
                            detail="The text is too short: at least one full sentence (4+ words) is needed.")
    metrics = {m: v for m, v in analysis.add_metrics(counts).items() if m in analysis.METRICS}
    warnings = []

    # The UN comparison is only meaningful when the text was scored with the same (default) dictionaries.
    default = analysis.is_default_dictionaries(hostile, coop)
    base = None
    if default:
        try:
            with new_session() as session:
                cached = un_data.baseline(session)
            if cached is not None:
                base = {k: v for k, v in cached.items() if not k.startswith("_")}
                base["hostility_share_below"] = un_data.share_below(cached, "hostility", metrics["hostility"])
                base["cooperation_share_below"] = un_data.share_below(cached, "cooperation", metrics["cooperation"])
        except Exception as err:  # noqa: BLE001 - the analysis itself must still work without a database
            log.warning("UN baseline unavailable: %s", err)
            warnings.append("The comparison with UN speeches is unavailable right now (database offline).")
    else:
        warnings.append("Custom dictionaries are in use, so the text is not compared with UN speeches.")
    if counts["words"] < config.SHORT_TEXT_WORDS:
        median = base.get("median_words") if base else None
        typical = f" (UN statements have a median of {median:,} words)" if median else ""
        warnings.append(f"This is a short text ({counts['words']:,} words). Rates per 1,000 words swing widely below "
                        f"about {config.SHORT_TEXT_WORDS} words, so compare it with longer texts with care{typical}.")

    context = {"available": context_model.available(), "used": False, "name": None}
    out_sentences = [asdict(s) | {"context": None} for s in sentences]
    if req.context_model:
        if not context["available"]:
            warnings.append("The context model is switched off in this version of the app.")
        else:
            limit = context_model.MAX_SENTENCES
            labels = context_model.classify([s.sentence for s in sentences[:limit]])
            for row, label in zip(out_sentences, labels, strict=False):
                row["context"] = label
            context.update(used=True, name=context_model.MODEL_NAME)
            if len(sentences) > limit:
                warnings.append(f"The context model read only the first {limit} sentences.")

    return {
        "counts": counts,
        "metrics": metrics,
        "default_dictionaries": default,
        "baseline": base,
        "highlights": analysis.highlight_spans(req.text, scorer.hostile_rx, scorer.coop_rx),
        "reading": analysis.reading_text(req.text, scorer.hostile_rx, scorer.coop_rx),
        "top_terms": {"hostile": analysis.top_terms(req.text, scorer.hostile_rx),
                      "cooperative": analysis.top_terms(req.text, scorer.coop_rx)},
        "sentences": out_sentences,
        "context_model": context,
        "warnings": warnings,
    }


@router.post("/extract-text", response_model=ExtractedText)
async def extract_text(file: UploadFile):
    """Read the text out of an uploaded .txt or .pdf file (max 4 MB). Nothing is stored."""
    data = await file.read(config.MAX_UPLOAD_BYTES + 1)
    if len(data) > config.MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413,
                            detail=f"The file is larger than {config.MAX_UPLOAD_BYTES // 1_000_000} MB.")
    try:
        result = read_upload(file.filename or "", data)
    except UnreadableFile as err:
        raise HTTPException(status_code=422, detail=str(err)) from err
    text = result["text"][: config.MAX_TEXT_CHARS]
    return {"filename": file.filename or "", "text": text, "characters": len(text), "pages": result["pages"],
            "truncated": len(result["text"]) > config.MAX_TEXT_CHARS}

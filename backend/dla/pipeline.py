"""
UN General Debate Corpus pipeline: download → verify → score every statement → load into the database.

Run it from a computer or CI job (never inside a Vercel request):
    uv run python -m dla load-un                # uses data/raw/UNGDC_*.tar.gz, downloading if needed

Re-running is safe: scores are cached per archive checksum and dictionary version, and the UN tables
are replaced in ONE transaction, so the live app never sees half-loaded data.
"""
import gzip
import hashlib
import json
import os
import random
import re
import tarfile
import time
import zipfile
from collections.abc import Iterator
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import requests
from sqlalchemy import delete, insert
from sqlalchemy.orm import Session

from . import analysis, un_data
from .config import DATA_DIR
from .countries import country_name
from .models import Country, PipelineRun, UNCountryYear, UNKeywordRate, UNSentence

UNGDC_DOI = "doi:10.7910/DVN/0TJX8Y"
DATAVERSE_API = "https://dataverse.harvard.edu/api"
LANDING_PAGE = "https://doi.org/10.7910/DVN/0TJX8Y"
RAW_DIR = DATA_DIR / "raw"
CACHE_DIR = DATA_DIR / "processed"
FILENAME_PATTERN = re.compile(r"^([A-Z]{2,4})_(\d{1,3})_(\d{4})\.txt$")   # e.g. RUS_77_2022.txt
HEADERS = {"User-Agent": "diplomatic-language-analyzer/1.0 (UN General Debate research pipeline)"}
NOTABLE_PER_KIND = 5
SCORING_VERSION = "2026-10-1"     # bump when the scoring code changes in a way that alters results


class PipelineError(RuntimeError):
    pass


def log(message):
    try:
        print(message, flush=True)
    except UnicodeEncodeError:          # e.g. a Windows console without UTF-8: drop the symbols
        print(message.encode("ascii", "ignore").decode().strip(), flush=True)


# ── Download & verify ─────────────────────────────────────────────────────────────────────────
def dataverse_archive_info(timeout=60):
    """Metadata of the corpus archive on Harvard Dataverse: id, filename, size, md5."""
    r = requests.get(f"{DATAVERSE_API}/datasets/:persistentId/", params={"persistentId": UNGDC_DOI},
                     headers=HEADERS, timeout=timeout)
    r.raise_for_status()
    version = r.json()["data"]["latestVersion"]
    archives = [f["dataFile"] for f in version["files"]
                if f["dataFile"]["filename"].lower().endswith((".tgz", ".tar.gz", ".zip"))]
    if not archives:
        raise PipelineError("No archive (.tar.gz/.zip) found in the Dataverse dataset.")
    f = max(archives, key=lambda a: a.get("filesize", 0))
    checksum = f.get("checksum") or {}
    return {"id": f["id"], "filename": f["filename"], "size": f.get("filesize"),
            "md5": checksum.get("value") if checksum.get("type") == "MD5" else f.get("md5"),
            "version": f"{version.get('versionNumber')}.{version.get('versionMinorNumber')}"}


def md5sum(path: Path) -> str:
    digest = hashlib.md5()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def find_local_archive(directory: Path = RAW_DIR) -> Path | None:
    candidates = sorted(directory.glob("UNGDC*.tar.gz")) + sorted(directory.glob("UNGDC*.tgz")) + sorted(
        directory.glob("UNGDC*.zip"))
    return candidates[-1] if candidates else None


def download(directory: Path = RAW_DIR) -> Path:
    """Download the corpus archive from Dataverse (skipped when a verified copy already exists)."""
    info = dataverse_archive_info()
    target = directory / info["filename"]
    if target.exists() and info["md5"] and md5sum(target) == info["md5"]:
        log(f"✔ {target.name} is already downloaded and matches the Dataverse checksum.")
        return target
    directory.mkdir(parents=True, exist_ok=True)
    log(f"⬇ Downloading {info['filename']} ({(info['size'] or 0) / 1e6:.0f} MB) from Harvard Dataverse...")
    with requests.get(f"{DATAVERSE_API}/access/datafile/{info['id']}", headers=HEADERS, stream=True,
                      timeout=600) as resp:
        if resp.status_code in (400, 401, 403) and "uestbook" in resp.text:
            raise PipelineError(
                "Harvard Dataverse asks every downloader to fill in a short guestbook form first, so the "
                "archive cannot be downloaded automatically.\n"
                f"  1. Open {LANDING_PAGE}\n"
                f"  2. Download {info['filename']} (fill in the guestbook)\n"
                f"  3. Put it in {directory}\n"
                "  4. Run this command again.")
        resp.raise_for_status()
        partial = target.with_suffix(target.suffix + ".part")
        with open(partial, "wb") as out:
            for chunk in resp.iter_content(chunk_size=1 << 20):
                out.write(chunk)
    partial.replace(target)
    verify(target, info)
    return target


def verify(archive: Path, info=None):
    """Compare the archive's MD5 with the checksum published on Dataverse (skipped when offline)."""
    try:
        info = info or dataverse_archive_info(timeout=20)
    except requests.RequestException:
        log("! Could not get the checksum from Dataverse; continuing without verification.")
        return None
    actual = md5sum(archive)
    if info["filename"] == archive.name and info["md5"] and actual != info["md5"]:
        raise PipelineError(f"{archive.name} is corrupt or modified: MD5 {actual} ≠ {info['md5']}.")
    log(f"✔ Checksum verified against Dataverse (version {info['version']}).")
    return actual


# ── Read & score ──────────────────────────────────────────────────────────────────────────────
def iter_statements(archive: Path) -> Iterator[tuple[str, int, int, str]]:
    """Yield (country, session, year, text) for every statement, without extracting to disk."""
    def keep(name):
        base = name.replace("\\", "/").rsplit("/", 1)[-1]
        return None if base.startswith("._") else FILENAME_PATTERN.match(base)

    if archive.name.lower().endswith(".zip"):
        with zipfile.ZipFile(archive) as z:
            for name in z.namelist():
                if m := keep(name):
                    yield m[1], int(m[2]), int(m[3]), z.read(name).decode("utf-8", errors="replace")
        return
    with tarfile.open(archive) as tar:
        for member in tar:
            if member.isfile() and (m := keep(member.name)):
                data = tar.extractfile(member).read()
                yield m[1], int(m[2]), int(m[3]), data.decode("utf-8", errors="replace")


_worker = {}


def _init_worker():
    _worker["scorer"] = analysis.Scorer()
    _worker["keywords"] = analysis.keyword_regexes(analysis.DEFAULT_KEYWORDS)


def score_statement(item):
    """Score one statement (runs in a worker process)."""
    if not _worker:
        _init_worker()
    country, session, year, text = item
    counts, sentences = _worker["scorer"].score(text)
    row = {"country": country, "session": session, "year": year, **counts,
           **analysis.count_keywords(analysis.clean_text(text), _worker["keywords"])}
    row["vader_sum"] = round(row["vader_sum"], 4)
    notable = analysis.key_sentences(sentences, n=NOTABLE_PER_KIND)
    for s in notable:
        s["score"] = round(s["score"], 4)
    return {"row": row, "sentences": notable}


def dictionary_fingerprint():
    spec = {"hostile": analysis.HOSTILE_TERMS, "coop": analysis.COOPERATIVE_TERMS,
            "keywords": analysis.DEFAULT_KEYWORDS, "negative": analysis.NEGATIVE_THRESHOLD,
            "notable": NOTABLE_PER_KIND, "version": SCORING_VERSION}
    return hashlib.sha256(json.dumps(spec, sort_keys=True).encode()).hexdigest()


def score_corpus(archive: Path, workers: int | None = None):
    statements = list(iter_statements(archive))
    if not statements:
        raise PipelineError("No statements found (expected files named like RUS_77_2022.txt).")
    workers = workers or max(1, (os.cpu_count() or 2) - 1)
    log(f"📚 Scoring {len(statements):,} statements with {workers} worker(s)...")
    started, results = time.time(), []
    if workers == 1:
        iterator = map(score_statement, statements)
        pool = None
    else:
        pool = ProcessPoolExecutor(max_workers=workers, initializer=_init_worker)
        iterator = pool.map(score_statement, statements, chunksize=32)
    try:
        for i, result in enumerate(iterator, 1):
            results.append(result)
            if i % 1000 == 0 or i == len(statements):
                rate = i / (time.time() - started)
                log(f"   {i:,}/{len(statements):,} · about {(len(statements) - i) / rate / 60:.1f} min left")
    finally:
        if pool:
            pool.shutdown()
    return results


def cached_scores(archive: Path, md5: str, workers=None, use_cache=True):
    cache = CACHE_DIR / f"ungdc_{md5[:12]}_{dictionary_fingerprint()[:12]}.json.gz"
    if use_cache and cache.exists():
        log(f"✔ Using cached scores: {cache.name}")
        with gzip.open(cache, "rt", encoding="utf-8") as fh:
            return json.load(fh)
    results = score_corpus(archive, workers)
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    with gzip.open(cache, "wt", encoding="utf-8") as fh:
        json.dump(results, fh)
    return results


# ── Load ──────────────────────────────────────────────────────────────────────────────────────
def load(session: Session, results, source: str, md5: str | None):
    """Replace all UN data with these results, in one transaction."""
    sessions = {}
    for r in results:
        key = (r["row"]["country"], r["row"]["year"])
        sessions[key] = max(sessions.get(key, 0), r["row"]["session"])
    yearly = analysis.aggregate_by_year(r["row"] for r in results)

    country_rows, keyword_rows = [], []
    for i, y in enumerate(yearly, 1):
        country_rows.append({
            "id": i, "country_code": y["country"], "year": y["year"], "session": sessions[(y["country"], y["year"])],
            "documents": y["documents"], **{c: y[c] for c in analysis.COUNT_COLUMNS},
            **{m: y[m] for m in analysis.METRICS},
        })
        for keyword in analysis.DEFAULT_KEYWORDS:
            keyword_rows.append({"country_year_id": i, "keyword": keyword,
                                 "hits": y.get(analysis.KEYWORD_COUNT_PREFIX + keyword, 0),
                                 "per_1000": y.get(analysis.KEYWORD_PREFIX + keyword)})
    sentence_rows = [{"country_code": r["row"]["country"], "year": r["row"]["year"], "kind": s["kind"],
                      "score": s["score"], "position": s["index"], "sentence": s["sentence"]}
                     for r in results for s in r["sentences"]]
    codes = sorted({y["country"] for y in yearly})

    for model in (UNKeywordRate, UNSentence, UNCountryYear, Country):
        session.execute(delete(model))
    session.execute(insert(Country), [{"code": c, "name": country_name(c)} for c in codes])
    for rows, model in ((country_rows, UNCountryYear), (keyword_rows, UNKeywordRate), (sentence_rows, UNSentence)):
        for start in range(0, len(rows), 5000):
            session.execute(insert(model), rows[start:start + 5000])
    session.add(PipelineRun(source=source, source_md5=md5, dictionary_fingerprint=dictionary_fingerprint(),
                            speeches=len(results), countries=len(codes),
                            first_year=min(y["year"] for y in yearly), last_year=max(y["year"] for y in yearly)))
    session.commit()
    un_data.clear_cache()
    return {"statements": len(results), "country_years": len(country_rows), "countries": len(codes),
            "sentences": len(sentence_rows), "first_year": min(y["year"] for y in yearly),
            "last_year": max(y["year"] for y in yearly)}


def run(session: Session, archive: Path | None = None, workers=None, use_cache=True, allow_download=True):
    archive = archive or find_local_archive()
    if archive is None:
        if not allow_download:
            raise PipelineError(f"No UNGDC archive in {RAW_DIR}.")
        archive = download()
    if not archive.exists():
        raise PipelineError(f"File not found: {archive}")
    log(f"📦 Archive: {archive}")
    md5 = verify(archive) or md5sum(archive)
    results = cached_scores(archive, md5, workers, use_cache)
    log("💾 Loading into the database (one transaction)...")
    summary = load(session, results, archive.name, md5)
    log(f"✅ Done: {summary['statements']:,} statements, {summary['countries']} countries, "
        f"{summary['first_year']}–{summary['last_year']}, {summary['sentences']:,} notable sentences.")
    return summary


# ── Demo data (tests and local development only) ──────────────────────────────────────────────
DEMO_COUNTRIES = ["VLD", "ORS", "FRD", "SYL", "BOR"]
_DEMO_SENTENCES = {
    "hostile": ["We condemn the illegal sanctions and the aggression against our sovereign people.",
                "Hegemony and interference in our internal affairs are a threat to every nation.",
                "The occupation is a violation of international law and we denounce it."],
    "cooperative": ["We welcome dialogue and mutual cooperation with all our partners.",
                    "Together we can build trust and reach a peaceful agreement on connectivity.",
                    "Our nation remains committed to multilateral solidarity and friendship."],
    "neutral": ["The delegation congratulates the President on the election to this high office.",
                "The report of the Secretary-General contains many useful recommendations for members.",
                "Our economy grew last year and new schools were opened in several provinces."],
}


def demo_results(first_year=2000, last_year=2025, seed=7):
    """Synthetic statements for fictional countries, scored by the real pipeline code."""
    rng = random.Random(seed)
    results = []
    for c, country in enumerate(DEMO_COUNTRIES):
        for year in range(first_year, last_year + 1):
            hostile_weight = 0.15 + 0.1 * c + (0.3 if year >= 2014 and c % 2 else 0)
            parts = []
            for _ in range(24):
                kind = rng.choices(["hostile", "cooperative", "neutral"], [hostile_weight, 0.4, 0.5])[0]
                parts.append(rng.choice(_DEMO_SENTENCES[kind]))
            results.append(score_statement((country, year - 1945, year, " ".join(parts))))
    return results


def seed_demo(session: Session):
    return load(session, demo_results(), "demo", None)

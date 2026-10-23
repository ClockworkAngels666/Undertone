"""
build_un_data.py – RUN ONCE to prepare the UN data for the web app.

What it does:
  1. Downloads the UN General Debate Corpus (UNGDC) from Harvard Dataverse
     (or uses a file you already downloaded).
  2. Scores EVERY speech (VADER + diplomatic dictionaries + keyword counts).
  3. Saves two compact files the web app reads instantly:
       un_scores.csv.gz     – scores for every country–year (~1 MB)
       un_sentences.csv.gz  – the most notable sentences of each speech (for close reading)

Why not let the web app do this? Scoring 10,000+ speeches takes 15–25 minutes.
Doing it once means everyone who opens the tool sees results immediately.

How to run (on Google Colab):
    !pip install -q vaderSentiment
    !python build_un_data.py                       # downloads the data automatically
    !python build_un_data.py --file UNGDC.tgz      # or use a file you downloaded yourself
"""
import argparse
import re
import tarfile
import time
import zipfile
from pathlib import Path

import pandas as pd
import requests

from analysis import (DEFAULT_KEYWORDS, Scorer, clean_text, count_keywords, key_sentences,
                      keyword_regexes)

UNGDC_DOI = "doi:10.7910/DVN/0TJX8Y"
DATAVERSE_API = "https://dataverse.harvard.edu/api"
EXTRACT_DIR = Path("ungdc_raw")
FILENAME_PATTERN = re.compile(r"^([A-Z]{2,4})_(\d{1,3})_(\d{4})\.txt$")   # e.g. RUS_77_2022.txt


def extract_archive(path, target=EXTRACT_DIR):
    path = str(path)
    Path(target).mkdir(parents=True, exist_ok=True)
    if path.lower().endswith((".tgz", ".tar.gz", ".tar")):
        with tarfile.open(path) as tar:
            try:
                tar.extractall(target, filter="data")
            except TypeError:                          # older Python versions
                tar.extractall(target)
    elif path.lower().endswith(".zip"):
        with zipfile.ZipFile(path) as z:
            z.extractall(target)
    else:
        raise ValueError(f"Unrecognised file format: {path}")


def download_from_dataverse():
    print("🔎 Asking Harvard Dataverse for the list of files...")
    r = requests.get(f"{DATAVERSE_API}/datasets/:persistentId/",
                     params={"persistentId": UNGDC_DOI}, timeout=60)
    r.raise_for_status()
    version = r.json()["data"]["latestVersion"]
    files = [f["dataFile"] for f in version["files"]]
    archives = [f for f in files if f["filename"].lower().endswith((".tgz", ".tar.gz", ".zip"))]
    if not archives:
        raise RuntimeError("No archive (.tgz/.zip) found in the dataset.")
    chosen = max(archives, key=lambda f: f.get("filesize", 0))
    target = Path(chosen["filename"])
    print(f"⬇️  Downloading {target.name} ({chosen.get('filesize', 0) / 1e6:.0f} MB)...")
    with requests.get(f"{DATAVERSE_API}/access/datafile/{chosen['id']}", stream=True, timeout=600) as resp:
        resp.raise_for_status()
        with open(target, "wb") as out:
            for chunk in resp.iter_content(chunk_size=1 << 20):
                out.write(chunk)
    return target


def main():
    p = argparse.ArgumentParser(description="Prepare the UNGDC data for the web app.")
    p.add_argument("--file", help="UNGDC archive (.tgz/.zip) you already downloaded; leave out to download.")
    p.add_argument("--out-dir", default=".", help="Where to save the two output files (default: current folder).")
    args = p.parse_args()

    if not (EXTRACT_DIR.exists() and any(EXTRACT_DIR.rglob("*.txt"))):
        archive = Path(args.file) if args.file else download_from_dataverse()
        print("📦 Extracting...")
        extract_archive(archive)

    speech_files = sorted(f for f in EXTRACT_DIR.rglob("*.txt") if FILENAME_PATTERN.match(f.name))
    if not speech_files:
        raise SystemExit("❌ No speech files found (expected names like ABC_77_2022.txt).")
    print(f"📚 Found {len(speech_files):,} speeches. Scoring them (15–25 minutes)...")

    scorer = Scorer()
    kw_regexes = keyword_regexes(DEFAULT_KEYWORDS)
    scores, notable = [], []
    started = time.time()
    for i, f in enumerate(speech_files, 1):
        country, session, year = FILENAME_PATTERN.match(f.name).groups()
        text = f.read_text(encoding="utf-8", errors="replace")
        totals, sentences = scorer.score(text)
        row = {"country": country, "session": int(session), "year": int(year), **totals}
        row.update(count_keywords(clean_text(text), kw_regexes))
        scores.append(row)
        notable.append(key_sentences(sentences).assign(country=country, year=int(year)))
        if i % 500 == 0 or i == len(speech_files):
            elapsed = time.time() - started
            print(f"   {i:,}/{len(speech_files):,} speeches – about "
                  f"{elapsed / i * (len(speech_files) - i) / 60:.0f} min left")

    out = Path(args.out_dir)
    out.mkdir(parents=True, exist_ok=True)
    score_table = pd.DataFrame(scores).sort_values(["country", "year"])
    score_table["vader_sum"] = score_table["vader_sum"].round(4)
    score_table.to_csv(out / "un_scores.csv.gz", index=False, compression="gzip")
    sentence_table = pd.concat(notable, ignore_index=True)[["country", "year", "kind", "score", "sentence"]]
    sentence_table["score"] = sentence_table["score"].round(3)
    sentence_table.to_csv(out / "un_sentences.csv.gz", index=False, compression="gzip")

    for name in ["un_scores.csv.gz", "un_sentences.csv.gz"]:
        print(f"💾 {out / name}  ({(out / name).stat().st_size / 1e6:.1f} MB)")
    print(f"✅ Done! {score_table.country.nunique()} countries, "
          f"{score_table.year.min()}–{score_table.year.max()}. Upload these two files to GitHub.")


if __name__ == "__main__":
    main()

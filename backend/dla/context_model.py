"""
Optional context-aware sentence classifier (a transformer model).

Word counting cannot tell "we condemn aggression" from "we do not seek confrontation". A zero-shot
natural-language-inference model reads the whole sentence instead. It needs PyTorch (~1 GB), so it
runs only locally: install the `context` extra and set DLA_CONTEXT_MODEL=1. The public deployment
keeps it switched off.
"""
from functools import lru_cache

from . import config

MODEL_NAME = "MoritzLaurer/deberta-v3-base-zeroshot-v2.0"
LABELS = {
    "hostile": "hostile or confrontational",
    "cooperative": "cooperative or conciliatory",
    "neutral": "neutral or procedural",
}
HYPOTHESIS = "The tone of this diplomatic statement is {}."
MAX_SENTENCES = 300


def available() -> bool:
    if not config.context_model_enabled():
        return False
    try:
        import torch  # noqa: F401
        import transformers  # noqa: F401
    except ImportError:
        return False
    return True


@lru_cache(maxsize=1)
def _pipeline():
    from transformers import pipeline

    return pipeline("zero-shot-classification", model=MODEL_NAME)


def classify(sentences, classifier=None):
    """Return one {"label", "score"} per sentence (label: hostile | cooperative | neutral)."""
    classifier = classifier or _pipeline()
    by_text = {text: key for key, text in LABELS.items()}
    results = classifier(list(sentences), candidate_labels=list(LABELS.values()),
                         hypothesis_template=HYPOTHESIS, multi_label=False)
    if isinstance(results, dict):
        results = [results]
    return [{"label": by_text[r["labels"][0]], "score": float(r["scores"][0])} for r in results]

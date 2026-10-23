"""The optional transformer model (tested with a stand-in classifier; the real one is local-only)."""
from dla import context_model


def test_off_by_default():
    assert context_model.available() is False


def test_off_on_vercel_even_when_requested(monkeypatch):
    monkeypatch.setenv("DLA_CONTEXT_MODEL", "1")
    monkeypatch.setenv("VERCEL", "1")
    assert context_model.available() is False


def test_classify_maps_labels():
    def fake_classifier(sentences, candidate_labels, hypothesis_template, multi_label):
        assert "{}" in hypothesis_template and not multi_label
        return [{"labels": [candidate_labels[1], candidate_labels[0]], "scores": [0.8, 0.2]} for _ in sentences]

    assert context_model.classify(["We do not seek confrontation."], fake_classifier) == [
        {"label": "cooperative", "score": 0.8}]

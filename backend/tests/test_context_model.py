"""The optional transformer model (tested with a stand-in classifier; the real one is local-only)."""
import pytest

from dla import context_model


def test_off_by_default():
    assert context_model.available() is False


def test_off_on_vercel_even_when_requested(monkeypatch):
    monkeypatch.setenv("DLA_CONTEXT_MODEL", "1")
    monkeypatch.setenv("VERCEL", "1")
    monkeypatch.setenv("VERCEL_ENV", "production")
    assert context_model.available() is False


def test_production_refuses_to_run_without_a_database(monkeypatch):
    from dla import config

    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.delenv("POSTGRES_URL", raising=False)
    monkeypatch.setenv("VERCEL", "1")
    monkeypatch.setenv("VERCEL_ENV", "production")
    with pytest.raises(config.ConfigError):
        config.database_url()
    monkeypatch.setenv("VERCEL_ENV", "development")          # `vercel dev` on a laptop falls back to SQLite
    assert config.database_url().startswith("sqlite:///")


def test_classify_maps_labels():
    def fake_classifier(sentences, candidate_labels, hypothesis_template, multi_label):
        assert "{}" in hypothesis_template and not multi_label
        return [{"labels": [candidate_labels[1], candidate_labels[0]], "scores": [0.8, 0.2]} for _ in sentences]

    assert context_model.classify(["We do not seek confrontation."], fake_classifier) == [
        {"label": "cooperative", "score": 0.8}]

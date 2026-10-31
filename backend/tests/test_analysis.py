"""Tests for the analysis core: word counting, sentence splitting and metric calculations."""
import pytest

from dla import analysis as an
from tests.conftest import FakeVader


class TestRegex:
    def test_wildcard_matches_any_ending(self):
        assert len(an.build_regex(["sanction*"]).findall("Sanctions, sanctioned and SANCTION.")) == 3

    def test_no_match_inside_words(self):
        assert an.build_regex(["war"]).findall("software warning war") == ["war"]

    def test_longer_phrase_wins(self):
        rx = an.build_regex(["war", "cold war"])
        assert [m.lower() for m in rx.findall("a Cold  War era")] == ["cold  war"]

    def test_each_hit_is_credited_to_one_term(self):
        text = "A Cold War era: war, sanctions and sanctioned regimes."
        compiled = an.term_regex(["war", "cold war", "sanction*"])
        assert an.count_terms(text, compiled) == {"cold war": 1, "war": 1, "sanction*": 2}
        assert sum(an.count_terms(text, compiled).values()) == len(an.build_regex(["war", "cold war", "sanction*"])
                                                                   .findall(text))

    def test_empty_list_matches_nothing(self):
        assert an.build_regex([]).findall("anything at all") == []
        assert an.build_regex(["*", " "]).findall("anything") == []

    def test_special_characters_are_literal(self):
        assert an.build_regex(["a.b"]).findall("a.b axb") == ["a.b"]

    def test_parse_term_list(self):
        assert an.parse_term_list("a, b\nc;; d ,") == ["a", "b", "c", "d"]

    def test_normalize_terms_drops_duplicates_and_blanks(self):
        assert an.normalize_terms([" War ", "war", "*", "", "cold   war"]) == ["War", "cold war"]

    def test_validate_terms(self):
        with pytest.raises(ValueError):
            an.validate_terms(["x"] * (an.MAX_TERMS + 1))
        with pytest.raises(ValueError):
            an.validate_terms(["x" * (an.MAX_TERM_LENGTH + 1)])

    def test_default_dictionary_check_ignores_case_and_order(self):
        assert an.is_default_dictionaries(list(reversed(an.HOSTILE_TERMS)), [t.upper() for t in an.COOPERATIVE_TERMS])
        assert not an.is_default_dictionaries(an.HOSTILE_TERMS[:-1], an.COOPERATIVE_TERMS)


class TestSentences:
    def test_clean_removes_paragraph_numbers(self):
        assert an.clean_text("12. First point.\n13.  Second   point.") == "First point. Second point."

    def test_clean_removes_byte_order_mark(self):
        assert an.clean_text("\ufeffHello there") == "Hello there"

    def test_abbreviations_are_not_split(self):
        sentences = an.split_sentences(an.clean_text(
            "Mr. President, the U.S. Government agrees with us. We welcome this step forward today."))
        assert sentences == ["Mr. President, the U.S. Government agrees with us.",
                             "We welcome this step forward today."]

    def test_short_fragments_are_dropped(self):
        assert an.split_sentences("Thank you. This sentence is long enough.") == ["This sentence is long enough."]

    def test_chair_remarks_are_removed_from_transcripts(self):
        text = ("Zealand. The Assembly will hear an address by His Excellency Ivan Petrov, President of Valdoria. "
                "I request protocol to escort His Excellency and invite him to address the Assembly. "
                "PRESIDENT PETROV, PRESIDENT OF VALDORIA Madam President, we condemn the aggression. "
                "We welcome dialogue with all partners. Thank you. "
                "On behalf of the Assembly, I wish to thank the President of Valdoria. Thank you. "
                "I now give the floor to His Excellency Mr. Tomas Ruiz.")
        assert an.strip_chair_remarks(text) == ("Madam President, we condemn the aggression. "
                                                "We welcome dialogue with all partners. Thank you.")

    def test_speeches_without_the_chair_are_unchanged(self):
        for text in ("WE CONDEMN THE AGGRESSION AGAINST OUR PEOPLE. WE WELCOME DIALOGUE WITH ALL PARTNERS.",
                     "Mr. President, we welcome dialogue. I thank the Secretary-General for his report."):
            assert an.strip_chair_remarks(text) == text

    def test_reading_text_keeps_paragraphs_and_every_piece(self):
        text = ("1. Mr. President, we condemn the  aggression. Thank you.\n\n"
                "2. We welcome dialogue with all partners. A heading without a full stop\n"
                "Continues here in the same sentence.")
        hostile, coop = an.build_regex(an.HOSTILE_TERMS), an.build_regex(an.COOPERATIVE_TERMS)
        reading = an.reading_text(text, hostile, coop)
        assert [[s["text"] for s in p] for p in reading] == [
            ["Mr. President, we condemn the aggression.", "Thank you."],
            ["We welcome dialogue with all partners.",
             "A heading without a full stop Continues here in the same sentence."],
        ]
        assert [s["index"] for p in reading for s in p] == [0, None, 1, 2]
        counted = [s["text"] for p in reading for s in p if s["index"] is not None]
        assert counted == an.split_sentences(an.clean_text(text))
        first = reading[0][0]
        assert [first["text"][a:b] for a, b, _ in first["highlights"]] == ["condemn", "aggression"]


class TestScoring:
    def setup_method(self):
        self.scorer = an.Scorer(vader=FakeVader())

    def test_score_one_text(self):
        totals, sentences = self.scorer.score("We condemn the illegal sanctions, which are bad. "
                                              "We welcome dialogue and cooperation, which is good.")
        assert totals["sentences"] == 2
        assert totals["hostile_hits"] == 3        # condemn, illegal, sanctions
        assert totals["coop_hits"] == 3           # welcome, dialogue, cooperation
        assert totals["negative_sentences"] == 1
        assert totals["vader_sum"] == pytest.approx(0.0)
        assert [s.index for s in sentences] == [0, 1]
        assert (sentences[0].hostile_hits, sentences[1].coop_hits) == (3, 3)

    def test_empty_text(self):
        totals, sentences = self.scorer.score("Hi.")
        assert totals["sentences"] == 0 and sentences == []

    def test_custom_dictionaries(self):
        scorer = an.Scorer(hostile_terms=["foo"], coop_terms=[], vader=FakeVader())
        totals, _ = scorer.score("The foo and the bar met in the hall. Foo again here.")
        assert (totals["hostile_hits"], totals["coop_hits"]) == (2, 0)

    def test_real_vader_is_used_by_default(self):
        totals, sentences = an.Scorer().score("This is a wonderful and happy day for all of us.")
        assert sentences[0].vader > 0.5 and totals["negative_sentences"] == 0


class TestMetrics:
    def test_add_metrics(self):
        r = an.add_metrics({"words": 2000, "sentences": 10, "hostile_hits": 10, "coop_hits": 30,
                            "vader_sum": 2.0, "negative_sentences": 3, "kwcount::NATO": 4})
        assert r["hostility"] == pytest.approx(5.0)
        assert r["cooperation"] == pytest.approx(15.0)
        assert r["tone_balance"] == pytest.approx(0.5)
        assert r["vader_mean"] == pytest.approx(0.2)
        assert r["negative_share"] == pytest.approx(0.3)
        assert r["kw::NATO"] == pytest.approx(2.0)

    def test_no_division_by_zero(self):
        r = an.add_metrics({c: 0 for c in an.COUNT_COLUMNS})
        assert r["tone_balance"] is None and r["hostility"] is None and r["vader_mean"] is None

    def test_yearly_totals_are_summed_before_dividing(self):
        rows = [
            {"country": "VNM", "year": 2020, "words": 1000, "sentences": 5, "hostile_hits": 1, "coop_hits": 9,
             "vader_sum": 1.0, "negative_sentences": 0, "kwcount::x": 1},
            {"country": "VNM", "year": 2020, "words": 3000, "sentences": 15, "hostile_hits": 3, "coop_hits": 3,
             "vader_sum": -1.0, "negative_sentences": 5, "kwcount::x": 3},
            {"country": "CHN", "year": 2020, "words": 1000, "sentences": 5, "hostile_hits": 0, "coop_hits": 0,
             "vader_sum": 0.0, "negative_sentences": 0, "kwcount::x": 0},
        ]
        g = {r["country"]: r for r in an.aggregate_by_year(rows)}
        assert g["VNM"]["documents"] == 2
        assert g["VNM"]["hostility"] == pytest.approx(1.0)       # 4 hits / 4,000 words
        assert g["VNM"]["tone_balance"] == pytest.approx(0.5)    # (12 − 4) / 16
        assert g["VNM"]["kw::x"] == pytest.approx(1.0)           # 4 hits / 4,000 words
        assert g["CHN"]["documents"] == 1 and g["CHN"]["tone_balance"] is None

    def test_biggest_shifts(self):
        rows = [{"country": c, "year": y, "tone_balance": v} for c, y, v in
                [("A", 2000, 0.5), ("A", 2001, 0.4), ("A", 2003, -0.5), ("B", 2000, 0.0), ("B", 2001, 0.1)]]
        shifts = an.biggest_shifts(rows, "tone_balance", n=2)
        assert (shifts[0]["country"], shifts[0]["from_year"], shifts[0]["year"]) == ("A", 2001, 2003)
        assert shifts[0]["change"] == pytest.approx(-0.9)
        assert len(shifts) == 2

    def test_biggest_shifts_skip_missing_values(self):
        rows = [{"country": "A", "year": 2000, "m": 0.1}, {"country": "A", "year": 2001, "m": None},
                {"country": "A", "year": 2002, "m": 0.4}]
        shifts = an.biggest_shifts(rows, "m")
        assert [(s["from_year"], s["year"]) for s in shifts] == [(2000, 2002)]


class TestDisplay:
    def test_highlight_spans(self):
        text = "<script>x</script> We condemn aggression and welcome dialogue."
        spans = an.highlight_spans(text, an.build_regex(an.HOSTILE_TERMS), an.build_regex(an.COOPERATIVE_TERMS))
        assert [(text[a:b], kind) for a, b, kind in spans] == [
            ("condemn", "hostile"), ("aggression", "hostile"), ("welcome", "cooperative"),
            ("dialogue", "cooperative")]

    def test_overlapping_matches_are_skipped(self):
        spans = an.highlight_spans("cold war", an.build_regex(["cold war"]), an.build_regex(["war"]))
        assert spans == [(0, 8, "hostile")]

    def test_key_sentences(self):
        scorer = an.Scorer(vader=FakeVader())
        _, sentences = scorer.score("We condemn this aggression as bad. We welcome cooperation, which is good. "
                                    "The weather in the city was mild today.")
        notable = an.key_sentences(sentences)
        assert {s["kind"] for s in notable} == {"hostile", "negative", "cooperative"}
        assert an.key_sentences([]) == []

    def test_top_terms(self):
        assert an.top_terms("War, war and sanctions.", an.build_regex(["war", "sanction*"])) == [
            ("war", 2), ("sanctions", 1)]

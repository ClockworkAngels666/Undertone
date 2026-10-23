"""
Automated tests for analysis.py (the "brain" of the tool).

Run:   python -m unittest discover tests      (or: pytest)

The tests use a fake VADER (FakeVader), so they run even before vaderSentiment is
installed. Their job is to protect the word counting, sentence splitting and metric
calculations from being broken by future edits.
"""
import sys
import unittest
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import analysis as an  # noqa: E402


class FakeVader:
    """Fake VADER: a sentence containing 'bad' = −0.5, containing 'good' = +0.5, otherwise 0."""

    def polarity_scores(self, sentence):
        s = sentence.lower()
        return {"compound": -0.5 if "bad" in s else 0.5 if "good" in s else 0.0}


class TestRegex(unittest.TestCase):
    def test_wildcard_matches_any_ending(self):
        rx = an.build_regex(["sanction*"])
        self.assertEqual(len(rx.findall("Sanctions, sanctioned and SANCTION.")), 3)

    def test_no_match_inside_words(self):
        rx = an.build_regex(["war"])
        self.assertEqual(rx.findall("software warning war"), ["war"])

    def test_longer_phrase_wins(self):
        rx = an.build_regex(["war", "cold war"])
        self.assertEqual([m.lower() for m in rx.findall("a Cold  War era")], ["cold  war"])

    def test_empty_list_matches_nothing(self):
        self.assertEqual(an.build_regex([]).findall("anything at all"), [])
        self.assertEqual(an.build_regex(["*", " "]).findall("anything"), [])

    def test_parse_term_list(self):
        self.assertEqual(an.parse_term_list("a, b\nc;; d ,"), ["a", "b", "c", "d"])


class TestSentences(unittest.TestCase):
    def test_clean_removes_paragraph_numbers(self):
        self.assertEqual(an.clean_text("12. First point.\n13.  Second   point."), "First point. Second point.")

    def test_abbreviations_are_not_split(self):
        sentences = an.split_sentences(an.clean_text(
            "Mr. President, the U.S. Government agrees with us. We welcome this step forward today."))
        self.assertEqual(sentences, ["Mr. President, the U.S. Government agrees with us.",
                                     "We welcome this step forward today."])

    def test_short_fragments_are_dropped(self):
        self.assertEqual(an.split_sentences("Thank you. This sentence is long enough."),
                         ["This sentence is long enough."])


class TestScoring(unittest.TestCase):
    def setUp(self):
        self.scorer = an.Scorer(vader=FakeVader())

    def test_score_one_text(self):
        totals, sentences = self.scorer.score("We condemn the illegal sanctions, which are bad. "
                                              "We welcome dialogue and cooperation, which is good.")
        self.assertEqual(totals["sentences"], 2)
        self.assertEqual(totals["hostile_hits"], 3)        # condemn, illegal, sanctions
        self.assertEqual(totals["coop_hits"], 3)           # welcome, dialogue, cooperation
        self.assertEqual(totals["negative_sentences"], 1)
        self.assertAlmostEqual(totals["vader_sum"], 0.0)
        self.assertEqual(list(sentences.columns), ["sentence", "vader", "hostile_hits", "coop_hits"])

    def test_empty_text(self):
        totals, sentences = self.scorer.score("Hi.")
        self.assertEqual(totals["sentences"], 0)
        self.assertTrue(sentences.empty)

    def test_custom_dictionaries(self):
        scorer = an.Scorer(hostile_terms=["foo"], coop_terms=[], vader=FakeVader())
        totals, _ = scorer.score("The foo and the bar met in the hall. Foo again here.")
        self.assertEqual((totals["hostile_hits"], totals["coop_hits"]), (2, 0))


class TestMetrics(unittest.TestCase):
    def test_add_metrics(self):
        t = an.add_metrics(pd.DataFrame([{"words": 2000, "sentences": 10, "hostile_hits": 10, "coop_hits": 30,
                                          "vader_sum": 2.0, "negative_sentences": 3, "kwcount::NATO": 4}]))
        r = t.iloc[0]
        self.assertAlmostEqual(r.hostility, 5.0)
        self.assertAlmostEqual(r.cooperation, 15.0)
        self.assertAlmostEqual(r.tone_balance, 0.5)
        self.assertAlmostEqual(r.vader_mean, 0.2)
        self.assertAlmostEqual(r.negative_share, 0.3)
        self.assertAlmostEqual(r["kw::NATO"], 2.0)

    def test_no_division_by_zero(self):
        r = an.add_metrics(pd.DataFrame([{c: 0 for c in an.COUNT_COLUMNS}])).iloc[0]
        self.assertTrue(pd.isna(r.tone_balance) and pd.isna(r.hostility) and pd.isna(r.vader_mean))

    def test_yearly_totals_are_summed_before_dividing(self):
        table = pd.DataFrame([
            {"country": "VNM", "year": 2020, "words": 1000, "sentences": 5, "hostile_hits": 1, "coop_hits": 9,
             "vader_sum": 1.0, "negative_sentences": 0},
            {"country": "VNM", "year": 2020, "words": 3000, "sentences": 15, "hostile_hits": 3, "coop_hits": 3,
             "vader_sum": -1.0, "negative_sentences": 5},
            {"country": "CHN", "year": 2020, "words": 1000, "sentences": 5, "hostile_hits": 0, "coop_hits": 0,
             "vader_sum": 0.0, "negative_sentences": 0},
        ])
        g = an.aggregate_by_year(table).set_index("country")
        self.assertEqual(g.loc["VNM", "documents"], 2)
        self.assertAlmostEqual(g.loc["VNM", "hostility"], 1.0)       # 4 hits / 4,000 words
        self.assertAlmostEqual(g.loc["VNM", "tone_balance"], 0.5)    # (12 − 4) / 16
        self.assertEqual(g.loc["CHN", "documents"], 1)

    def test_biggest_shifts(self):
        table = pd.DataFrame({"country": ["A", "A", "A", "B", "B"], "year": [2000, 2001, 2003, 2000, 2001],
                              "tone_balance": [0.5, 0.4, -0.5, 0.0, 0.1]})
        shifts = an.biggest_shifts(table, "tone_balance", n=2)
        self.assertEqual(shifts.iloc[0][["country", "from_year", "year"]].tolist(), ["A", 2001, 2003])
        self.assertAlmostEqual(shifts.iloc[0].change, -0.9)


class TestDisplay(unittest.TestCase):
    def test_highlight_html_is_safe(self):
        out = an.highlight_html("<script>x</script> We condemn aggression and welcome dialogue.",
                                an.build_regex(an.HOSTILE_TERMS), an.build_regex(an.COOPERATIVE_TERMS))
        self.assertNotIn("<script>", out)
        self.assertIn("&lt;script&gt;", out)
        self.assertEqual(out.count(an.HOSTILE_STYLE), 2)
        self.assertEqual(out.count(an.COOP_STYLE), 2)

    def test_key_sentences(self):
        scorer = an.Scorer(vader=FakeVader())
        _, sentences = scorer.score("We condemn this aggression as bad. We welcome cooperation, which is good. "
                                    "The weather in the city was mild today.")
        notable = an.key_sentences(sentences)
        self.assertEqual(set(notable.kind), {"hostile", "negative", "cooperative"})
        self.assertTrue(an.key_sentences(sentences.iloc[0:0]).empty)


if __name__ == "__main__":
    unittest.main()

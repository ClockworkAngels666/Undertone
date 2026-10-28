import { lazy, Suspense, useId, useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { api } from "../api/client";
import type { AnalyzeResult, Reading, SentenceScore } from "../api/types";
import { HighlightKeys, Limitations, Notice } from "../components/common";
import { ListenBar, ReadingText, useFlatReading } from "../components/Listen";
import MetricCards from "../components/MetricCards";
import SaveToDataset from "../components/SaveToDataset";
import { downloadText, toCsv } from "../lib/csv";
import { percent, plural } from "../lib/format";
import { errorText, useDictionaries, useDocumentTitle, useMeta } from "../lib/hooks";
import { useSpeech } from "../lib/speech";

// three.js loads after the page itself, so the form is usable straight away.
const SentenceLandscape = lazy(() => import("../three/SentenceLandscape"));
const BalanceScale = lazy(() => import("../three/BalanceScale"));

export const SAMPLE_TEXT =
  "Mr. President, on behalf of the Republic of Valdoria, I congratulate you on your election. " +
  "Our nation remains committed to multilateralism, dialogue and mutual respect among all States. " +
  "We welcome the agreement reached on regional connectivity and stand ready to deepen cooperation with our partners.\n\n" +
  "Yet we cannot remain silent. The unilateral sanctions imposed on our people are illegal and violate " +
  "the Charter of the United Nations. Some powers still cling to a Cold War mentality and a bloc mentality, " +
  "using disinformation to justify interference in the internal affairs of sovereign nations. " +
  "We condemn these double standards. Hegemony has no place in the twenty-first century.\n\n" +
  "Let us instead build bridges, restore trust and work together for a peaceful, inclusive and prosperous future. " +
  "Valdoria extends the hand of friendship to every nation willing to engage on the basis of equality and goodwill.";

type SortKey = "original" | "hostile" | "negative" | "cooperative";
const SORTS: Record<SortKey, string> = {
  hostile: "Most hostile",
  negative: "Most negative (VADER)",
  cooperative: "Most cooperative",
  original: "Original order",
};

export default function AnalyzePage() {
  useDocumentTitle("");
  const meta = useMeta();
  const dictionaries = useDictionaries();
  const textId = useId();
  const [text, setText] = useState("");
  const [analyzedText, setAnalyzedText] = useState("");
  const [result, setResult] = useState<AnalyzeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [fileNote, setFileNote] = useState<string | null>(null);
  const [useContext, setUseContext] = useState(false);

  const analyze = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!text.trim()) {
      setError("Paste a text or upload a file first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const custom = dictionaries.custom
        ? { hostile_terms: dictionaries.custom.hostile, coop_terms: dictionaries.custom.cooperative }
        : {};
      const r = await api.analyze(text, custom, useContext);
      setResult(r);
      setAnalyzedText(text);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > meta.limits.max_upload_bytes) {
      setError(`That file is larger than ${Math.round(meta.limits.max_upload_bytes / 1_000_000)} MB.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const extracted = await api.extractText(file);
      setText(extracted.text);
      setFileNote(`Loaded ${extracted.filename}${extracted.pages ? ` (${extracted.pages} pages)` : ""}` +
        `${extracted.truncated ? `, shortened to the first ${meta.limits.max_text_chars.toLocaleString()} characters` : ""}.`);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="page-intro">
        <h1>Analyze a diplomatic text</h1>
        <p>
          A speech, joint statement or state-media article in English: its hostile and cooperative vocabulary, the
          sentiment of every sentence, and how it compares with recent UN General Debate speeches.
        </p>
      </div>

      <form className="card stack" onSubmit={analyze}>
        <div className="field">
          <label htmlFor={textId}>Text</label>
          <textarea id={textId} rows={9} value={text} maxLength={meta.limits.max_text_chars}
            placeholder="Paste an English text here…" onChange={(e) => {
              setText(e.target.value);
              setFileNote(null);
            }} />
          <span className="hint">
            {text.length.toLocaleString()} / {meta.limits.max_text_chars.toLocaleString()} characters
            {fileNote ? ` · ${fileNote}` : ""}
          </span>
        </div>
        <div className="row">
          <button type="submit" className="btn primary" disabled={busy}>{busy ? "Working…" : "Analyze"}</button>
          <button type="button" className="btn" onClick={() => {
            setText(SAMPLE_TEXT);
            setFileNote("Sample text about the fictional Republic of Valdoria.");
          }}>Use sample text</button>
          <label className="btn" style={{ fontWeight: 600 }}>
            Upload .txt or .pdf
            <input type="file" accept=".txt,.pdf,text/plain,application/pdf" className="visually-hidden"
              onChange={(e) => {
                void onFile(e.target.files?.[0]);
                e.target.value = "";
              }} />
          </label>
          {text && <button type="button" className="btn link" onClick={() => {
            setText("");
            setFileNote(null);
          }}>Clear</button>}
        </div>
        <div className="row small muted">
          <span>
            Dictionaries: {dictionaries.custom ? "your custom lists" : "default"} ·{" "}
            <Link to="/dictionaries">edit</Link>
          </span>
          {meta.context_model.available && (
            <label className="checkbox small">
              <input type="checkbox" checked={useContext} onChange={(e) => setUseContext(e.target.checked)} />
              Also read each sentence with the context model ({meta.context_model.name})
            </label>
          )}
        </div>
      </form>

      {error && <Notice kind="error">{error}</Notice>}
      {result && <Results result={result} text={analyzedText} />}
    </>
  );
}

function Results({ result, text }: { result: AnalyzeResult; text: string }) {
  const base = result.baseline;
  const [focus, setFocus] = useState<number | null>(null);
  return (
    <section aria-label="Results">
      {result.warnings.map((w) => <Notice key={w} kind="warn">{w}</Notice>)}
      <MetricCards metrics={result.metrics} compareTo={base?.averages}
        compareLabel={base ? `UN avg ${base.first_year}–${base.last_year}` : undefined} />
      {base && base.hostility_share_below !== null && (
        <p data-testid="baseline-sentence">
          This text is <strong>more hostile than {base.hostility_share_below >= 1 ? "all" : percent(base.hostility_share_below)}</strong>{" "}
          of the {base.statements.toLocaleString()} UN General Debate statements from {base.first_year}–{base.last_year}.
        </p>
      )}
      <p className="muted small">
        {plural(result.counts.words, "word")} · {plural(result.counts.sentences, "sentence")} ·{" "}
        {result.counts.hostile_hits.toLocaleString("en")} hostile and {result.counts.coop_hits.toLocaleString("en")} cooperative
        dictionary words
      </p>

      <div className="grid-2">
        <HighlightedCard reading={result.reading} />
        <div className="card">
          <h2>Balance of words</h2>
          <Suspense fallback={null}>
            <BalanceScale hostile={result.counts.hostile_hits} cooperative={result.counts.coop_hits}
              hostileTerms={result.top_terms.hostile} coopTerms={result.top_terms.cooperative}
              unAverage={base?.averages.tone_balance ?? null} />
          </Suspense>
          <h3 className="small">Most frequent hostile words</h3>
          <TermList terms={result.top_terms.hostile} />
          <h3 className="small">Most frequent cooperative words</h3>
          <TermList terms={result.top_terms.cooperative} />
          <Limitations />
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Sentence landscape</h2>
          <span className="small muted">{plural(result.sentences.length, "sentence")} in reading order · tap one to find it below</span>
        </div>
        <Suspense fallback={<p className="muted">Loading 3D…</p>}>
          <SentenceLandscape sentences={result.sentences} onPick={(index) => {
            setFocus(index);
            document.getElementById(`sentence-${index}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
          }} />
        </Suspense>
      </div>
      <SentenceTable sentences={result.sentences} contextUsed={result.context_model.used} focus={focus} />
      <SaveToDataset text={text} />
    </section>
  );
}

function TermList({ terms }: { terms: [string, number][] }) {
  if (!terms.length) return <p className="empty">None found.</p>;
  return (
    <ul className="terms">
      {terms.map(([term, count]) => <li key={term}>{term} <span className="muted">×{count}</span></li>)}
    </ul>
  );
}

function HighlightedCard({ reading }: { reading: Reading }) {
  const { texts } = useFlatReading(reading);
  const speech = useSpeech(texts);
  return (
    <div className="card">
      <h2>Highlighted text</h2>
      <ListenBar speech={speech} what="the text" />
      <HighlightKeys />
      <ReadingText reading={reading} current={speech.status === "idle" ? null : speech.current} label="Highlighted text"
        onPick={speech.supported ? speech.play : undefined} testId="highlighted-text" />
    </div>
  );
}

function SentenceTable({ sentences, contextUsed, focus }: {
  sentences: SentenceScore[]; contextUsed: boolean; focus: number | null;
}) {
  const [sort, setSort] = useState<SortKey>("hostile");
  const sorted = useMemo(() => {
    const s = [...sentences];
    if (sort === "hostile") s.sort((a, b) => b.hostile_hits - a.hostile_hits || a.vader - b.vader);
    if (sort === "negative") s.sort((a, b) => a.vader - b.vader);
    if (sort === "cooperative") s.sort((a, b) => b.coop_hits - a.coop_hits || b.vader - a.vader);
    return s;
  }, [sentences, sort]);

  const exportCsv = () => {
    const rows = sentences.map((s) => ({ number: s.index + 1, sentence: s.sentence, vader: s.vader,
      hostile_words: s.hostile_hits, cooperative_words: s.coop_hits, context_label: s.context?.label ?? "" }));
    downloadText("sentence_scores.csv", toCsv(rows, ["number", "sentence", "vader", "hostile_words",
      "cooperative_words", ...(contextUsed ? ["context_label"] : [])]));
  };

  return (
    <div className="card">
      <div className="card-head">
        <h2>Sentence scores</h2>
        <button type="button" className="btn small" onClick={exportCsv}>Download CSV</button>
      </div>
      <fieldset className="row" style={{ border: 0, padding: 0, margin: "0 0 10px" }}>
        <legend className="visually-hidden">Sort sentences</legend>
        {(Object.keys(SORTS) as SortKey[]).map((key) => (
          <label key={key} className="checkbox small">
            <input type="radio" name="sentence-sort" checked={sort === key} onChange={() => setSort(key)} />
            {SORTS[key]}
          </label>
        ))}
      </fieldset>
      <div className="table-wrap tall" tabIndex={0} role="region" aria-label="Sentence scores">
        <table>
          <thead>
            <tr>
              <th className="num">#</th>
              <th>Sentence</th>
              <th className="num">VADER</th>
              <th className="num">Hostile</th>
              <th className="num">Cooperative</th>
              {contextUsed && <th>Context model</th>}
            </tr>
          </thead>
          <tbody>
            {sorted.map((s) => (
              <tr key={s.index} id={`sentence-${s.index}`} className={s.index === focus ? "focused" : undefined}>
                <td className="num">{s.index + 1}</td>
                <td>{s.sentence}</td>
                <td className="num">{s.vader.toFixed(2)}</td>
                <td className="num">{s.hostile_hits}</td>
                <td className="num">{s.coop_hits}</td>
                {contextUsed && <td>{s.context ? `${s.context.label} (${Math.round(s.context.score * 100)}%)` : "–"}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

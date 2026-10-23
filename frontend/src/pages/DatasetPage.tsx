import { useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router";
import { api } from "../api/client";
import type { Dataset, UNSummary, YearlyRow } from "../api/types";
import CountryPicker from "../components/CountryPicker";
import CsvUploader from "../components/CsvUploader";
import { DownloadLink, Limitations, Loading, Notice } from "../components/common";
import MetricSelect from "../components/MetricSelect";
import TrendChart, { type ChartSeries } from "../components/TrendChart";
import { PALETTE, useColorScheme, useStableSlots } from "../lib/colors";
import { rescoreAll, uploadDocuments, type UploadProgress } from "../lib/datasets";
import { formatMetric, isKeywordMetric, metricLabel, plural, tickFormat } from "../lib/format";
import { errorText, useAsync, useDictionaries, useDocumentTitle, useMeta } from "../lib/hooks";
import { storage } from "../lib/storage";
import { joinTerms, parseTerms, sameTerms } from "../lib/terms";

export default function DatasetPage() {
  const { id = "" } = useParams();
  const dataset = useAsync(() => api.datasets.get(id), [id]);
  const yearly = useAsync(() => api.datasets.yearly(id), [id]);
  useDocumentTitle(dataset.data?.name ?? "Dataset");
  const navigate = useNavigate();

  if (dataset.error) {
    const known = storage.datasets().some((d) => d.id === id);
    return (
      <Notice kind="error" onRetry={dataset.reload}>
        {dataset.error}{" "}
        {known && (
          <button type="button" className="btn link" onClick={() => {
            storage.forgetDataset(id);
            navigate("/datasets");
          }}>Remove it from my list</button>
        )}
      </Notice>
    );
  }
  if (!dataset.data) return <Loading />;
  return (
    <DatasetView dataset={dataset.data} rows={yearly.data?.rows ?? []} rowsError={yearly.error}
      refresh={() => {
        dataset.reload();
        yearly.reload();
      }} />
  );
}

function DatasetView({ dataset, rows, rowsError, refresh }: {
  dataset: Dataset; rows: YearlyRow[]; rowsError: string | null; refresh: () => void;
}) {
  const meta = useMeta();
  const scheme = useColorScheme();
  const navigate = useNavigate();
  const location = useLocation();
  const token = storage.token(dataset.id);
  const justUploaded = (location.state as { upload?: UploadProgress } | null)?.upload;

  const byDocs = useMemo(() => {
    const docs = new Map<string, { name: string; documents: number }>();
    for (const r of rows) {
      const entry = docs.get(r.country) ?? { name: r.name, documents: 0 };
      entry.documents += r.documents;
      docs.set(r.country, entry);
    }
    return [...docs.entries()].sort((a, b) => b[1].documents - a[1].documents);
  }, [rows]);
  const options = byDocs.map(([code, v]) => ({ code, name: v.name }));
  const max = meta.limits.max_chart_countries;
  const [chosen, setChosen] = useState<string[] | null>(null);
  const countries = (chosen ?? byDocs.slice(0, 4).map(([c]) => c)).filter((c) => options.some((o) => o.code === c));
  const [metric, setMetric] = useState("tone_balance");
  const [compareUN, setCompareUN] = useState(false);
  const slots = useStableSlots(countries);
  const colors = Object.fromEntries(countries.map((c) => [c, PALETTE[scheme][slots[c] ?? 0]]));
  const label = metricLabel(metric, meta.metrics);

  const unSummary = useAsync<UNSummary | null>(() => (compareUN ? api.un.summary() : Promise.resolve(null)), [compareUN]);
  const unComparable = dataset.uses_default_dictionaries
    && (!isKeywordMetric(metric) || (unSummary.data?.keywords ?? []).includes(metric.slice(4)));
  const unSeries = useAsync(
    () => (compareUN && unComparable && countries.length
      ? api.un.series({ countries, metric, average: false }) : Promise.resolve(null)),
    [compareUN, unComparable, countries.join(","), metric],
  );

  const series: ChartSeries[] = countries.map((c) => ({
    key: c,
    label: options.find((o) => o.code === c)?.name ?? c,
    color: colors[c],
    points: rows.filter((r) => r.country === c).map((r) => ({ year: r.year, value: r[metric] as number | null })),
  }));
  const years = rows.map((r) => r.year);
  const [first, last] = years.length ? [Math.min(...years), Math.max(...years)] : [0, 0];
  if (unSeries.data) {
    for (const s of unSeries.data.series) {
      series.push({
        key: `UN:${s.country}`,
        label: `${s.name} at the UN`,
        color: colors[s.country],
        dashed: true,
        points: s.points.filter((p) => p.year >= first - 1 && p.year <= last + 1),
      });
    }
  }

  return (
    <>
      <div className="page-intro">
        <p className="small"><Link to="/datasets">← My datasets</Link></p>
        <h1>{dataset.name}</h1>
        <p className="muted">
          {plural(dataset.documents, "text")} · {plural(dataset.countries.length, "country", "countries")}
          {dataset.first_year ? ` · ${dataset.first_year}–${dataset.last_year}` : ""} ·{" "}
          {dataset.uses_default_dictionaries ? "default dictionaries" : "custom dictionaries"}
          {token ? "" : " · view only"}
        </p>
      </div>
      {justUploaded && justUploaded.skipped.length > 0 && (
        <Notice kind="warn">
          {plural(justUploaded.skipped.length, "row was", "rows were")} skipped:
          <ul>{justUploaded.skipped.slice(0, 8).map((s) => <li key={`${s.line}`}>Line {s.line}: {s.reason}</li>)}</ul>
        </Notice>
      )}
      {dataset.stale_documents > 0 && (
        <Notice kind="warn">
          {plural(dataset.stale_documents, "text")} still {dataset.stale_documents === 1 ? "uses" : "use"} older dictionaries or keywords.
          {token && <Rescore id={dataset.id} token={token} onDone={refresh} label="Finish rescoring" />}
        </Notice>
      )}

      {dataset.documents === 0 ? (
        <Notice kind="info">This dataset has no texts yet.{token ? " Add some below." : ""}</Notice>
      ) : (
        <div className="card">
          <div className="row">
            <CountryPicker options={options} value={countries} max={max} colors={colors} onChange={setChosen} />
            <MetricSelect value={metric} onChange={setMetric} keywords={dataset.keywords} />
          </div>
          <label className="checkbox" style={{ marginTop: 8 }}>
            <input type="checkbox" checked={compareUN} onChange={(e) => setCompareUN(e.target.checked)} />
            Compare with the same countries’ UN General Debate speeches (dashed)
          </label>
          {compareUN && !dataset.uses_default_dictionaries && (
            <p className="small muted">Not available: this dataset uses custom dictionaries, so the numbers are not comparable.</p>
          )}
          {compareUN && dataset.uses_default_dictionaries && !unComparable && unSummary.data && (
            <p className="small muted">The UN data has no counts for this keyword.</p>
          )}
          {unSeries.error && <Notice kind="error">{unSeries.error}</Notice>}
          <h2 style={{ marginTop: 16 }}>{label}</h2>
          {rowsError ? <Notice kind="error" onRetry={refresh}>{rowsError}</Notice> : (
            <TrendChart series={series} format={(v) => formatMetric(metric, v)} tickFormat={tickFormat(metric)}
              valueLabel={label} reloading={unSeries.loading} />
          )}
          <Limitations />
        </div>
      )}

      {rows.length > 0 && <YearlyTable rows={rows} metric={metric} />}

      <div className="card">
        <div className="card-head">
          <h2>Download &amp; share</h2>
        </div>
        <div className="row">
          <DownloadLink href={api.datasets.exportUrl(dataset.id, "yearly")}>Results by country and year (CSV)</DownloadLink>
          <DownloadLink href={api.datasets.exportUrl(dataset.id, "documents")}>Every text with its scores (CSV)</DownloadLink>
          <button type="button" className="btn small" onClick={() => void navigator.clipboard?.writeText(window.location.href)}>
            Copy view-only link
          </button>
        </div>
      </div>

      <Documents id={dataset.id} token={token} onChange={refresh} />

      {token && (
        <>
          <div className="card">
            <h2>Add more texts</h2>
            <CsvUploader submitLabel="Upload" onSubmit={async (parsed, progress) => {
              const result = await uploadDocuments(dataset.id, token, parsed.documents, parsed.lines,
                meta.limits.max_batch_documents, progress);
              refresh();
              return result;
            }} />
          </div>
          <Settings dataset={dataset} token={token} onChange={refresh} />
          <div className="card">
            <h2>Delete this dataset</h2>
            <p className="small muted">Removes the dataset and all its texts from the database. This cannot be undone.</p>
            <button type="button" className="btn danger" onClick={async () => {
              if (!window.confirm(`Delete “${dataset.name}” and all ${dataset.documents} texts?`)) return;
              try {
                await api.datasets.remove(dataset.id, token);
                storage.forgetDataset(dataset.id);
                navigate("/datasets");
              } catch (err) {
                window.alert(errorText(err));
              }
            }}>Delete dataset</button>
          </div>
        </>
      )}
    </>
  );
}

function YearlyTable({ rows, metric }: { rows: YearlyRow[]; metric: string }) {
  const meta = useMeta();
  const ids = [...meta.metrics.map((m) => m.id), ...(isKeywordMetric(metric) ? [metric] : [])];
  return (
    <div className="card">
      <h2>By country and year</h2>
      <div className="table-wrap tall">
        <table>
          <thead>
            <tr>
              <th>Country</th>
              <th className="num">Year</th>
              <th className="num">Texts</th>
              <th className="num">Words</th>
              {ids.map((m) => <th key={m} className="num">{metricLabel(m, meta.metrics)}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.country}-${r.year}`}>
                <td>{r.name}</td>
                <td className="num">{r.year}</td>
                <td className="num">{r.documents}</td>
                <td className="num">{r.words.toLocaleString()}</td>
                {ids.map((m) => <td key={m} className="num">{formatMetric(m, r[m] as number | null)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Documents({ id, token, onChange }: { id: string; token?: string; onChange: () => void }) {
  const [offset, setOffset] = useState(0);
  const limit = 25;
  const page = useAsync(() => api.datasets.documents(id, offset, limit), [id, offset]);
  if (page.error) return <Notice kind="error" onRetry={page.reload}>{page.error}</Notice>;
  if (!page.data || page.data.total === 0) return null;
  const { total, items } = page.data;
  return (
    <div className="card">
      <div className="card-head">
        <h2>Texts</h2>
        <span className="small muted">{offset + 1}–{Math.min(offset + limit, total)} of {total.toLocaleString()}</span>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Country</th><th className="num">Year</th><th>Title / beginning</th>
              <th className="num">Tone balance</th><th className="num">Hostile / 1,000</th>
              {token && <th><span className="visually-hidden">Actions</span></th>}
            </tr>
          </thead>
          <tbody>
            {items.map((d) => (
              <tr key={d.id}>
                <td>{d.country}</td>
                <td className="num">{d.year}</td>
                <td>
                  {d.title && <strong>{d.title} </strong>}
                  <span className="muted small">{d.source ? `${d.source} · ` : ""}{d.preview.slice(0, 140)}…</span>
                </td>
                <td className="num">{formatMetric("tone_balance", d.metrics.tone_balance)}</td>
                <td className="num">{formatMetric("hostility", d.metrics.hostility)}</td>
                {token && (
                  <td>
                    <button type="button" className="btn link small" aria-label={`Delete text ${d.id}`} onClick={async () => {
                      if (!window.confirm("Delete this text?")) return;
                      try {
                        await api.datasets.removeDocument(id, token, d.id);
                        page.reload();
                        onChange();
                      } catch (err) {
                        window.alert(errorText(err));
                      }
                    }}>delete</button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="row" style={{ marginTop: 10 }}>
        <button type="button" className="btn small" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))}>
          Previous
        </button>
        <button type="button" className="btn small" disabled={offset + limit >= total} onClick={() => setOffset(offset + limit)}>
          Next
        </button>
      </div>
    </div>
  );
}

function Settings({ dataset, token, onChange }: { dataset: Dataset; token: string; onChange: () => void }) {
  const dictionaries = useDictionaries();
  const [keywords, setKeywords] = useState(joinTerms(dataset.keywords));
  const dictionariesDiffer = !sameTerms(dictionaries.hostile, dataset.hostile_terms)
    || !sameTerms(dictionaries.cooperative, dataset.coop_terms);
  const keywordsDiffer = !sameTerms(parseTerms(keywords), dataset.keywords);
  return (
    <div className="card stack">
      <h2>Keywords and dictionaries</h2>
      <div className="field">
        <label htmlFor="edit-keywords">Keywords to track</label>
        <input id="edit-keywords" type="text" value={keywords} onChange={(e) => setKeywords(e.target.value)} />
      </div>
      <p className="small muted">
        This dataset uses {dataset.uses_default_dictionaries ? "the default dictionaries" : "custom dictionaries"}.
        {dictionariesDiffer ? " Your current dictionaries are different; rescoring applies them." : ""}
      </p>
      {(keywordsDiffer || dictionariesDiffer) && (
        <Rescore id={dataset.id} token={token} onDone={onChange} label="Rescore all texts"
          change={{
            ...(keywordsDiffer ? { keywords: parseTerms(keywords) } : {}),
            ...(dictionariesDiffer ? { hostile_terms: dictionaries.hostile, coop_terms: dictionaries.cooperative } : {}),
          }} />
      )}
    </div>
  );
}

function Rescore({ id, token, onDone, label, change }: {
  id: string; token: string; onDone: () => void; label: string;
  change?: Parameters<typeof api.datasets.rescore>[2];
}) {
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="row" style={{ alignItems: "center" }}>
      <button type="button" className="btn small" disabled={busy} onClick={async () => {
        setBusy(true);
        try {
          await rescoreAll(id, token, change, (done, remaining) => setStatus(`Rescored ${done}, ${remaining} left…`));
          setStatus("Done.");
          onDone();
        } catch (err) {
          setStatus(errorText(err));
        } finally {
          setBusy(false);
        }
      }}>{busy ? "Rescoring…" : label}</button>
      {status && <span className="small">{status}</span>}
    </div>
  );
}

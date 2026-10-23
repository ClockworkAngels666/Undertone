import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { api } from "../api/client";
import type { CountryInfo, NotableSentence, Statement, UNSummary } from "../api/types";
import CountryPicker from "../components/CountryPicker";
import { DownloadLink, HighlightedText, HighlightKeys, Limitations, Loading, Notice } from "../components/common";
import MetricCards from "../components/MetricCards";
import MetricSelect from "../components/MetricSelect";
import TrendChart from "../components/TrendChart";
import { PALETTE, useColorScheme, useStableSlots } from "../lib/colors";
import { formatDelta, formatMetric, metricLabel, tickFormat } from "../lib/format";
import { useAsync, useDocumentTitle, useMeta } from "../lib/hooks";

const PREFERRED = ["RUS", "USA", "CHN", "VNM"];

export default function ExplorerPage() {
  useDocumentTitle("UN General Debate");
  const summary = useAsync(() => api.un.summary(), []);
  if (summary.error) return <Notice kind="error" onRetry={summary.reload}>{summary.error}</Notice>;
  if (!summary.data) return <Loading />;
  if (!summary.data.loaded) {
    return (
      <Notice kind="info">
        The UN General Debate data has not been loaded into the database yet. The maintainer runs{" "}
        <code>python -m dla load-un</code> once (see the README).
      </Notice>
    );
  }
  return <Explorer summary={summary.data} />;
}

function Explorer({ summary }: { summary: UNSummary }) {
  const meta = useMeta();
  const scheme = useColorScheme();
  const [params, setParams] = useSearchParams();
  const firstYear = summary.first_year!;
  const lastYear = summary.last_year!;
  const known = new Set(summary.countries.map((c) => c.code));
  const max = meta.limits.max_chart_countries;

  const defaultCountries = PREFERRED.filter((c) => known.has(c)).length
    ? PREFERRED.filter((c) => known.has(c))
    : [...summary.countries].sort((a, b) => b.statements - a.statements).slice(0, 4).map((c) => c.code);
  const countries = (params.get("c")?.split(",").filter((c) => known.has(c)) ?? defaultCountries).slice(0, max);
  const metric = params.get("m") ?? "tone_balance";
  const start = clamp(Number(params.get("from") ?? Math.max(firstYear, 1990)), firstYear, lastYear);
  const end = clamp(Number(params.get("to") ?? lastYear), firstYear, lastYear);
  const showAverage = params.get("avg") !== "0";
  const showEvents = params.get("ev") !== "0";

  const update = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    setParams(next, { replace: true });
  };

  const slots = useStableSlots(countries);
  const colors = Object.fromEntries(countries.map((c) => [c, PALETTE[scheme][slots[c] ?? 0]]));
  const names = Object.fromEntries(summary.countries.map((c) => [c.code, c.name]));
  const label = metricLabel(metric, meta.metrics);

  const series = useAsync(
    () => api.un.series({ countries, metric, start, end, average: showAverage }),
    [countries.join(","), metric, start, end, showAverage],
  );
  const shifts = useAsync(
    () => (countries.length ? api.un.shifts({ countries, metric, start, end, n: 8 }) : Promise.resolve([])),
    [countries.join(","), metric, start, end],
  );

  const [reading, setReading] = useState<{ country: string; year: number } | null>(null);
  const readCountry = reading?.country && countries.includes(reading.country) ? reading.country : countries[0];
  const readYears = useMemo(() => {
    const s = series.data?.series.find((x) => x.country === readCountry);
    return s ? s.points.map((p) => p.year).sort((a, b) => b - a) : [];
  }, [series.data, readCountry]);
  const readYear = reading && reading.country === readCountry && readYears.includes(reading.year)
    ? reading.year : readYears[0];

  return (
    <>
      <div className="page-intro">
        <h1>UN General Debate, {firstYear}–{lastYear}</h1>
        <p>
          {summary.statements.toLocaleString()} statements by {summary.countries.length} delegations, scored with the
          default dictionaries and VADER. Pick countries and a metric, then read the sentences behind the numbers.
        </p>
      </div>
      {summary.demo && (
        <Notice kind="warn">Demo data: these are fictional countries and generated texts, not real UN speeches.</Notice>
      )}

      <div className="card">
        <div className="row">
          <CountryPicker options={summary.countries} value={countries} max={max} colors={colors}
            onChange={(codes) => update({ c: codes.join(",") })} />
          <div className="field">
            <label htmlFor="year-from">From</label>
            <input id="year-from" type="number" min={firstYear} max={lastYear} value={start}
              onChange={(e) => update({ from: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="year-to">To</label>
            <input id="year-to" type="number" min={firstYear} max={lastYear} value={end}
              onChange={(e) => update({ to: e.target.value })} />
          </div>
          <MetricSelect value={metric} onChange={(m) => update({ m })} keywords={summary.keywords} />
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <label className="checkbox">
            <input type="checkbox" checked={showAverage} onChange={(e) => update({ avg: e.target.checked ? null : "0" })} />
            Average of all countries
          </label>
          <label className="checkbox">
            <input type="checkbox" checked={showEvents} onChange={(e) => update({ ev: e.target.checked ? null : "0" })} />
            Key events
          </label>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>{label}</h2>
          <DownloadLink href={api.un.exportUrl({ countries, start, end })}>Download selection (CSV)</DownloadLink>
        </div>
        {start > end ? (
          <Notice kind="warn">The start year is after the end year.</Notice>
        ) : series.error ? (
          <Notice kind="error" onRetry={series.reload}>{series.error}</Notice>
        ) : !countries.length ? (
          <p className="empty">Choose at least one country.</p>
        ) : series.data ? (
          <TrendChart
            series={series.data.series.map((s) => ({ key: s.country, label: s.name, color: colors[s.country], points: s.points }))}
            average={showAverage ? series.data.average : null}
            events={showEvents ? meta.events : []}
            format={(v) => formatMetric(metric, v)}
            tickFormat={tickFormat(metric)}
            valueLabel={label}
            reloading={series.loading}
          />
        ) : (
          <Loading />
        )}
        <Limitations />
      </div>

      <div className="grid-2">
        <div className="card">
          <h2>Biggest shifts</h2>
          <p className="muted small">Largest changes from one statement to the next. Click a row to read that speech.</p>
          {shifts.error ? <Notice kind="error" onRetry={shifts.reload}>{shifts.error}</Notice>
            : !shifts.data ? <Loading />
            : !shifts.data.length ? <p className="empty">Not enough data.</p> : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>Country</th><th>Years</th><th className="num">Change</th><th className="num">New value</th></tr>
                  </thead>
                  <tbody>
                    {shifts.data.map((s) => (
                      <tr key={`${s.country}-${s.year}`} className="clickable" tabIndex={0}
                        onClick={() => setReading({ country: s.country, year: s.year })}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") setReading({ country: s.country, year: s.year });
                        }}>
                        <td>{s.name}</td>
                        <td>{s.from_year}→{s.year}</td>
                        <td className="num">{formatDelta(metric, s.change)}</td>
                        <td className="num">{formatMetric(metric, s.value)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
        </div>
        <RankingCard metric={metric} defaultYear={end} firstYear={firstYear} lastYear={lastYear} names={names} />
      </div>

      <CloseReading
        countries={countries.map((c) => summary.countries.find((x) => x.code === c)).filter(Boolean) as CountryInfo[]}
        country={readCountry}
        year={readYear}
        years={readYears}
        onChange={(country, year) => setReading({ country, year })}
      />

      <p className="muted small">
        Data: {meta.citation} Texts are the official English versions. CC0 licence.{" "}
        <a href={api.un.exportUrl({})} download>Download all scores (CSV)</a>
      </p>
    </>
  );
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function RankingCard({ metric, defaultYear, firstYear, lastYear, names }: {
  metric: string; defaultYear: number; firstYear: number; lastYear: number; names: Record<string, string>;
}) {
  const meta = useMeta();
  const [year, setYear] = useState(defaultYear);
  const [showAll, setShowAll] = useState(false);
  const [filter, setFilter] = useState("");
  useEffect(() => setYear(defaultYear), [defaultYear]);
  const ranking = useAsync(() => api.un.ranking(year, metric), [year, metric]);
  const rows = (ranking.data?.rows ?? []).filter((r) =>
    !filter || `${r.name} ${r.country}`.toLowerCase().includes(filter.toLowerCase()));
  const visible = showAll || filter ? rows : rows.slice(0, 15);
  const values = (ranking.data?.rows ?? []).map((r) => r.value);
  const lo = Math.min(0, ...values);
  const hi = Math.max(0, ...values);
  const span = hi - lo || 1;

  return (
    <div className="card">
      <div className="card-head">
        <h2>Country ranking</h2>
        <div className="row">
          <div className="field">
            <label htmlFor="rank-year">Year</label>
            <input id="rank-year" type="number" min={firstYear} max={lastYear} value={year}
              onChange={(e) => setYear(clamp(Number(e.target.value), firstYear, lastYear))} />
          </div>
          <div className="field">
            <label htmlFor="rank-filter">Find</label>
            <input id="rank-filter" type="search" value={filter} placeholder="Country" style={{ width: "9rem" }}
              onChange={(e) => setFilter(e.target.value)} />
          </div>
        </div>
      </div>
      <p className="muted small">{metricLabel(metric, meta.metrics)}, highest first.</p>
      {ranking.error ? <Notice kind="error" onRetry={ranking.reload}>{ranking.error}</Notice>
        : !ranking.data ? <Loading />
        : !rows.length ? <p className="empty">No statements for this year.</p> : (
          <>
            <div className="table-wrap tall">
              <table>
                <thead><tr><th className="num">#</th><th>Country</th><th>Value</th></tr></thead>
                <tbody>
                  {visible.map((r) => (
                    <tr key={r.country}>
                      <td className="num">{r.rank}</td>
                      <td>{names[r.country] ?? r.name}</td>
                      <td>
                        <div className="bar-cell">
                          <span className="num" style={{ minWidth: "3.5em" }}>{formatMetric(metric, r.value)}</span>
                          <span className="bar-track" aria-hidden="true">
                            <span className="bar-fill" style={{
                              left: `${((Math.min(0, r.value) - lo) / span) * 100}%`,
                              width: `${Math.max((Math.abs(r.value) / span) * 100, 0.5)}%`,
                            }} />
                          </span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!filter && rows.length > 15 && (
              <button type="button" className="btn link small" style={{ marginTop: 8 }} onClick={() => setShowAll(!showAll)}>
                {showAll ? "Show top 15" : `Show all ${rows.length}`}
              </button>
            )}
          </>
        )}
    </div>
  );
}

const KIND_TITLES: Record<NotableSentence["kind"], string> = {
  hostile: "Sentences with the most hostile words",
  negative: "Most negative sentences (VADER)",
  cooperative: "Most cooperative sentences",
};

function CloseReading({ countries, country, year, years, onChange }: {
  countries: CountryInfo[]; country?: string; year?: number; years: number[];
  onChange: (country: string, year: number) => void;
}) {
  const meta = useMeta();
  const statement = useAsync<Statement | null>(
    () => (country && year ? api.un.statement(country, year) : Promise.resolve(null)),
    [country, year],
  );
  if (!countries.length) return null;
  return (
    <div className="card" id="close-reading">
      <div className="card-head">
        <h2>Close reading</h2>
        <div className="row">
          <div className="field">
            <label htmlFor="read-country">Country</label>
            <select id="read-country" value={country} onChange={(e) => onChange(e.target.value, years[0])}>
              {countries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="read-year">Year</label>
            <select id="read-year" value={year} onChange={(e) => country && onChange(country, Number(e.target.value))}>
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
        </div>
      </div>
      {statement.error ? <Notice kind="error" onRetry={statement.reload}>{statement.error}</Notice>
        : !statement.data ? (statement.loading ? <Loading /> : <p className="empty">No statement in the chosen years.</p>) : (
          <div style={{ opacity: statement.loading ? 0.6 : 1 }}>
            <p className="muted small">
              {statement.data.name}, session {statement.data.session} ({statement.data.year}) ·{" "}
              {statement.data.counts.words.toLocaleString()} words · {statement.data.counts.sentences} sentences
            </p>
            <MetricCards metrics={statement.data.metrics} />
            <HighlightKeys />
            {(Object.keys(KIND_TITLES) as NotableSentence["kind"][]).map((kind) => {
              const group = statement.data!.sentences.filter((s) => s.kind === kind);
              return (
                <div key={kind}>
                  <h3 className="kind-title"><span className={`dot ${kind}`} aria-hidden="true" />{KIND_TITLES[kind]}</h3>
                  {group.length ? (
                    <ul className="sentences">
                      {group.map((s) => (
                        <li key={`${kind}-${s.position}`}>
                          <HighlightedText text={s.sentence} spans={s.highlights} />
                          <span className="score">
                            {kind === "negative" ? `VADER ${s.score.toFixed(2)}` : `${s.score} ${kind} word${s.score === 1 ? "" : "s"}`} · sentence {s.position + 1}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : <p className="empty">None.</p>}
                </div>
              );
            })}
            <details className="table-view">
              <summary>Keyword rates in this statement</summary>
              <ul className="terms">
                {Object.entries(statement.data.keywords).map(([k, v]) => (
                  <li key={k}>{metricLabel(`kw::${k}`, meta.metrics).replace(" per 1,000 words", "")}{" "}
                    <span className="muted">{formatMetric(`kw::${k}`, v)}</span></li>
                ))}
              </ul>
            </details>
          </div>
        )}
    </div>
  );
}

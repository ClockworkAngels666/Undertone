import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { api } from "../api/client";
import type { CountryInfo, NotableSentence, Statement, StatementText, UNSummary } from "../api/types";
import CountryPicker from "../components/CountryPicker";
import { DownloadLink, HighlightedText, HighlightKeys, Limitations, Loading, Notice } from "../components/common";
import { PlayIcon } from "../components/icons";
import { ListenBar, NowReading, ReadingText, useFlatReading } from "../components/Listen";
import MetricCards from "../components/MetricCards";
import MetricSelect from "../components/MetricSelect";
import TrendChart from "../components/TrendChart";
import { PALETTE, useColorScheme, useStableSlots } from "../lib/colors";
import { formatDelta, formatMetric, metricLabel, plural, tickFormat } from "../lib/format";
import { useAsync, useDocumentTitle, useMeta } from "../lib/hooks";
import { useSpeech } from "../lib/speech";

const PREFERRED = ["RUS", "USA", "CHN", "VNM"];

// The 3D views (three.js) load only when this page is opened.
const FlagLine = lazy(() => import("../three/FlagLine"));
const AssemblyHall = lazy(() => import("../three/AssemblyHall"));
const Rostrum = lazy(() => import("../three/Rostrum"));
const RhetoricSpace = lazy(() => import("../three/RhetoricSpace"));
const Podium = lazy(() => import("../three/Podium"));

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
  // Same object while the countries and theme stay the same, so the 3D views do not redraw needlessly.
  const colorKey = countries.map((c) => `${c}=${PALETTE[scheme][slots[c] ?? 0]}`).join(",");
  const colors = useMemo(() => Object.fromEntries(colorKey.split(",").filter(Boolean).map((pair) => pair.split("="))),
    [colorKey]) as Record<string, string>;
  const names = useMemo(() => Object.fromEntries(summary.countries.map((c) => [c.code, c.name])), [summary]);
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
  const [flagYear, setFlagYear] = useState(end);
  const [yearView, setYearView] = useState<"flags" | "hall">("flags");
  const [picked, setPicked] = useState<{ code: string; year: number; added: boolean } | null>(null);
  const matrix = useAsync(() => api.un.matrix(metric), [metric]);
  const space = useAsync(
    () => (countries.length ? Promise.all([
      api.un.series({ countries, metric: "hostility", start, end, average: false }),
      api.un.series({ countries, metric: "cooperation", start, end, average: false }),
    ]) : Promise.resolve(null)),
    [countries.join(","), start, end],
  );

  const chosenFlags = useMemo(() => countries.map((code) => ({ code, color: colors[code] })),
    [colorKey]);   // colorKey changes exactly when the countries or their colours do
  const formatValue = useCallback((v: number) => formatMetric(metric, v), [metric]);

  const spaceSeries = useMemo(() => (space.data ? space.data[0].series.map((h) => {
    const coop = new Map(space.data![1].series.find((c) => c.country === h.country)?.points
      .map((p) => [p.year, p.value]) ?? []);
    return { key: h.country, label: h.name, color: colors[h.country] ?? PALETTE[scheme][0],
      points: h.points.map((p) => ({ year: p.year, hostility: p.value, cooperation: coop.get(p.year) ?? null })) };
  }) : []), [space.data, colors, scheme]);

  const openSpeech = useCallback((code: string, year: number) => {
    const changes: Record<string, string | null> = {};
    if (year < start) changes.from = String(year);
    if (year > end) changes.to = String(year);
    const added = !countries.includes(code) && countries.length < max;
    if (added) changes.c = [...countries, code].join(",");
    if (Object.keys(changes).length) update(changes);
    setReading({ country: code, year });
    setPicked({ code, year, added });
  }, [countries.join(","), start, end, max, params]);
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
          {plural(summary.statements, "statement")} by {plural(summary.countries.length, "delegation")}, scored with the
          default dictionaries and VADER.
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
          <h2>Year by year</h2>
          <div className="tabs" role="tablist" aria-label="View">
            {([["flags", "Flags"], ["hall", "Assembly hall"]] as const).map(([key, text]) => (
              <button key={key} type="button" role="tab" aria-selected={yearView === key}
                onClick={() => setYearView(key)}>{text}</button>
            ))}
          </div>
        </div>
        {matrix.error ? <Notice kind="error" onRetry={matrix.reload}>{matrix.error}</Notice>
          : !matrix.data ? <Loading /> : (
            <Suspense fallback={<Loading label="Loading 3D…" />}>
              {yearView === "flags" ? (
                <FlagLine matrix={matrix.data} metricLabel={label} names={names}
                  format={formatValue} year={flagYear} onYearChange={setFlagYear}
                  chosen={chosenFlags} onPick={openSpeech} />
              ) : (
                <AssemblyHall matrix={matrix.data} metricLabel={label} names={names}
                  format={formatValue} year={flagYear} onYearChange={setFlagYear}
                  chosen={chosenFlags} onPick={openSpeech} />
              )}
            </Suspense>
          )}
        {picked && (
          <Notice kind="info">
            {names[picked.code] ?? picked.code}, {picked.year}:{" "}
            {picked.added ? "added to the chart. " : countries.includes(picked.code) ? "" : "the chart is full (8 countries). "}
            <a href="#close-reading">Read this speech ↓</a>
          </Notice>
        )}
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

      <div className="card">
        <div className="card-head">
          <h2>Rhetoric space</h2>
          <span className="small muted">hostile × cooperative words × time, {start}–{end}</span>
        </div>
        {space.error ? <Notice kind="error" onRetry={space.reload}>{space.error}</Notice>
          : !countries.length ? <p className="empty">Choose at least one country.</p>
          : !space.data ? <Loading /> : (
            <Suspense fallback={<Loading label="Loading 3D…" />}>
              <RhetoricSpace
                series={spaceSeries}
                onPick={(code, year) => {
                  setReading({ country: code, year });
                  document.getElementById("close-reading")?.scrollIntoView({ behavior: "smooth", block: "start" });
                }} />
            </Suspense>
          )}
        <p className="small muted">
          Each line is one country&apos;s path through the years. Points above the shaded plane used more cooperative
          than hostile words that year.
        </p>
      </div>

      <div className="grid-2">
        <div className="card">
          <h2>Biggest shifts</h2>
          <p className="muted small">Largest changes from one statement to the next. Click a row to read that speech.</p>
          {shifts.error ? <Notice kind="error" onRetry={shifts.reload}>{shifts.error}</Notice>
            : !shifts.data ? <Loading />
            : !shifts.data.length ? <p className="empty">Not enough data.</p> : (
              <div className="table-wrap" tabIndex={0} role="region" aria-label="Biggest shifts">
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
        <RankingCard metric={metric} defaultYear={end} firstYear={firstYear} lastYear={lastYear} names={names}
          onPick={(code, year) => {
            openSpeech(code, year);
            window.setTimeout(() => document.getElementById("close-reading")
              ?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
          }} />
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

function RankingCard({ metric, defaultYear, firstYear, lastYear, names, onPick }: {
  metric: string; defaultYear: number; firstYear: number; lastYear: number; names: Record<string, string>;
  onPick: (code: string, year: number) => void;
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
  const top = useMemo(() => (ranking.data?.rows ?? []).slice(0, 3)
    .map((r) => ({ country: r.country, name: names[r.country] ?? r.name, value: r.value })), [ranking.data, names]);
  const formatValue = useCallback((v: number) => formatMetric(metric, v), [metric]);

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
      {top.length > 0 && ranking.data && (
        <Suspense fallback={null}>
          <Podium rows={top} format={formatValue} onPick={(code) => onPick(code, ranking.data!.year)} />
        </Suspense>
      )}
      {ranking.error ? <Notice kind="error" onRetry={ranking.reload}>{ranking.error}</Notice>
        : !ranking.data ? <Loading />
        : !rows.length ? <p className="empty">No statements for this year.</p> : (
          <>
            <div className="table-wrap tall" tabIndex={0} role="region" aria-label="Country ranking">
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
  const fullText = useAsync<StatementText | null>(
    () => (country && year ? api.un.statementText(country, year) : Promise.resolve(null)),
    [country, year],
  );
  const loaded = fullText.data;
  const reading = loaded && loaded.country === country && loaded.year === year ? loaded.reading : null;
  const { flat, texts } = useFlatReading(reading);
  const speech = useSpeech(texts);
  const listening = speech.status !== "idle";
  const position = useMemo(() => new Map(flat.map((s, i) => [s.index, i])), [flat]);   // scored number → reading order
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
            <div className="reading-head">
              <Suspense fallback={null}>
                <Rostrum code={statement.data.country} name={statement.data.name} year={statement.data.year}
                  session={statement.data.session} speaking={speech.status === "playing"} />
              </Suspense>
              <div>
                <h3 className="reading-title">{statement.data.name}</h3>
                <p className="muted small">
                  Session {statement.data.session} · {statement.data.year} ·{" "}
                  {plural(statement.data.counts.words, "word")} · {plural(statement.data.counts.sentences, "sentence")}
                </p>
                {fullText.error && !fullText.loading
                  ? <p className="muted small">The full text of this speech is not available.</p>
                  : <ListenBar speech={speech} what="this speech" />}
                {listening && <NowReading sentence={flat[speech.current]} />}
              </div>
            </div>
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
                            {kind === "negative" ? `VADER ${s.score.toFixed(2)}` : `${s.score} ${kind} word${s.score === 1 ? "" : "s"}`} ·{" "}
                            {speech.supported && position.has(s.position) ? (
                              <button type="button" className="btn link listen-from"
                                aria-label={`Listen from sentence ${s.position + 1}`}
                                onClick={() => speech.play(position.get(s.position))}>
                                <PlayIcon /> sentence {s.position + 1}
                              </button>
                            ) : `sentence ${s.position + 1}`}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : <p className="empty">None.</p>}
                </div>
              );
            })}
            {reading && (
              <details className="table-view full-speech">
                <summary>Full speech</summary>
                <ReadingText reading={reading} current={listening ? speech.current : null} label="Full speech"
                  onPick={speech.supported ? speech.play : undefined} testId="full-speech" />
              </details>
            )}
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

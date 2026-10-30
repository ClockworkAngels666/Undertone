import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router";
import { api } from "../api/client";
import type { CountryInfo, Matrix, NotableSentence, Statement, StatementText, UNSummary } from "../api/types";
import CountryPicker from "../components/CountryPicker";
import { DownloadLink, HighlightedText, HighlightKeys, Limitations, Loading, Notice } from "../components/common";
import { ListenBar, MiniPlayer, NowReading, ReadingText, useFlatReading } from "../components/Listen";
import MetricCards from "../components/MetricCards";
import MetricSelect from "../components/MetricSelect";
import TrendChart from "../components/TrendChart";
import { PALETTE, useColorScheme, useStableSlots } from "../lib/colors";
import { fixed, formatDelta, formatMetric, metricLabel, plural, tickFormat } from "../lib/format";
import { useAsync, useDocumentTitle, useMeta } from "../lib/hooks";
import { speakerFlag, speakerName } from "../lib/history";
import { useSpeech } from "../lib/speech";

const PREFERRED = ["RUS", "USA", "CHN", "VNM"];

/** The page's views, as tabs under the filters; the choice is kept in the address (?v=). */
const VIEWS = [
  ["trend", "Over time", "Over time"], ["year", "Year by year", "By year"],
  ["space", "Rhetoric space", "Rhetoric"], ["read", "Close reading", "Reading"],
] as const;   // key, name, the shorter name shown on phones (the full one stays the accessible name)
type View = typeof VIEWS[number][0];

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

  const rangeOk = start <= end;
  const series = useAsync(
    () => (rangeOk ? api.un.series({ countries, metric, start, end, average: showAverage }) : Promise.resolve(null)),
    [countries.join(","), metric, start, end, showAverage],
  );
  const shifts = useAsync(
    () => (countries.length && rangeOk ? api.un.shifts({ countries, metric, start, end, n: 8 }) : Promise.resolve([])),
    [countries.join(","), metric, start, end],
  );

  const view: View = VIEWS.some(([key]) => key === params.get("v")) ? params.get("v") as View : "trend";
  useDocumentTitle(`${VIEWS.find(([key]) => key === view)![1]} · UN General Debate`);
  const [reading, setReading] = useState<{ country: string; year: number } | null>(null);
  const [year, setYear] = useState(end);     // the one year shown by the flags, the hall and the ranking
  useEffect(() => setYear(end), [end]);
  const [yearView, setYearView] = useState<"flags" | "hall">("flags");
  const [arrivals, setArrivals] = useState(0);   // counts speeches opened from elsewhere on the page
  const matrix = useAsync(() => api.un.matrix(metric), [metric]);
  const space = useAsync(
    () => (countries.length && rangeOk ? Promise.all([
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

  /** Show a tab from its top: when the tab bar is held under the header, the page returns to it. */
  const chooseView = (next: View) => {
    update({ v: next === "trend" ? null : next });
    const anchor = document.getElementById("views");
    if (anchor && anchor.getBoundingClientRect().top < 0) anchor.scrollIntoView?.({ block: "start" });
  };

  /** Open a speech from anywhere on the page: Close reading shows it, the page goes there and focus moves to its
   *  heading. Any delegation can be read, whether or not it is in the chart. */
  const openSpeech = useCallback((code: string, y: number) => {
    update({ v: "read" });
    setReading({ country: code, year: y });
    setArrivals((n) => n + 1);
  }, [params]);
  // Once Close reading has rendered with the chosen speech, go there and move focus to its heading
  useEffect(() => {
    if (!arrivals || view !== "read") return;
    document.getElementById("views")?.scrollIntoView?.({ behavior: scrollBehavior(), block: "start" });
    document.getElementById("close-reading-title")?.focus({ preventScroll: true });
  }, [arrivals, view]);
  const readCountry = reading?.country && known.has(reading.country) ? reading.country
    : countries[0] ?? summary.countries[0]?.code;
  // The years a delegation spoke: from the all-country matrix (any delegation), or the chart's series meanwhile
  const readYears = useMemo(() => {
    const values = readCountry ? matrix.data?.values[readCountry] : undefined;
    if (matrix.data && values) return matrix.data.years.filter((_, i) => values[i] !== null).reverse();
    const s = series.data?.series.find((x) => x.country === readCountry);
    return s ? s.points.map((p) => p.year).sort((a, b) => b - a) : [];
  }, [matrix.data, series.data, readCountry]);
  const readOptions = useMemo(() => {
    const inChart = countries.map((c) => summary.countries.find((x) => x.code === c)).filter(Boolean) as CountryInfo[];
    const others = summary.countries.filter((c) => !countries.includes(c.code)).sort((a, b) => a.name.localeCompare(b.name));
    return { inChart, others };
  }, [countries.join(","), summary]);
  const readYear = reading && reading.country === readCountry && readYears.includes(reading.year)
    ? reading.year : readYears[0];

  return (
    <>
      <div className="page-intro">
        <h1>UN General Debate, <span className="nowrap">{firstYear}–{lastYear}</span></h1>
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
          <YearInput id="year-from" label="From" value={start} min={firstYear} max={lastYear} invalid={!rangeOk}
            onCommit={(y) => update({ from: String(y) })} />
          <YearInput id="year-to" label="To" value={end} min={firstYear} max={lastYear} invalid={!rangeOk}
            onCommit={(y) => update({ to: String(y) })} />
          <MetricSelect value={metric} onChange={(m) => update({ m })} keywords={summary.keywords} />
        </div>
        {!rangeOk && <p className="field-error" role="alert">The start year is after the end year.</p>}
      </div>

      <div id="views" />
      <div className="view-tabs" role="tablist" aria-label="Views of the speeches" onKeyDown={(e) => {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        const i = VIEWS.findIndex(([key]) => key === view);
        const next = VIEWS[(i + (e.key === "ArrowRight" ? 1 : VIEWS.length - 1)) % VIEWS.length][0];
        chooseView(next);
        document.getElementById(`view-tab-${next}`)?.focus();
      }}>
        {VIEWS.map(([key, text, short]) => (
          <button key={key} id={`view-tab-${key}`} type="button" role="tab" aria-selected={view === key}
            aria-label={text} aria-controls="view-panel" tabIndex={view === key ? 0 : -1} onClick={() => chooseView(key)}>
            <span className="nav-long">{text}</span><span className="nav-short">{short}</span>
          </button>
        ))}
      </div>

      <div id="view-panel" role="tabpanel" aria-labelledby={`view-tab-${view}`}>
        {view === "trend" && (
          <>
            <div className="card">
              <div className="card-head">
                <h2>{label}</h2>
                <DownloadLink href={api.un.exportUrl({ countries, start, end })}>Download selection (CSV)</DownloadLink>
              </div>
              <div className="row chart-options">
                <label className="checkbox">
                  <input type="checkbox" checked={showAverage} onChange={(e) => update({ avg: e.target.checked ? null : "0" })} />
                  Average of all countries
                </label>
                <label className="checkbox">
                  <input type="checkbox" checked={showEvents} onChange={(e) => update({ ev: e.target.checked ? null : "0" })} />
                  Key events
                </label>
              </div>
              {!rangeOk ? (
                <p className="empty">Choose a start year before the end year.</p>
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
                <div className="chart-loading"><Loading /></div>
              )}
              <Limitations />
            </div>

            <div className="card">
              <h2>Biggest shifts</h2>
              <p className="muted small">Largest changes from one statement to the next. Pick a row to read that speech.</p>
              {!rangeOk ? <p className="empty">Choose a start year before the end year.</p>
                : shifts.error ? <Notice kind="error" onRetry={shifts.reload}>{shifts.error}</Notice>
                : !shifts.data ? <Loading />
                : !shifts.data.length ? <p className="empty">Not enough data.</p> : (
                  <div className="table-wrap" tabIndex={0} role="region" aria-label="Biggest shifts">
                    <table>
                      <thead>
                        <tr><th>Country</th><th>Years</th><th className="num">Change</th><th className="num">New value</th></tr>
                      </thead>
                      <tbody>
                        {shifts.data.map((s) => (
                          <tr key={`${s.country}-${s.year}`} className="clickable"
                            onClick={() => openSpeech(s.country, s.year)}>
                            <td><RowLink onClick={() => openSpeech(s.country, s.year)}>{s.name}</RowLink></td>
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
          </>
        )}

        {view === "year" && (
          <>
            <div className="card">
              <div className="card-head">
                <h2>Year by year</h2>
                <div className="tabs" role="tablist" aria-label="Shown as" onKeyDown={(e) => {
                  if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
                  const next = yearView === "flags" ? "hall" : "flags";
                  setYearView(next);
                  document.getElementById(`year-tab-${next}`)?.focus();
                }}>
                  {([["flags", "Flags"], ["hall", "Assembly hall"]] as const).map(([key, text]) => (
                    <button key={key} id={`year-tab-${key}`} type="button" role="tab" aria-selected={yearView === key}
                      aria-controls="year-panel" tabIndex={yearView === key ? 0 : -1}
                      onClick={() => setYearView(key)}>{text}</button>
                  ))}
                </div>
              </div>
              <div id="year-panel" role="tabpanel" aria-labelledby={`year-tab-${yearView}`}>
                {matrix.error ? <Notice kind="error" onRetry={matrix.reload}>{matrix.error}</Notice>
                  : !matrix.data ? <div className="view3d-loading"><Loading /></div> : (
                    <Suspense fallback={<div className="view3d-loading"><Loading label="Loading 3D…" /></div>}>
                      {yearView === "flags" ? (
                        <FlagLine matrix={matrix.data} metricLabel={label} names={names}
                          format={formatValue} year={year} onYearChange={setYear}
                          chosen={chosenFlags} onPick={openSpeech} />
                      ) : (
                        <AssemblyHall matrix={matrix.data} metricLabel={label} names={names}
                          format={formatValue} year={year} onYearChange={setYear}
                          chosen={chosenFlags} onPick={openSpeech} />
                      )}
                    </Suspense>
                  )}
                {matrix.data && (
                  <YearTable matrix={matrix.data} year={year} names={names} label={label} format={formatValue}
                    onPick={openSpeech} />
                )}
              </div>
            </div>
            <RankingCard metric={metric} year={year} names={names} onPick={openSpeech} />
          </>
        )}

        {view === "space" && (
          <div className="card">
            <div className="card-head">
              <h2>Rhetoric space</h2>
              <span className="small muted">hostile × cooperative words × time, {start}–{end}</span>
            </div>
            {space.error ? <Notice kind="error" onRetry={space.reload}>{space.error}</Notice>
              : !countries.length ? <p className="empty">Choose at least one country.</p>
              : !rangeOk ? <p className="empty">Choose a start year before the end year.</p>
              : !space.data ? <div className="space-loading"><Loading /></div> : (
                <Suspense fallback={<div className="space-loading"><Loading label="Loading 3D…" /></div>}>
                  <RhetoricSpace series={spaceSeries} onPick={openSpeech} />
                </Suspense>
              )}
            <p className="small muted">
              Each line is one country&apos;s path through the years. Points above the shaded plane used more cooperative
              than hostile words that year.
            </p>
            {spaceSeries.length > 0 && <SpaceTable series={spaceSeries} onPick={openSpeech} />}
          </div>
        )}

        {view === "read" && (
          <CloseReading
            inChart={readOptions.inChart}
            others={readOptions.others}
            country={readCountry}
            year={readYear}
            years={readYears}
            onChange={(country, y) => setReading({ country, year: y ?? 0 })}
          />
        )}
      </div>

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

function scrollBehavior(): ScrollBehavior {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
}

/** A year field that can be typed into. A complete year in range applies at once (so the arrow keys and the
 *  spinner still step); anything else is checked against the range on Enter or when the field is left. */
function YearInput({ id, label, value, min, max, onCommit, invalid = false }: {
  id: string; label: string; value: number; min: number; max: number; onCommit: (year: number) => void;
  /** Marked as wrong from outside (a start year after the end year). */
  invalid?: boolean;
}) {
  const [draft, setDraft] = useState(String(value));
  const [changed, setChanged] = useState<string | null>(null);   // "Changed to 2025": a typed year was out of range
  useEffect(() => setDraft(String(value)), [value]);
  const isYear = (s: string) => /^\d{4}$/.test(s.trim()) && Number(s) >= min && Number(s) <= max;
  const finish = () => {
    if (!draft.trim()) return setDraft(String(value));
    const year = clamp(Number(draft), min, max);
    if (String(year) !== draft.trim()) setChanged(`Changed to ${year}: the data runs ${min}–${max}.`);
    setDraft(String(year));
    if (year !== value) onCommit(year);
  };
  const ok = isYear(draft);
  const note = !ok ? `${min}–${max}` : changed;
  return (
    <div className="field year-field">
      <label htmlFor={id}>{label}</label>
      <input id={id} type="number" inputMode="numeric" min={min} max={max} value={draft}
        aria-invalid={!ok || invalid ? true : undefined} aria-describedby={note ? `${id}-note` : undefined}
        onChange={(e) => {
          const next = e.target.value;
          setDraft(next);
          setChanged(null);
          if (isYear(next) && Number(next) !== value) onCommit(Number(next));
        }}
        onBlur={finish}
        onKeyDown={(e) => {
          if (e.key === "Enter") finish();
        }} />
      {note && <span className="hint" id={`${id}-note`} role="status">{note}</span>}
    </div>
  );
}

/** A country's name in a table row, as a button: the row opens that speech from the keyboard too. */
function RowLink({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className="row-link" onClick={(e) => {
      e.stopPropagation();
      onClick();
    }}>{children}</button>
  );
}

/** The year shown by the flags and the hall, as a table: every delegation that spoke, highest first. */
function YearTable({ matrix, year, names, label, format, onPick }: {
  matrix: Matrix; year: number; names: Record<string, string>; label: string; format: (v: number) => string;
  onPick: (code: string, year: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const i = matrix.years.indexOf(year);
  const rows = open && i >= 0
    ? matrix.countries.flatMap((c) => {
      const value = matrix.values[c.code]?.[i];
      return value === null || value === undefined ? []
        : [{ code: c.code, name: speakerName(c.code, year, names[c.code] ?? c.name), value }];
    }).sort((a, b) => b.value - a.value)
    : [];
  return (
    <details className="table-view" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>Show {year} as a table</summary>
      {open && (rows.length ? (
        <div className="table-wrap tall" tabIndex={0} role="region" aria-label={`${label} in ${year}`}>
          <table>
            <thead><tr><th className="num">#</th><th>Country</th><th className="num">{label}</th></tr></thead>
            <tbody>
              {rows.map((r, k) => (
                <tr key={r.code} className="clickable" onClick={() => onPick(r.code, year)}>
                  <td className="num">{k + 1}</td>
                  <td><RowLink onClick={() => onPick(r.code, year)}>{r.name}</RowLink></td>
                  <td className="num">{format(r.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="empty">No statements in {year}.</p>)}
    </details>
  );
}

/** The rhetoric space's points as a table: one row per country and year. */
function SpaceTable({ series, onPick }: {
  series: { key: string; label: string; points: { year: number; hostility: number | null; cooperation: number | null }[] }[];
  onPick: (code: string, year: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const rows = open ? series.flatMap((s) => s.points.map((p) => ({ code: s.key, name: s.label, ...p }))) : [];
  const cell = (v: number | null) => (v === null ? "–" : v.toFixed(1));
  return (
    <details className="table-view" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>Show the points as a table</summary>
      {open && (
        <div className="table-wrap tall" tabIndex={0} role="region" aria-label="Rhetoric space points">
          <table>
            <thead>
              <tr><th>Country</th><th>Year</th><th className="num">Hostile / 1,000</th><th className="num">Cooperative / 1,000</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.code}-${r.year}`} className="clickable" onClick={() => onPick(r.code, r.year)}>
                  <td>{r.name}</td>
                  <td><RowLink onClick={() => onPick(r.code, r.year)}>{r.year}</RowLink></td>
                  <td className="num">{cell(r.hostility)}</td>
                  <td className="num">{cell(r.cooperation)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </details>
  );
}

function RankingCard({ metric, year, names, onPick }: {
  metric: string; year: number; names: Record<string, string>; onPick: (code: string, year: number) => void;
}) {
  const meta = useMeta();
  const [showAll, setShowAll] = useState(false);
  const [filter, setFilter] = useState("");
  const ranking = useAsync(() => api.un.ranking(year, metric), [year, metric]);
  const rows = (ranking.data?.rows ?? []).filter((r) =>
    !filter || `${r.name} ${r.country}`.toLowerCase().includes(filter.toLowerCase()));
  const visible = showAll || filter ? rows : rows.slice(0, 15);
  const values = (ranking.data?.rows ?? []).map((r) => r.value);
  const lo = Math.min(0, ...values);
  const hi = Math.max(0, ...values);
  const span = hi - lo || 1;
  const top = useMemo(() => (ranking.data?.rows ?? []).slice(0, 3)
    .map((r) => ({ country: r.country, name: speakerName(r.country, year, names[r.country] ?? r.name), value: r.value,
      flag: speakerFlag(r.country, year) })), [ranking.data, names, year]);
  const formatValue = useCallback((v: number) => formatMetric(metric, v), [metric]);

  return (
    <div className="card">
      <div className="card-head">
        <h2>Country ranking</h2>
        <div className="row">
          <div className="field">
            <label htmlFor="rank-filter">Find</label>
            <input id="rank-filter" type="search" value={filter} placeholder="Country" style={{ width: "9rem" }}
              onChange={(e) => setFilter(e.target.value)} />
          </div>
        </div>
      </div>
      <p className="muted small">{metricLabel(metric, meta.metrics)} in {year}, highest first. The year follows the
        player above.</p>
      {top.length > 0 && ranking.data && !meta.metrics.find((m) => m.id === metric)?.higher_is_worse && (
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
                <thead><tr><th className="num">#</th><th>Country</th><th className="num">Value</th><th aria-hidden="true" /></tr></thead>
                <tbody>
                  {visible.map((r) => (
                    <tr key={r.country} className="clickable" onClick={() => onPick(r.country, year)}>
                      <td className="num">{r.rank}</td>
                      <td><RowLink onClick={() => onPick(r.country, year)}>
                        {speakerName(r.country, year, names[r.country] ?? r.name)}</RowLink></td>
                      <td className="num">{formatMetric(metric, r.value)}</td>
                      <td className="bar-col" aria-hidden="true">
                        <span className="bar-track">
                          <span className="bar-fill" style={{
                            left: `${((Math.min(0, r.value) - lo) / span) * 100}%`,
                            width: `${Math.max((Math.abs(r.value) / span) * 100, 0.5)}%`,
                          }} />
                        </span>
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

/** A transcript line such as "FOREIGN MINISTER LAVROV, MINISTER FOR…": all capitals, not a sentence of the speech. */
function isTranscriptHeader(text: string) {
  const letters = text.replace(/[^A-Za-z]/g, "");
  return letters.length >= 8 && letters.replace(/[^A-Z]/g, "").length / letters.length > 0.8;
}

function CloseReading({ inChart, others, country, year, years, onChange }: {
  inChart: CountryInfo[]; others: CountryInfo[]; country?: string; year?: number; years: number[];
  onChange: (country: string, year?: number) => void;
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
  const bar = useRef<HTMLDivElement>(null);
  const [jump, setJump] = useState<number | null>(null);          // a sentence picked from the notable lists
  useEffect(() => setJump(null), [country, year]);
  const position = useMemo(() => new Map(flat.map((s, i) => [s.index, i])), [flat]);   // scored number → reading order
  // Each notable sentence once (in the first list it belongs to), and no transcript headers
  const notable = useMemo(() => {
    const seen = new Set<number>();
    const groups = {} as Record<NotableSentence["kind"], NotableSentence[]>;
    for (const kind of Object.keys(KIND_TITLES) as NotableSentence["kind"][]) {
      groups[kind] = (statement.data?.sentences ?? []).filter((s) => s.kind === kind && !isTranscriptHeader(s.sentence)
        && !seen.has(s.position));
      groups[kind].forEach((s) => seen.add(s.position));
    }
    return groups;
  }, [statement.data]);
  const goTo = (scored: number) => {
    const i = position.get(scored);
    if (i === undefined) return;
    if (listening) speech.seek(i);
    else setJump(i);
    document.querySelector('[data-testid="full-speech"]')?.scrollIntoView?.({ behavior: scrollBehavior(), block: "nearest" });
  };
  const name = statement.data ? speakerName(statement.data.country, statement.data.year, statement.data.name) : "";
  return (
    <div className="card" id="close-reading">
      <div className="card-head">
        <h2 id="close-reading-title" tabIndex={-1}>Close reading</h2>
        <div className="row">
          <div className="field">
            <label htmlFor="read-country">Delegation</label>
            <select id="read-country" value={country} onChange={(e) => onChange(e.target.value)}>
              {inChart.length > 0 && (
                <optgroup label="In the chart">
                  {inChart.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
                </optgroup>
              )}
              <optgroup label="All delegations">
                {others.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
              </optgroup>
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
        : !statement.data ? (statement.loading ? <div className="reading-loading"><Loading /></div>
          : <p className="empty">No statement for this delegation.</p>) : (
          <div style={{ opacity: statement.loading ? 0.6 : 1 }}>
            <div className="reading-head">
              <Suspense fallback={<div className="rostrum3d" />}>
                <Rostrum code={speakerFlag(statement.data.country, statement.data.year)} name={name}
                  year={statement.data.year} session={statement.data.session} speaking={speech.status === "playing"} />
              </Suspense>
              <div>
                <h3 className="reading-title">{name}</h3>
                <p className="muted small">
                  Session {statement.data.session} · {statement.data.year} ·{" "}
                  {plural(statement.data.counts.words, "word")} · {plural(statement.data.counts.sentences, "scored sentence")}
                </p>
                {fullText.error && !fullText.loading
                  ? <p className="muted small">The full text of this speech is not available.</p>
                  : <ListenBar speech={speech} what="this speech" barRef={bar} />}
                {listening && <NowReading sentence={flat[speech.current]} />}
              </div>
            </div>
            <MiniPlayer speech={speech} anchor={bar} what={`${name}'s speech`} />
            <div className="reading-body">
              <div className="reading-main">
                <div className="card-head">
                  <h3>The speech</h3>
                  <HighlightKeys />
                </div>
                {reading ? (
                  <ReadingText reading={reading} current={listening ? speech.current : jump} label="The speech"
                    onPick={speech.supported ? speech.play : undefined} testId="full-speech" />
                ) : fullText.loading ? <Loading /> : <p className="muted small">The full text is not available.</p>}
              </div>
              <div className="reading-side" role="region" aria-label="Notable sentences">
                {(Object.keys(KIND_TITLES) as NotableSentence["kind"][]).map((kind) => (
                  <div key={kind}>
                    <h3 className="kind-title"><span className={`dot ${kind}`} aria-hidden="true" />{KIND_TITLES[kind]}</h3>
                    {notable[kind].length ? (
                      <ul className="sentences">
                        {notable[kind].map((s) => (
                          <li key={`${kind}-${s.position}`}>
                            <HighlightedText text={s.sentence} spans={s.highlights} />
                            <span className="score">
                              {kind === "negative" ? `VADER ${fixed(s.score, 2)}` : `${s.score} ${kind} word${s.score === 1 ? "" : "s"}`} ·{" "}
                              {position.has(s.position) ? (
                                <button type="button" className="btn link listen-from"
                                  aria-label={`Show sentence ${s.position + 1} in the speech`}
                                  onClick={() => goTo(s.position)}>
                                  sentence {s.position + 1}
                                </button>
                              ) : `sentence ${s.position + 1}`}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : <p className="empty">None.</p>}
                  </div>
                ))}
              </div>
            </div>
            <MetricCards metrics={statement.data.metrics} />
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

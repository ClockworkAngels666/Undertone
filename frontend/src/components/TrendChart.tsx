import { useMemo } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Point } from "../api/types";
import { AVERAGE_COLOR, useColorScheme } from "../lib/colors";

export interface ChartSeries {
  key: string;
  label: string;
  color: string;
  dashed?: boolean;
  points: Point[];
}

interface Props {
  series: ChartSeries[];
  average?: Point[] | null;
  averageLabel?: string;
  events?: { year: number; label: string }[];
  format: (value: number) => string;
  tickFormat: (value: number) => string;
  valueLabel: string;
  reloading?: boolean;
}

const AVERAGE_KEY = "__average";

/** Year-by-year line chart: one fixed colour per series, optional average line and event markers. */
export default function TrendChart({ series, average, averageLabel = "All-country average", events = [], format,
  tickFormat, valueLabel, reloading }: Props) {
  const scheme = useColorScheme();
  // Chart chrome follows the page theme (see styles.css); series colours come from lib/colors.ts.
  const ink = scheme === "dark" ? { grid: "#1f3346", axis: "#8fa3b7", text: "#b9cad8", surface: "#10202f" }
    : { grid: "#dfe6ed", axis: "#7a8794", text: "#3d4c5c", surface: "#ffffff" };

  const { rows, years } = useMemo(() => {
    const byYear = new Map<number, Record<string, number | null>>();
    const add = (key: string, points: Point[]) => {
      for (const p of points) {
        const row = byYear.get(p.year) ?? { year: p.year };
        row[key] = p.value;
        byYear.set(p.year, row);
      }
    };
    series.forEach((s) => add(s.key, s.points));
    if (average) add(AVERAGE_KEY, average);
    const sorted = [...byYear.values()].sort((a, b) => (a.year as number) - (b.year as number));
    return { rows: sorted, years: sorted.map((r) => r.year as number) };
  }, [series, average]);

  const hasData = series.some((s) => s.points.some((p) => p.value !== null));
  if (!hasData) return <p className="empty">No data for this selection.</p>;

  const first = years[0];
  const last = years[years.length - 1];
  const shownEvents = events.filter((e) => e.year >= first && e.year <= last);
  const showDots = last - first <= 25;
  const labelEnds = series.length <= 4;
  const endPoints = endLabelPositions(series);

  return (
    <figure style={{ margin: 0 }}>
      <ul className="chart-legend" aria-label="Legend">
        {series.map((s) => (
          <li key={s.key}>
            <span className={`line-key${s.dashed ? " dashed" : ""}`} style={{ borderColor: s.color }} />
            {s.label}
          </li>
        ))}
        {average && (
          <li>
            <span className="line-key dashed" style={{ borderColor: AVERAGE_COLOR[scheme] }} />
            {averageLabel}
          </li>
        )}
      </ul>
      <div className={`chart-box${reloading ? " reloading" : ""}`} role="img"
        aria-label={`Line chart of ${valueLabel} by year, ${first}–${last}. The same values are in the table below.`}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: shownEvents.length ? 52 : 12, right: labelEnds ? 96 : 16, bottom: 4, left: 0 }}>
            <CartesianGrid vertical={false} stroke={ink.grid} />
            <XAxis dataKey="year" type="number" domain={[first, last]} allowDecimals={false}
              tick={{ fill: ink.axis, fontSize: 12 }} tickLine={false} axisLine={{ stroke: ink.grid }} />
            <YAxis tickFormatter={tickFormat} tick={{ fill: ink.axis, fontSize: 12 }} tickLine={false}
              axisLine={false} width={44} domain={["auto", "auto"]} />
            {shownEvents.map((e, i) => (
              <ReferenceLine key={e.year} x={e.year} stroke={ink.grid} strokeWidth={1}
                label={{ value: e.label, position: "top", fill: ink.axis, fontSize: 11, offset: 6 + 15 * (i % 3) }} />
            ))}
            {average && (
              <Line dataKey={AVERAGE_KEY} name={averageLabel} stroke={AVERAGE_COLOR[scheme]} strokeWidth={1.5}
                strokeDasharray="5 4" dot={false} activeDot={false} connectNulls isAnimationActive={false} />
            )}
            {series.map((s) => (
              <Line key={s.key} dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={2}
                strokeDasharray={s.dashed ? "6 4" : undefined} strokeLinecap="round" strokeLinejoin="round"
                connectNulls isAnimationActive={false}
                dot={showDots ? { r: 3.5, fill: s.color, stroke: ink.surface, strokeWidth: 2 } : false}
                activeDot={{ r: 5, fill: s.color, stroke: ink.surface, strokeWidth: 2 }}
                label={labelEnds ? (props: LabelProps) => <EndLabel {...props} series={s} end={endPoints[s.key]}
                  color={ink.text} years={years} /> : undefined} />
            ))}
            <Tooltip content={(props) => <ChartTooltip {...props} series={series} averageColor={AVERAGE_COLOR[scheme]}
              averageLabel={average ? averageLabel : null} format={format} />}
              cursor={{ stroke: ink.axis, strokeWidth: 1 }} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <details className="table-view">
        <summary>Show the numbers as a table</summary>
        <div className="table-wrap tall">
          <table>
            <thead>
              <tr>
                <th>Year</th>
                {series.map((s) => <th key={s.key} className="num">{s.label}</th>)}
                {average && <th className="num">{averageLabel}</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.year as number}>
                  <td>{r.year}</td>
                  {series.map((s) => <td key={s.key} className="num">{fmt(r[s.key], format)}</td>)}
                  {average && <td className="num">{fmt(r[AVERAGE_KEY], format)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}

function fmt(value: number | null | undefined, format: (v: number) => string) {
  return value === null || value === undefined ? "–" : format(value);
}

/**
 * The last point of each series, for its end label. Labels whose values sit too close to an already
 * labelled line are dropped instead of being nudged away from their line (the legend still names it).
 */
function endLabelPositions(series: ChartSeries[]) {
  const values = series.flatMap((s) => s.points.map((p) => p.value).filter((v): v is number => v !== null));
  const minGap = (Math.max(...values) - Math.min(...values) || 1) * 0.07;
  const ends: Record<string, { year: number; value: number } | undefined> = {};
  const candidates = series
    .map((s) => ({ key: s.key, last: [...s.points].reverse().find((p) => p.value !== null) }))
    .filter((c) => c.last)
    .sort((a, b) => (b.last!.value as number) - (a.last!.value as number));
  const kept: { year: number; value: number }[] = [];
  for (const c of candidates) {
    const end = { year: c.last!.year, value: c.last!.value as number };
    if (kept.some((k) => Math.abs(k.year - end.year) <= 2 && Math.abs(k.value - end.value) < minGap)) continue;
    kept.push(end);
    ends[c.key] = end;
  }
  return ends;
}

interface LabelProps {
  x?: number | string;
  y?: number | string;
  index?: number;
  value?: unknown;
}

function EndLabel({ x, y, index, series, end, color, years }: LabelProps & {
  series: ChartSeries; end?: { year: number; value: number }; color: string; years: number[];
}) {
  if (!end || index === undefined || years[index] !== end.year || typeof x !== "number" || typeof y !== "number") {
    return null;
  }
  return (
    <g>
      <line x1={x + 6} x2={x + 12} y1={y} y2={y} stroke={series.color} strokeWidth={2} />
      <text x={x + 16} y={y} dy="0.32em" fill={color} fontSize={12}>{series.label}</text>
    </g>
  );
}

interface TooltipProps {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: unknown }>;
  label?: string | number;
}

function ChartTooltip({ active, payload, label, series, format, averageColor, averageLabel }: TooltipProps & {
  series: ChartSeries[]; format: (v: number) => string; averageColor: string; averageLabel: string | null;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload as Record<string, number | null>;
  const entries = series
    .map((s) => ({ key: s.key, label: s.label, color: s.color, dashed: s.dashed, value: row[s.key] }))
    .filter((e) => e.value !== null && e.value !== undefined)
    .sort((a, b) => (b.value as number) - (a.value as number));
  if (averageLabel && row[AVERAGE_KEY] !== null && row[AVERAGE_KEY] !== undefined) {
    entries.push({ key: AVERAGE_KEY, label: averageLabel, color: averageColor, dashed: true, value: row[AVERAGE_KEY] });
  }
  return (
    <div className="tooltip">
      <div className="year">{label}</div>
      {entries.map((e) => (
        <div className="row" key={e.key}>
          <span className={`line-key${e.dashed ? " dashed" : ""}`} style={{ borderColor: e.color }} />
          <strong>{format(e.value as number)}</strong>
          <span className="name">{e.label}</span>
        </div>
      ))}
    </div>
  );
}

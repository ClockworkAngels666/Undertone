import type { MetricInfo } from "../api/types";

export const KEYWORD_PREFIX = "kw::";

export function isKeywordMetric(id: string) {
  return id.startsWith(KEYWORD_PREFIX);
}

/** Display name of a metric id, including keyword rates ("kw::sanction*"). */
export function metricLabel(id: string, metrics: MetricInfo[]) {
  if (isKeywordMetric(id)) return `“${id.slice(KEYWORD_PREFIX.length).replace(/\*/g, "…")}” per 1,000 words`;
  return metrics.find((m) => m.id === id)?.label ?? id;
}

export function formatMetric(id: string, value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "–";
  switch (id) {
    case "tone_balance":
    case "vader_mean":
      return signed(value, 2);
    case "negative_share":
      return `${Math.round(value * 100)}%`;
    default:
      return value.toFixed(isKeywordMetric(id) ? 2 : 1);
  }
}

/** A difference between two metric values, in the metric's own unit. */
export function formatDelta(id: string, delta: number): string {
  if (id === "negative_share") return `${delta >= 0 ? "+" : "−"}${Math.abs(Math.round(delta * 100))} pts`;
  return signed(delta, id === "tone_balance" || id === "vader_mean" ? 2 : 1);
}

export function signed(value: number, digits: number) {
  const fixed = Math.abs(value).toFixed(digits);
  if (Number(fixed) === 0) return (0).toFixed(digits);
  return `${value > 0 ? "+" : "−"}${fixed}`;
}

/** A share as a whole percentage, rounded down so "more than 99%" is never shown as "more than 100%". */
export function percent(share: number) {
  return `${Math.floor(share * 100)}%`;
}

export function compactNumber(n: number) {
  return new Intl.NumberFormat("en", { notation: n >= 10_000 ? "compact" : "standard" }).format(n);
}

/** Axis tick formatting for a metric. */
export function tickFormat(id: string) {
  return (value: number) => {
    if (id === "negative_share") return `${Math.round(value * 100)}%`;
    if (id === "tone_balance" || id === "vader_mean") return value.toFixed(1);
    return Number.isInteger(value) ? String(value) : value.toFixed(1);
  };
}

/** "1 text", "3 texts" (with thousands separators). */
export function plural(n: number, singular: string, pluralForm = `${singular}s`) {
  return `${n.toLocaleString("en")} ${n === 1 ? singular : pluralForm}`;
}

/** Abbreviated country name for 3D labels ("Bosnia and Herzegovina" → "Bosnia and Her."). */
export function shortName(name: string, max = 16) {
  return name.length > max ? `${name.slice(0, max - 2).trimEnd()}.` : name;
}

/** Whole words up to `max` characters, then "…" ("Saint Vincent and the Grenadines" → "Saint Vincent…"). */
export function fitWords(text: string, max: number) {
  if (text.length <= max) return text;
  const space = text.lastIndexOf(" ", max - 1);
  return `${(space > 0 ? text.slice(0, space) : text.slice(0, max - 1)).trimEnd()}…`;
}

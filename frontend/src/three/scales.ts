// Colour scales for the 3D views. Sequential = one hue, light → dark; diverging = two opposite hues with a
// neutral grey midpoint (never a hue at zero). Values are mapped to hex strings so they work in canvas and three.js.

export interface Scale {
  kind: "sequential" | "diverging";
  domain: [number, number];
  color: (value: number | null | undefined) => string;
  /** Colour stops for a CSS gradient legend, left to right. */
  stops: string[];
}

type RGB = [number, number, number];

const hex = (c: string): RGB => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)) as RGB;
const toHex = (c: RGB) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
const mix = (a: RGB, b: RGB, t: number): RGB => [0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * t) as RGB;

function ramp(stops: string[]) {
  const rgb = stops.map(hex);
  return (t: number) => {
    const x = Math.min(1, Math.max(0, t)) * (rgb.length - 1);
    const i = Math.min(rgb.length - 2, Math.floor(x));
    return toHex(mix(rgb[i], rgb[i + 1], x - i));
  };
}

// Blue (conciliatory / more) and red (confrontational / worse) ramps from the chart palette.
const BLUE = ["#cde2fb", "#86b6ef", "#3987e5", "#1c5cab", "#0d366b"];
const RED = ["#fbd5d0", "#f2a097", "#e66767", "#c33a39", "#8a1c1c"];
const NEUTRAL = { light: "#d5dbe1", dark: "#4a5a6a" };
export const NO_DATA = { light: "#c3ccd5", dark: "#24384b" };

/** Metrics where a higher value is worse get the red ramp; signed metrics get the diverging scale. */
export function scaleFor(metric: string, values: number[], scheme: "light" | "dark" = "light"): Scale {
  const finite = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  const q = (p: number) => (finite.length ? finite[Math.min(finite.length - 1, Math.floor(p * finite.length))] : 0);
  const noData = NO_DATA[scheme];
  if (metric === "tone_balance" || metric === "vader_mean") {
    const limit = metric === "tone_balance" ? 1 : Math.max(0.05, Math.abs(q(0.02)), Math.abs(q(0.98)));
    const neg = ramp([NEUTRAL[scheme], ...RED.slice(1)]);
    const pos = ramp([NEUTRAL[scheme], ...BLUE.slice(1)]);
    return {
      kind: "diverging",
      domain: [-limit, limit],
      color: (v) => (v === null || v === undefined || !Number.isFinite(v) ? noData
        : v < 0 ? neg(-v / limit) : pos(v / limit)),
      stops: [RED[4], RED[2], NEUTRAL[scheme], BLUE[2], BLUE[4]],
    };
  }
  const max = Math.max(q(0.97), 1e-6);
  const stops = metric === "hostility" || metric === "negative_share" ? RED : BLUE;
  const scale = ramp(stops);
  return {
    kind: "sequential",
    domain: [0, max],
    color: (v) => (v === null || v === undefined || !Number.isFinite(v) ? noData : scale(v / max)),
    stops,
  };
}

/** 0..1 magnitude of a value on a scale (used for column heights). */
export function magnitude(scale: Scale, value: number) {
  const [lo, hi] = scale.domain;
  if (scale.kind === "diverging") return Math.min(1, Math.abs(value) / Math.max(Math.abs(lo), Math.abs(hi)));
  return Math.min(1, Math.max(0, value / (hi || 1)));
}

import { geoBounds, geoCentroid, geoContains, geoEquirectangular, geoPath } from "d3-geo";
import type { Feature, FeatureCollection, Geometry, MultiPolygon } from "geojson";
import { feature, merge } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import { ISO_NUMERIC } from "./isoNumeric";

export interface CountryShape {
  code: string;               // ISO alpha-3, as in the UN corpus
  feature: Feature<Geometry>;
  centroid: [lon: number, lat: number];
}

export interface World {
  countries: CountryShape[];
  land: Feature<MultiPolygon>;
  /** Every code that can be placed on the globe (map shapes plus small and historical states). */
  anchorCodes: string[];
  /** Where to place a country's marker: its shape's centroid, or a capital for states too small for the map. */
  anchor: (code: string) => [lon: number, lat: number] | undefined;
  /** The country under a longitude/latitude, if any. */
  countryAt: (lon: number, lat: number) => string | undefined;
  /** Is there land at this longitude/latitude? (Fast: reads a small pre-drawn land image.) */
  isLand: (lon: number, lat: number) => boolean;
}

/** Draw the land once onto a small equirectangular image and answer "is this land?" from its pixels. */
function landLookup(land: Feature<MultiPolygon>, width = 720, height = 360) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return (lon: number, lat: number) => geoContains(land, [lon, lat]);
  ctx.beginPath();
  geoPath(geoEquirectangular().scale(width / (2 * Math.PI)).translate([width / 2, height / 2]), ctx)(land);
  ctx.fill();
  const alpha = ctx.getImageData(0, 0, width, height).data;
  return (lon: number, lat: number) => {
    const x = Math.min(width - 1, Math.max(0, Math.floor(((lon + 180) / 360) * width)));
    const y = Math.min(height - 1, Math.max(0, Math.floor(((90 - lat) / 180) * height)));
    return alpha[(y * width + x) * 4 + 3] > 127;
  };
}

/** Bounding-box test that copes with shapes crossing the date line (Russia, Fiji). */
function inBounds([[x0, y0], [x1, y1]]: [[number, number], [number, number]], lon: number, lat: number) {
  if (lat < y0 || lat > y1) return false;
  return x0 <= x1 ? lon >= x0 && lon <= x1 : lon >= x0 || lon <= x1;
}

// Capitals (approximate) of UN delegations missing from the 1:110m Natural Earth map: small states and
// historical members. The EU is left out: it is not a state and would sit on top of Belgium.
const SMALL_STATES: Record<string, [number, number]> = {
  AND: [1.52, 42.51], ATG: [-61.85, 17.12], BHR: [50.59, 26.23], BRB: [-59.62, 13.1], COM: [43.26, -11.7],
  CPV: [-23.51, 14.93], DMA: [-61.39, 15.3], FSM: [158.16, 6.92], GRD: [-61.75, 12.06], KIR: [173.0, 1.45],
  KNA: [-62.72, 17.3], LCA: [-60.99, 14.01], LIE: [9.52, 47.14], MCO: [7.42, 43.74], MDV: [73.51, 4.18],
  MHL: [171.38, 7.09], MLT: [14.51, 35.9], MUS: [57.5, -20.16], NRU: [166.92, -0.55], PLW: [134.62, 7.5],
  SGP: [103.85, 1.29], SMR: [12.45, 43.94], STP: [6.73, 0.34], SYC: [55.45, -4.62], TON: [-175.2, -21.14],
  TUV: [179.2, -8.52], VAT: [12.45, 41.9], VCT: [-61.23, 13.16], WSM: [-171.77, -13.83],
  CSK: [14.42, 50.08], DDR: [13.4, 52.52], YUG: [20.45, 44.79], YMD: [45.03, 12.79],
};

// Centroids that fall far from where people look for the country (overseas territories pull them away).
const ANCHOR_OVERRIDES: Record<string, [number, number]> = {
  FRA: [2.4, 46.6], NOR: [9.0, 61.0], USA: [-98.5, 39.5], RUS: [60.0, 58.0], CAN: [-100.0, 57.0],
  NLD: [5.3, 52.2], NZL: [172.5, -41.5], CHL: [-71.0, -33.5], DNK: [9.5, 56.0],
};

let cache: Promise<World> | null = null;

/** Load the world map once (Natural Earth 1:110m via world-atlas, public domain). */
export function loadWorld(): Promise<World> {
  cache ??= import("world-atlas/countries-110m.json").then((module) => {
    const topology = (module.default ?? module) as unknown as Topology<{ countries: GeometryCollection }>;
    const collection = feature(topology, topology.objects.countries) as FeatureCollection<Geometry>;
    const countries: CountryShape[] = [];
    for (const f of collection.features) {
      const code = ISO_NUMERIC[String(f.id ?? "")];
      if (!code) continue;
      countries.push({ code, feature: f, centroid: geoCentroid(f) as [number, number] });
    }
    const land = {
      type: "Feature",
      properties: {},
      geometry: merge(topology, topology.objects.countries.geometries as never[]),
    } as Feature<MultiPolygon>;
    const byCode = new Map(countries.map((c) => [c.code, c]));
    const bounds = countries.map((c) => geoBounds(c.feature) as [[number, number], [number, number]]);
    return {
      countries,
      land,
      anchorCodes: [...new Set([...countries.map((c) => c.code), ...Object.keys(SMALL_STATES)])],
      anchor: (code) => ANCHOR_OVERRIDES[code] ?? byCode.get(code)?.centroid ?? SMALL_STATES[code],
      // Cheap box check first; the exact (slow) polygon test only runs for the few candidates.
      countryAt: (lon, lat) => countries.find((c, i) => inBounds(bounds[i], lon, lat)
        && geoContains(c.feature, [lon, lat]))?.code,
      isLand: landLookup(land),
    };
  });
  return cache;
}

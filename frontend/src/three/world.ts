import { geoCentroid, geoContains, geoEquirectangular, geoPath } from "d3-geo";
import type { Feature, FeatureCollection, Geometry, MultiPolygon } from "geojson";
import { feature, merge } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import { ISO_NUMERIC } from "./isoCodes";

export interface World {
  land: Feature<MultiPolygon>;
  /** Where a country sits on the globe (its centroid, nudged for countries with far-flung territories). */
  anchor: (code: string) => [lon: number, lat: number] | undefined;
  /** Is there land at this longitude/latitude? (Fast: reads a small pre-drawn land image.) */
  isLand: (lon: number, lat: number) => boolean;
}

// Centroids that fall far from where people look for the country (overseas territories pull them away).
const ANCHOR_OVERRIDES: Record<string, [number, number]> = {
  FRA: [2.4, 46.6], NOR: [9.0, 61.0], USA: [-98.5, 39.5], RUS: [60.0, 58.0], CAN: [-100.0, 57.0],
  NLD: [5.3, 52.2], NZL: [172.5, -41.5], CHL: [-71.0, -33.5], DNK: [9.5, 56.0],
};

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

let cache: Promise<World> | null = null;

/** Load the world map once (Natural Earth 1:110m via world-atlas, public domain). */
export function loadWorld(): Promise<World> {
  cache ??= import("world-atlas/countries-110m.json").then((module) => {
    const topology = (module.default ?? module) as unknown as Topology<{ countries: GeometryCollection }>;
    const collection = feature(topology, topology.objects.countries) as FeatureCollection<Geometry>;
    const centroids = new Map<string, [number, number]>();
    for (const f of collection.features) {
      const code = ISO_NUMERIC[String(f.id ?? "")];
      if (code) centroids.set(code, geoCentroid(f) as [number, number]);
    }
    const land = {
      type: "Feature",
      properties: {},
      geometry: merge(topology, topology.objects.countries.geometries as never[]),
    } as Feature<MultiPolygon>;
    return {
      land,
      anchor: (code) => ANCHOR_OVERRIDES[code] ?? centroids.get(code),
      isLand: landLookup(land),
    };
  });
  return cache;
}

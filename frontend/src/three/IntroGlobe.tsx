import { useEffect, useRef } from "react";
import {
  AdditiveBlending,
  BackSide,
  BufferGeometry,
  CanvasTexture,
  Float32BufferAttribute,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  Points,
  PointsMaterial,
  QuadraticBezierCurve3,
  SphereGeometry,
} from "three";
import { createStage, lonLatToVector3, webglAvailable } from "./stage";
import { loadWorld } from "./world";

// Pairs of capitals linked by arcs: an abstract picture of diplomatic exchange (not data).
const LINKS: [string, string][] = [
  ["USA", "CHN"], ["RUS", "DEU"], ["BRA", "ZAF"], ["IND", "JPN"], ["EGY", "FRA"], ["MEX", "ESP"],
  ["AUS", "IDN"], ["NGA", "GBR"], ["CAN", "NOR"], ["ARG", "ITA"], ["VNM", "KOR"], ["TUR", "IRN"],
  ["KEN", "SAU"], ["PER", "USA"], ["CHN", "ETH"], ["PAK", "GBR"],
];

function dotTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 32;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(16, 16, 14, 0, Math.PI * 2);
  ctx.fill();
  return new CanvasTexture(canvas);
}

/** The decorative, slowly turning dotted globe in the start page banner. Drag to turn it. */
export default function IntroGlobe() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = ref.current;
    if (!container || !webglAvailable()) return;
    const stage = createStage(container, { fov: 34, zoom: false, continuous: true, maxPixelRatio: 1.75 });
    stage.frame(1.12, [0, 0, 0], [0, 0.3, 4]);
    const globe = new Group();
    globe.rotation.set(0.25, -1.2, 0);
    stage.scene.add(globe);

    // Soft glow and a faint core so the dots read as a sphere.
    globe.add(new Mesh(new SphereGeometry(0.985, 48, 48),
      new MeshBasicMaterial({ color: 0x00497f, transparent: true, opacity: 0.35 })));
    stage.scene.add(new Mesh(new SphereGeometry(1.09, 48, 48), new MeshBasicMaterial({
      color: 0x8fd3f5, transparent: true, opacity: 0.08, side: BackSide, blending: AdditiveBlending,
      depthWrite: false })));

    let cancelled = false;
    void loadWorld().then((world) => {
      if (cancelled) return;
      // Land as dots on a latitude/longitude grid (denser near the equator so spacing stays even).
      const positions: number[] = [];
      for (let lat = -58; lat <= 82; lat += 2.1) {
        const step = 2.1 / Math.max(0.25, Math.cos((lat * Math.PI) / 180));
        for (let lon = -180; lon < 180; lon += step) {
          if (world.isLand(lon, lat)) positions.push(...lonLatToVector3(lon, lat, 1).toArray());
        }
      }
      const dots = new BufferGeometry();
      dots.setAttribute("position", new Float32BufferAttribute(positions, 3));
      globe.add(new Points(dots, new PointsMaterial({ size: 0.022, map: dotTexture(), color: 0xffffff,
        transparent: true, opacity: 0.9, depthWrite: false, alphaTest: 0.2 })));

      // Arcs that draw themselves in and fade, one after another.
      const arcs: { line: Line; length: number; offset: number }[] = [];
      LINKS.forEach(([a, b], i) => {
        const pa = world.anchor(a);
        const pb = world.anchor(b);
        if (!pa || !pb) return;
        const start = lonLatToVector3(pa[0], pa[1], 1.005);
        const end = lonLatToVector3(pb[0], pb[1], 1.005);
        const mid = start.clone().add(end).multiplyScalar(0.5);
        const lift = 1.12 + start.distanceTo(end) * 0.32;
        const curve = new QuadraticBezierCurve3(start, mid.normalize().multiplyScalar(lift), end);
        const points = curve.getPoints(64);
        const geometry = new BufferGeometry().setFromPoints(points);
        const line = new Line(geometry, new LineBasicMaterial({ color: i % 3 === 0 ? 0xffd28a : 0xbfe7fb,
          transparent: true, opacity: 0.85 }));
        geometry.setDrawRange(0, 0);
        globe.add(line);
        arcs.push({ line, length: points.length, offset: i * 0.9 });
      });

      stage.onFrame((seconds) => {
        if (!stage.reducedMotion) globe.rotation.y += 0.0012;
        for (const arc of arcs) {
          // 0 → 1 draws the arc, 1 → 2 holds it while fading, then waits for its next turn
          const t = stage.reducedMotion ? 1.2 : ((seconds * 0.35 + arc.offset) % (LINKS.length * 0.9));
          const grow = Math.min(1, Math.max(0, t));
          arc.line.geometry.setDrawRange(0, Math.floor(grow * arc.length));
          (arc.line.material as LineBasicMaterial).opacity = t < 1 ? 0.9 : Math.max(0, 0.9 - (t - 1) * 0.9);
        }
      });
      stage.invalidate();
    });

    return () => {
      cancelled = true;
      stage.dispose();
    };
  }, []);

  return <div ref={ref} className="intro-globe" aria-hidden="true" title="Drag to turn the globe" />;
}


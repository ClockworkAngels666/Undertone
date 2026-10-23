import { geoEquirectangular, geoPath } from "d3-geo";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AmbientLight,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshStandardMaterial,
  Quaternion,
  Raycaster,
  RingGeometry,
  SphereGeometry,
  SRGBColorSpace,
  Vector2,
  Vector3,
} from "three";
import type { Matrix } from "../api/types";
import { useColorScheme } from "../lib/colors";
import { magnitude, NO_DATA, scaleFor, type Scale } from "./scales";
import { createStage, isSmallScreen, lonLatToVector3, type Stage, vector3ToLonLat, webglAvailable } from "./stage";
import { loadWorld, type World } from "./world";

interface Props {
  matrix: Matrix;
  metric: string;
  metricLabel: string;
  format: (value: number) => string;
  year: number;
  onYearChange: (year: number) => void;
  /** Countries shown in the line chart, with their series colour (drawn as rings on the globe). */
  selected: Record<string, string>;
  onPick: (code: string, year: number) => void;
}

interface Hover {
  code: string;
  x: number;
  y: number;
}

const UP = new Vector3(0, 1, 0);
// Start over the Atlantic, tilted north, so the Americas, Europe and Africa are all in view.
const HOME = lonLatToVector3(-15, 28, 1).toArray() as [number, number, number];
const FIT_RADIUS = 1.28;   // the globe plus the tallest columns

/** Interactive 3D globe: one metric for every country in one year, with columns and a year animation. */
export default function YearGlobe({ matrix, metric, metricLabel, format, year, onYearChange, selected, onPick }: Props) {
  const scheme = useColorScheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const engine = useRef<Engine | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [hover, setHover] = useState<Hover | null>(null);
  const [playing, setPlaying] = useState(false);
  const names = useMemo(() => Object.fromEntries(matrix.countries.map((c) => [c.code, c.name])), [matrix]);
  const yearIndex = matrix.years.indexOf(year);
  // One colour scale for all years, so colours mean the same thing while the years play.
  const scale = useMemo(() => scaleFor(metric, Object.values(matrix.values).flat().filter((v): v is number =>
    v !== null), scheme), [matrix, metric, scheme]);
  const pickRef = useRef<(code: string) => void>(() => {});
  pickRef.current = (code) => onPick(code, year);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    if (!webglAvailable()) {
      setFailed(true);
      return;
    }
    let cancelled = false;
    const stage = createStage(container, { fov: 32, minDistance: 1.7, maxDistance: 7 });
    stage.frame(FIT_RADIUS, [0, 0, 0], HOME);
    void loadWorld().then((world) => {
      if (cancelled) return;
      engine.current = new Engine(stage, world, container, setHover, (code) => pickRef.current(code));
      setReady(true);
    });
    return () => {
      cancelled = true;
      engine.current = null;
      setReady(false);
      stage.dispose();
    };
  }, []);

  useEffect(() => {
    if (!ready || !engine.current) return;
    const values: Record<string, number | null> = {};
    for (const [code, series] of Object.entries(matrix.values)) values[code] = yearIndex >= 0 ? series[yearIndex] : null;
    engine.current.update(values, scale, scheme, selected);
  }, [ready, matrix, yearIndex, scale, scheme, selected]);

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => {
      const i = matrix.years.indexOf(year);
      if (i < 0 || i >= matrix.years.length - 1) setPlaying(false);
      else onYearChange(matrix.years[i + 1]);
    }, 650);
    return () => window.clearInterval(timer);
  }, [playing, year, matrix.years, onYearChange]);

  if (failed) {
    return <p className="empty">This browser cannot show 3D graphics (WebGL is off). The ranking below has the same data.</p>;
  }
  const first = matrix.years[0];
  const last = matrix.years[matrix.years.length - 1];
  const hoverValue = hover && yearIndex >= 0 ? matrix.values[hover.code]?.[yearIndex] ?? null : null;
  const reported = yearIndex >= 0 ? Object.values(matrix.values).filter((s) => s[yearIndex] !== null).length : 0;

  return (
    <div className="globe3d" data-ready={ready ? "true" : "false"}>
      <div className="globe3d-stage" ref={containerRef} role="img"
        aria-label={`3D globe of ${metricLabel} by country in ${year}. Drag sideways to turn, pinch or scroll to zoom, tap or click a country to add it to the chart.`}
        onPointerLeave={(e) => {
          if (e.pointerType === "mouse") setHover(null);
        }} />
      <div className="globe3d-year" aria-live="polite">{year}</div>
      <div className="globe3d-note">{reported} delegations spoke</div>
      {hover && (
        <div className="tooltip globe3d-tip" style={{ left: hover.x, top: hover.y }} data-testid="globe-tip">
          <div className="year">{names[hover.code] ?? hover.code}</div>
          <div>{hoverValue === null ? "No statement this year" : <><strong>{format(hoverValue)}</strong> {metricLabel}</>}</div>
        </div>
      )}
      <div className="globe3d-bar">
        <button type="button" className="btn small primary" aria-pressed={playing} onClick={() => {
          if (!playing && year >= last) onYearChange(first);
          setPlaying(!playing);
        }}>{playing ? "❚❚ Pause" : "▶ Play years"}</button>
        <label className="visually-hidden" htmlFor="globe-year">Year shown on the globe</label>
        <input id="globe-year" type="range" min={first} max={last} step={1} value={year}
          onChange={(e) => {
            setPlaying(false);
            onYearChange(Number(e.target.value));
          }} />
        <button type="button" className="btn small" onClick={() => engine.current?.resetView()}>Reset view</button>
      </div>
      <Legend scale={scale} format={format} label={metricLabel} scheme={scheme} />
    </div>
  );
}

function Legend({ scale, format, label, scheme }: { scale: Scale; format: (v: number) => string; label: string;
  scheme: "light" | "dark" }) {
  const [lo, hi] = scale.domain;
  return (
    <div className="globe3d-legend" aria-hidden="true">
      <span className="small">{label}</span>
      <div className="globe3d-scale">
        <div className="globe3d-ramp" style={{ background: `linear-gradient(90deg, ${scale.stops.join(", ")})` }} />
        <div className="globe3d-ramp-labels small">
          <span>{format(lo)}</span>
          {scale.kind === "diverging" && <span>0</span>}
          <span>{format(hi)}{scale.kind === "sequential" ? "+" : ""}</span>
        </div>
      </div>
      <span className="small"><i className="globe3d-swatch" style={{ background: NO_DATA[scheme] }} /> no statement</span>
    </div>
  );
}

/** Everything three.js: the textured globe, the columns and picking (kept out of React state on purpose). */
class Engine {
  private readonly textureSize: [number, number];
  private readonly texture: CanvasTexture;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly columns: InstancedMesh;
  private readonly codes: string[];
  private readonly heights: Float32Array;
  private readonly targets: Float32Array;
  private readonly globe: Mesh;
  private readonly raycaster = new Raycaster();
  private readonly pointer = new Vector2();
  private rings: Mesh[] = [];
  private down: { x: number; y: number } | null = null;
  private interacted = false;

  constructor(private stage: Stage, private world: World, private container: HTMLElement,
    private onHover: (hover: Hover | null) => void, private onPick: (code: string) => void) {
    const small = isSmallScreen();
    this.textureSize = small ? [1024, 512] : [2048, 1024];
    const canvas = document.createElement("canvas");
    [canvas.width, canvas.height] = this.textureSize;
    this.ctx = canvas.getContext("2d")!;
    this.texture = new CanvasTexture(canvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.texture.anisotropy = 4;

    this.globe = new Mesh(new SphereGeometry(1, small ? 56 : 96, small ? 40 : 72),
      new MeshLambertMaterial({ map: this.texture }));
    stage.scene.add(this.globe, new AmbientLight(0xffffff, 1.7));
    const light = new DirectionalLight(0xffffff, 1.3);       // follows the camera so the front is always lit
    light.position.set(2, 2, 3);
    stage.camera.add(light);
    stage.scene.add(stage.camera);

    this.codes = world.anchorCodes;
    const column = new CylinderGeometry(small ? 0.012 : 0.009, small ? 0.012 : 0.009, 1, small ? 6 : 10);
    column.translate(0, 0.5, 0);                              // grow outwards from the surface
    this.columns = new InstancedMesh(column, new MeshStandardMaterial({ roughness: 0.55, metalness: 0.05 }),
      this.codes.length);
    this.heights = new Float32Array(this.codes.length);
    this.targets = new Float32Array(this.codes.length);
    stage.scene.add(this.columns);
    this.placeColumns();

    const controls = stage.controls!;
    controls.autoRotate = !stage.reducedMotion;
    controls.autoRotateSpeed = 0.45;
    controls.addEventListener("start", () => {
      this.interacted = true;
      controls.autoRotate = false;
    });
    stage.onFrame((_seconds, delta) => {
      let moving = false;
      for (let i = 0; i < this.heights.length; i++) {
        const diff = this.targets[i] - this.heights[i];
        if (Math.abs(diff) > 1e-4) {
          this.heights[i] = stage.reducedMotion ? this.targets[i] : this.heights[i] + diff * Math.min(1, delta * 8);
          moving = true;
        }
      }
      if (moving) this.placeColumns();
      if (moving || controls.autoRotate) stage.invalidate();
    });

    const el = stage.renderer.domElement;
    el.addEventListener("pointermove", (e) => {
      if (e.pointerType !== "mouse" || e.buttons) return;     // hover only for mice; touch uses taps
      this.showTip(e, this.pick(e));
    });
    el.addEventListener("pointerdown", (e) => {
      this.down = { x: e.clientX, y: e.clientY };
    });
    el.addEventListener("pointerup", (e) => {
      if (this.down && Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) < 8) {
        const code = this.pick(e);
        this.showTip(e, code);
        if (code) this.onPick(code);
      }
      this.down = null;
    });
  }

  update(values: Record<string, number | null>, scale: Scale, scheme: "light" | "dark", selected: Record<string, string>) {
    // Countries painted onto the globe (equirectangular texture)
    const [w, h] = this.textureSize;
    const ctx = this.ctx;
    ctx.fillStyle = scheme === "dark" ? "#0d2236" : "#dcecf7";
    ctx.fillRect(0, 0, w, h);
    const path = geoPath(geoEquirectangular().scale(w / (2 * Math.PI)).translate([w / 2, h / 2]), ctx);
    ctx.lineWidth = w / 1700;
    ctx.strokeStyle = scheme === "dark" ? "#0a1622" : "#ffffff";
    for (const country of this.world.countries) {
      ctx.beginPath();
      path(country.feature);
      ctx.fillStyle = scale.color(values[country.code]);
      ctx.fill();
      ctx.stroke();
    }
    this.texture.needsUpdate = true;

    // Columns: height = size of the value, colour = the value
    const color = new Color();
    this.codes.forEach((code, i) => {
      const value = values[code];
      const has = value !== null && value !== undefined;
      this.targets[i] = has ? 0.02 + 0.24 * magnitude(scale, value) : 0;
      this.columns.setColorAt(i, color.set(has ? scale.color(value) : "#000000"));
    });
    if (this.columns.instanceColor) this.columns.instanceColor.needsUpdate = true;

    // Rings around the countries that are in the line chart, in their chart colour
    for (const ring of this.rings) {
      this.stage.scene.remove(ring);
      ring.geometry.dispose();
      (ring.material as MeshBasicMaterial).dispose();
    }
    this.rings = Object.entries(selected).flatMap(([code, ringColor]) => {
      const anchor = this.world.anchor(code);
      if (!anchor) return [];
      const normal = lonLatToVector3(anchor[0], anchor[1], 1);
      const ring = new Mesh(new RingGeometry(0.03, 0.043, 32),
        new MeshBasicMaterial({ color: ringColor, side: DoubleSide }));
      ring.position.copy(normal).multiplyScalar(1.004);
      ring.lookAt(normal.clone().multiplyScalar(2));
      this.stage.scene.add(ring);
      return [ring];
    });
    this.stage.invalidate();
  }

  resetView() {
    this.stage.frame(FIT_RADIUS, [0, 0, 0], HOME);
    this.stage.controls!.autoRotate = !this.stage.reducedMotion && !this.interacted;
  }

  private showTip(e: PointerEvent, code: string | undefined) {
    const rect = this.container.getBoundingClientRect();
    // Keep the tooltip inside the globe's box (phones are narrow)
    const x = Math.min(e.clientX - rect.left + 12, rect.width - 190);
    const y = Math.min(e.clientY - rect.top + 12, rect.height - 70);
    this.onHover(code ? { code, x: Math.max(4, x), y: Math.max(4, y) } : null);
    this.stage.renderer.domElement.style.cursor = code ? "pointer" : "grab";
  }

  private placeColumns() {
    const m = new Matrix4();
    const q = new Quaternion();
    const s = new Vector3();
    this.codes.forEach((code, i) => {
      const [lon, lat] = this.world.anchor(code)!;
      const normal = lonLatToVector3(lon, lat, 1);
      q.setFromUnitVectors(UP, normal);
      s.set(1, Math.max(this.heights[i], 1e-4), 1);
      m.compose(normal.multiplyScalar(0.998), q, s);
      this.columns.setMatrixAt(i, m);
    });
    this.columns.instanceMatrix.needsUpdate = true;
  }

  private pick(e: PointerEvent): string | undefined {
    const rect = this.container.getBoundingClientRect();
    this.pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.stage.camera);
    const hit = this.raycaster.intersectObjects([this.columns, this.globe], false)[0];
    if (!hit) return undefined;
    if (hit.object === this.columns && hit.instanceId !== undefined) return this.codes[hit.instanceId];
    const [lon, lat] = vector3ToLonLat(hit.point);
    return this.world.countryAt(lon, lat);
  }
}

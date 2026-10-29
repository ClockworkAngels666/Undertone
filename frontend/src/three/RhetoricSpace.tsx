import { useEffect, useMemo, useRef } from "react";
import {
  AmbientLight,
  BufferGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Line,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Raycaster,
  SphereGeometry,
  Vector2,
  Vector3,
} from "three";
import { useColorScheme } from "../lib/colors";
import { createFlagPole, flagTexture } from "./flags";
import { textSprite } from "./labels";
import { isSmallScreen } from "./stage";
import { disposeGroup, useStage } from "./useStage";
import { useTip } from "./useTip";

export interface SpaceSeries {
  key: string;
  label: string;
  color: string;
  points: { year: number; hostility: number | null; cooperation: number | null }[];
}

interface Props {
  series: SpaceSeries[];
  /** Called when a point is clicked or tapped (for example to open that speech). */
  onPick?: (key: string, year: number) => void;
}

interface PointMeta {
  key: string;
  label: string;
  year: number;
  hostility: number;
  cooperation: number;
}

// Scene box: x = hostility, y = cooperation, z = time.
const BOX = { x: [-1, 1] as const, y: [0, 1.25] as const, z: [-1.7, 1.7] as const };
const HOME: [number, number, number] = [2.9, 1.9, 3.3];
// Half-width/height of the box as seen from HOME (labels included), and its centre
const FIT: [{ x: number; y: number }, [number, number, number]] = [{ x: 2.1, y: 1.5 }, [0, 0.3, 0]];

/** 3D path of each country's rhetoric: hostility × cooperation × year. */
export default function RhetoricSpace({ series, onPick }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const scheme = useColorScheme();
  const { stage, failed } = useStage(ref, { fov: 38, minDistance: 1.5, maxDistance: 10 });
  const tip = useTip<PointMeta>();
  const pickRef = useRef(onPick);
  pickRef.current = onPick;

  useEffect(() => {
    stage?.frame(FIT[0], FIT[1], HOME);
  }, [stage]);

  const extent = useMemo(() => {
    const pts = series.flatMap((s) => s.points.filter((p) => p.hostility !== null && p.cooperation !== null));
    const years = pts.map((p) => p.year);
    return {
      maxH: niceMax(Math.max(1, ...pts.map((p) => p.hostility!))),
      maxC: niceMax(Math.max(1, ...pts.map((p) => p.cooperation!))),
      first: years.length ? Math.min(...years) : 0,
      last: years.length ? Math.max(...years) : 1,
      count: pts.length,
    };
  }, [series]);

  useEffect(() => {
    if (!stage) return;
    const ink = scheme === "dark" ? { grid: 0x2a2c2f, axis: 0x6b6f75, text: "#c6c9cd", plane: 0x4fb3ea }
      : { grid: 0xdfe6ed, axis: 0x9aa8b6, text: "#3d4c5c", plane: 0x0072bc };
    const small = isSmallScreen();
    const { maxH, maxC, first, last } = extent;
    const span = Math.max(1, last - first);
    const sx = (h: number) => BOX.x[0] + ((BOX.x[1] - BOX.x[0]) * h) / maxH;
    const sy = (c: number) => BOX.y[0] + ((BOX.y[1] - BOX.y[0]) * c) / maxC;
    const sz = (year: number) => BOX.z[0] + ((BOX.z[1] - BOX.z[0]) * (year - first)) / span;

    const group = new Group();
    group.add(new AmbientLight(0xffffff, 1.4));
    const light = new DirectionalLight(0xffffff, 1.2);
    light.position.set(3, 4, 5);
    group.add(light);

    // Floor grid and back walls
    const grid: number[] = [];
    const xTicks = [0, maxH / 2, maxH];
    const yTicks = [0, maxC / 2, maxC];
    const step = span > 40 ? 10 : span > 15 ? 5 : span > 6 ? 2 : 1;
    const zTicks: number[] = [];
    for (let y = Math.ceil(first / step) * step; y <= last; y += step) zTicks.push(y);
    for (const h of xTicks) grid.push(sx(h), 0, BOX.z[0], sx(h), 0, BOX.z[1], sx(h), 0, BOX.z[0], sx(h), BOX.y[1], BOX.z[0]);
    for (const year of zTicks) grid.push(BOX.x[0], 0, sz(year), BOX.x[1], 0, sz(year), BOX.x[0], 0, sz(year), BOX.x[0], BOX.y[1], sz(year));
    for (const c of yTicks) grid.push(BOX.x[0], sy(c), BOX.z[0], BOX.x[1], sy(c), BOX.z[0], BOX.x[0], sy(c), BOX.z[0], BOX.x[0], sy(c), BOX.z[1]);
    const gridGeometry = new BufferGeometry();
    gridGeometry.setAttribute("position", new Float32BufferAttribute(grid, 3));
    group.add(new LineSegments(gridGeometry, new LineBasicMaterial({ color: ink.grid })));

    // Balance plane: where cooperative words = hostile words (tone balance 0). Above it = more conciliatory.
    const hMax = Math.min(maxH, maxC);
    const plane = new BufferGeometry();
    plane.setAttribute("position", new Float32BufferAttribute([
      sx(0), sy(0), BOX.z[0], sx(hMax), sy(hMax), BOX.z[0], sx(hMax), sy(hMax), BOX.z[1],
      sx(0), sy(0), BOX.z[0], sx(hMax), sy(hMax), BOX.z[1], sx(0), sy(0), BOX.z[1],
    ], 3));
    group.add(new Mesh(plane, new MeshBasicMaterial({ color: ink.plane, transparent: true, opacity: 0.08,
      side: DoubleSide, depthWrite: false })));
    const balanceLabel = textSprite("equal hostile & cooperative (tone 0)", { color: ink.text, height: small ? 0.1 : 0.07 });
    balanceLabel.position.set(sx(hMax * 0.62), sy(hMax * 0.62) + 0.08, BOX.z[1] + 0.05);
    group.add(balanceLabel);

    // Axis titles and ticks
    const label = (text: string, position: [number, number, number], height = small ? 0.11 : 0.075) => {
      const sprite = textSprite(text, { color: ink.text, height });
      sprite.position.set(...position);
      group.add(sprite);
    };
    const title = small ? 0.14 : 0.1;
    label("Hostile words / 1,000 →", [0, -0.2, BOX.z[1] + 0.3], title);
    label("Cooperative / 1,000 ↑", [BOX.x[0] - 0.1, BOX.y[1] + 0.16, BOX.z[0]], title);
    label("Year →", [BOX.x[1] + 0.35, -0.14, 0], title);
    for (const h of xTicks) label(fmt(h), [sx(h), -0.11, BOX.z[1] + 0.16]);
    for (const c of yTicks.slice(1)) label(fmt(c), [BOX.x[0] - 0.12, sy(c), BOX.z[0]]);
    for (const year of zTicks) label(String(year), [BOX.x[1] + 0.22, -0.03, sz(year)]);

    // One path per country, with a sphere per year
    const metas: PointMeta[] = [];
    const sphere = new SphereGeometry(small ? 0.034 : 0.026, 12, 10);
    const all = new InstancedMesh(sphere, new MeshStandardMaterial({ roughness: 0.4 }),
      Math.max(1, series.reduce((n, s) => n + s.points.length, 0)));
    const m = new Matrix4();
    const color = new Color();
    let index = 0;
    for (const s of series) {
      const pts = s.points.filter((p) => p.hostility !== null && p.cooperation !== null).sort((a, b) => a.year - b.year);
      if (pts.length > 1) {
        const line = new BufferGeometry().setFromPoints(pts.map((p) => new Vector3(sx(p.hostility!), sy(p.cooperation!), sz(p.year))));
        group.add(new Line(line, new LineBasicMaterial({ color: s.color })));
      }
      for (const p of pts) {
        m.makeTranslation(sx(p.hostility!), sy(p.cooperation!), sz(p.year));
        all.setMatrixAt(index, m);
        all.setColorAt(index, color.set(s.color));
        metas.push({ key: s.key, label: s.label, year: p.year, hostility: p.hostility!, cooperation: p.cooperation! });
        index += 1;
      }
    }
    all.count = index;
    group.add(all);

    // A small waving flag on each country's most recent point, so every path can be recognised at a glance
    let cancelled = false;
    const flags = series.flatMap((s, i) => {
      const last = [...s.points].reverse().find((p) => p.hostility !== null && p.cooperation !== null);
      if (!last) return [];
      const pole = createFlagPole({ width: small ? 0.2 : 0.16, segments: small ? [6, 3] : [10, 5], phase: i * 1.3 });
      pole.setHeight(small ? 0.28 : 0.22);
      pole.group.position.set(sx(last.hostility!), sy(last.cooperation!), sz(last.year));
      group.add(pole.group);
      void flagTexture(s.key, s.color).then((texture) => {
        if (cancelled) texture.dispose();
        else {
          pole.setFlag(texture);
          stage.invalidate();
        }
      });
      return [pole];
    });
    const stopWave = stage.onFrame((seconds) => {
      if (stage.reducedMotion || !flags.length) return;
      for (const flag of flags) flag.wave(seconds, 0.8);
      stage.invalidate();
    });
    stage.scene.add(group);
    stage.invalidate();

    // Picking: hover with a mouse, tap or click to choose
    const raycaster = new Raycaster();
    const pointer = new Vector2();
    const el = stage.renderer.domElement;
    const pick = (e: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(pointer, stage.camera);
      const hit = raycaster.intersectObject(all, false)[0];
      const meta = hit?.instanceId !== undefined ? metas[hit.instanceId] : undefined;
      tip.show(meta ?? null, Math.max(4, Math.min(e.clientX - rect.left + 12, rect.width - 200)),
        Math.max(4, Math.min(e.clientY - rect.top + 12, rect.height - 80)) + 34);
      el.style.cursor = meta ? "pointer" : "grab";
      return meta;
    };
    let down: { x: number; y: number } | null = null;
    const onMove = (e: PointerEvent) => {
      if (e.pointerType === "mouse" && !e.buttons) pick(e);
    };
    const onDown = (e: PointerEvent) => {
      down = { x: e.clientX, y: e.clientY };
    };
    const onUp = (e: PointerEvent) => {
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 8) {
        const meta = pick(e);
        if (meta) pickRef.current?.(meta.key, meta.year);
      }
      down = null;
    };
    const onLeave = tip.hide;
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointerleave", onLeave);
    return () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointerleave", onLeave);
      cancelled = true;
      stopWave();
      disposeGroup(group);
      tip.hide();
    };
  }, [stage, series, extent, scheme]);

  if (failed) return <p className="empty">This browser cannot show 3D graphics (WebGL is off).</p>;
  return (
    <div className="space3d" data-ready={stage ? "true" : "false"}>
      <ul className="chart-legend" aria-label="Legend">
        {series.map((s) => (
          <li key={s.key}><span className="line-key" style={{ borderColor: s.color }} />{s.label}</li>
        ))}
      </ul>
      <div className="space3d-stage" ref={ref} role="img"
        aria-label="3D view of each country's hostile and cooperative words per 1,000 words over the years. Drag sideways to turn, pinch or scroll to zoom." />
      {tip.item && (
        <div className="tooltip space3d-tip" ref={tip.ref}>
          <div className="year">{tip.item.label} · {tip.item.year}</div>
          <div className="row"><strong>{tip.item.hostility.toFixed(1)}</strong><span className="name">hostile / 1,000</span></div>
          <div className="row"><strong>{tip.item.cooperation.toFixed(1)}</strong><span className="name">cooperative / 1,000</span></div>
          {pickRef.current && <div className="small muted">Click to read this speech</div>}
        </div>
      )}
      <div className="row space3d-bar">
        <button type="button" className="btn small" onClick={() => stage?.frame(FIT[0], FIT[1], HOME)}>Reset view</button>
        <span className="small muted">{extent.count} points · drag sideways to turn, pinch or scroll to zoom</span>
      </div>
    </div>
  );
}

function niceMax(value: number) {
  const magnitude = 10 ** Math.floor(Math.log10(value));
  return Math.ceil(value / (magnitude / 2)) * (magnitude / 2);
}

function fmt(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

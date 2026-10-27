import { useEffect, useMemo, useRef, useState } from "react";
import {
  AmbientLight,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Raycaster,
  Sprite,
  Vector2,
} from "three";
import type { Matrix } from "../api/types";
import { useColorScheme } from "../lib/colors";
import { createFlagPole, type FlagPole, flagTexture } from "./flags";
import { textSprite } from "./labels";
import { isSmallScreen } from "./stage";
import { disposeGroup, useStage } from "./useStage";

export type FlagMode = "chosen" | "top" | "bottom";

interface Props {
  matrix: Matrix;
  metricLabel: string;
  format: (value: number) => string;
  year: number;
  onYearChange: (year: number) => void;
  /** The chart's countries, in chart order, with their series colour. */
  chosen: { code: string; color: string }[];
  names: Record<string, string>;
  onPick: (code: string, year: number) => void;
}

interface Slot {
  code: string;
  value: number | null;
}

interface PoleState {
  pole: FlagPole;
  plinth: Mesh;
  name: Sprite;
  value: Sprite | null;
  valueText: string;
  x: number;
  z: number;
  height: number;
  targetX: number;
  targetZ: number;
  targetHeight: number;
}

const MIN_POLE = 0.35;

/** Short label under a pole ("Bosnia and Herzegovina" → "Bosnia and Herz."). */
function shortName(name: string) {
  return name.length > 16 ? `${name.slice(0, 14).trimEnd()}.` : name;
}
const MAX_POLE = 1.9;

/** A row of flagpoles, like the flags in front of UN headquarters: pole height shows the metric in one year. */
export default function FlagLine({ matrix, metricLabel, format, year, onYearChange, chosen, names, onPick }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const scheme = useColorScheme();
  const small = isSmallScreen();
  const { stage, failed } = useStage(ref, { fov: 34, minDistance: 1.2, maxDistance: 14 });
  const [mode, setMode] = useState<FlagMode>(chosen.length ? "chosen" : "top");
  const rankCount = small ? 5 : 10;
  const [playing, setPlaying] = useState(false);
  const [tip, setTip] = useState<{ code: string; x: number; y: number } | null>(null);
  const yearIndex = matrix.years.indexOf(year);
  const pickRef = useRef<(code: string) => void>(() => {});
  pickRef.current = (code) => onPick(code, year);

  // One height scale for all years, so heights stay comparable while the years play.
  const [lo, hi] = useMemo(() => {
    const all = Object.values(matrix.values).flat().filter((v): v is number => v !== null).sort((a, b) => a - b);
    if (!all.length) return [0, 1];
    const q = (p: number) => all[Math.min(all.length - 1, Math.floor(p * all.length))];
    return [Math.min(0, q(0.01)), q(0.99)];
  }, [matrix]);
  const heightOf = (v: number | null) => (v === null ? MIN_POLE * 0.8
    : MIN_POLE + (MAX_POLE - MIN_POLE) * Math.min(1, Math.max(0, (v - lo) / (hi - lo || 1))));

  const slots: Slot[] = useMemo(() => {
    const at = (code: string) => (yearIndex >= 0 ? matrix.values[code]?.[yearIndex] ?? null : null);
    if (mode === "chosen") return chosen.map((c) => ({ code: c.code, value: at(c.code) }));
    const ranked = Object.keys(matrix.values).map((code) => ({ code, value: at(code) }))
      .filter((s): s is { code: string; value: number } => s.value !== null)
      .sort((a, b) => (mode === "top" ? b.value - a.value : a.value - b.value));
    return ranked.slice(0, rankCount);
  }, [mode, chosen, matrix, yearIndex, rankCount]);

  // The tallest pole this view can show in any year: the camera frames that, so it never jumps while playing.
  const frameHeight = useMemo(() => {
    let max = MIN_POLE;
    matrix.years.forEach((_, i) => {
      const values = (mode === "chosen" ? chosen.map((c) => matrix.values[c.code]?.[i] ?? null)
        : Object.values(matrix.values).map((series) => series[i])).filter((v): v is number => v !== null);
      if (!values.length) return;
      values.sort((a, b) => a - b);
      const top = mode === "bottom" ? values[Math.min(values.length - 1, rankCount - 1)] : values[values.length - 1];
      max = Math.max(max, heightOf(top));
    });
    return max;
  }, [mode, chosen, matrix, rankCount, lo, hi]);   // heightOf depends only on lo/hi
  const average = useMemo(() => {
    if (yearIndex < 0) return null;
    const vals = Object.values(matrix.values).map((s) => s[yearIndex]).filter((v): v is number => v !== null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  }, [matrix, yearIndex]);

  // Scene: ground, lights, and the poles (kept by country so they glide when the order changes)
  const scene = useRef<{ group: Group; poles: Map<string, PoleState>; avg: Mesh; avgLabel: Sprite | null } | null>(null);
  useEffect(() => {
    if (!stage) return;
    const group = new Group();
    group.add(new AmbientLight(0xffffff, 1.5));
    const sun = new DirectionalLight(0xffffff, 1.6);
    sun.position.set(2, 4, 3);
    group.add(sun);
    const avg = new Mesh(new PlaneGeometry(1, 0.012), new MeshBasicMaterial({
      color: scheme === "dark" ? 0x8fd3f5 : 0x0072bc, transparent: true, opacity: 0.8, side: DoubleSide }));
    group.add(avg);
    stage.scene.add(group);
    scene.current = { group, poles: new Map(), avg, avgLabel: null };
    const stopWave = stage.onFrame((seconds, delta) => {
      const current = scene.current;
      if (!current) return;
      const k = stage.reducedMotion ? 1 : Math.min(1, delta * 6);
      for (const p of current.poles.values()) {
        p.x += (p.targetX - p.x) * k;
        p.z += (p.targetZ - p.z) * k;
        p.height += (p.targetHeight - p.height) * k;
        p.pole.group.position.set(p.x, 0, p.z);
        p.plinth.position.set(p.x, 0.02, p.z);
        p.pole.setHeight(p.height);
        p.name.position.set(p.x, -0.05, p.z + 0.18);
        p.value?.position.set(p.x, p.height + 0.14, p.z);
        if (!stage.reducedMotion) p.pole.wave(seconds, 1);
      }
      stage.invalidate();
    });
    return () => {
      stopWave();
      disposeGroup(group);
      scene.current = null;
    };
  }, [stage, scheme]);

  // Update poles whenever the countries, year or metric change
  useEffect(() => {
    const current = scene.current;
    if (!stage || !current) return;
    const rows = 1;
    const perRow = slots.length;
    const spacing = small ? 0.54 : 0.68;
    const keep = new Set(slots.map((s) => s.code));
    for (const [code, p] of current.poles) {
      if (keep.has(code)) continue;
      current.group.remove(p.pole.group, p.plinth, p.name);
      if (p.value) current.group.remove(p.value);
      const g = new Group();
      g.add(p.pole.group, p.plinth, p.name, ...(p.value ? [p.value] : []));
      disposeGroup(g);
      current.poles.delete(code);
    }
    const ink = scheme === "dark" ? "#eaf2f8" : "#0f1c2b";
    slots.forEach((slot, i) => {
      const row = Math.floor(i / perRow);
      const col = i % perRow;
      const countInRow = row === rows - 1 ? slots.length - perRow * (rows - 1) : perRow;
      const targetX = (col - (countInRow - 1) / 2) * spacing + (row ? spacing / 2 : 0);   // back row staggered
      const targetZ = -row * 0.9;
      let p = current.poles.get(slot.code);
      if (!p) {
        const pole = createFlagPole({ width: small ? 0.38 : 0.42, segments: small ? [10, 5] : [18, 8], phase: i * 1.7 });
        const plinth = new Mesh(new CylinderGeometry(0.07, 0.09, 0.04, 16),
          new MeshStandardMaterial({ color: scheme === "dark" ? 0x2a3f55 : 0xb8c4d0, roughness: 0.6 }));
        const name = textSprite(shortName(names[slot.code] ?? slot.code), { color: ink, height: small ? 0.13 : 0.11,
          onTop: true });
        p = { pole, plinth, name, value: null, valueText: "", x: targetX, z: targetZ - 0.6, height: 0.05, targetX,
          targetZ, targetHeight: 0.05 };
        current.group.add(pole.group, plinth, name);
        current.poles.set(slot.code, p);
        const fallback = chosen.find((c) => c.code === slot.code)?.color ?? "#5b6b7a";
        void flagTexture(slot.code, fallback).then((texture) => {
          if (current.poles.get(slot.code) === p) p!.pole.setFlag(texture);
          else texture.dispose();
          stage.invalidate();
        });
      }
      p.targetX = targetX;
      p.targetZ = targetZ;
      p.targetHeight = heightOf(slot.value);
      p.pole.setHalfMast(slot.value === null);
      const text = slot.value === null ? "no statement" : format(slot.value);
      if (text !== p.valueText) {
        if (p.value) {
          current.group.remove(p.value);
          const g = new Group();
          g.add(p.value);
          disposeGroup(g);
        }
        p.value = textSprite(text, { color: ink, height: small ? 0.12 : 0.1, weight: 500, onTop: true });
        current.group.add(p.value);
        p.valueText = text;
      }
    });

    // The all-country average as a thin line across the row
    const width = Math.max(1, perRow * spacing + 0.4);
    current.avg.visible = average !== null;
    current.avg.scale.x = width;
    current.avg.position.set(0, heightOf(average), 0.25);
    if (current.avgLabel) {
      const g = new Group();
      current.group.remove(current.avgLabel);
      g.add(current.avgLabel);
      disposeGroup(g);
      current.avgLabel = null;
    }
    if (average !== null) {
      current.avgLabel = textSprite(`all-country average ${format(average)}`, {
        color: scheme === "dark" ? "#8fd3f5" : "#0072bc", height: small ? 0.1 : 0.085, onTop: true });
      current.avgLabel.position.set(width / 2 + 0.05, heightOf(average) + 0.06, 0.25);
      current.group.add(current.avgLabel);
    }
    stage.frame({ x: width / 2 + 0.3, y: (frameHeight + 0.45) / 2 }, [0, frameHeight / 2 + 0.02, 0], [0, 0.22, 1]);
    // (heightOf depends on lo/hi, which change with the metric)
  }, [stage, slots, average, scheme, small, format, names, chosen, lo, hi, frameHeight]);

  // Pointer: hover (mouse) shows the value, a click or tap opens that country's speech
  useEffect(() => {
    if (!stage) return;
    const el = stage.renderer.domElement;
    const raycaster = new Raycaster();
    const pointer = new Vector2();
    const pick = (e: PointerEvent) => {
      const current = scene.current;
      if (!current) return undefined;
      const rect = el.getBoundingClientRect();
      pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(pointer, stage.camera);
      const targets = [...current.poles.entries()].flatMap(([code, p]) => p.pole.meshes.map((m) => ({ code, m })));
      const hit = raycaster.intersectObjects(targets.map((t) => t.m), false)[0];
      const code = hit ? targets.find((t) => t.m === hit.object)?.code : undefined;
      setTip(code ? { code, x: Math.max(4, Math.min(e.clientX - rect.left + 12, rect.width - 200)),
        y: Math.max(4, Math.min(e.clientY - rect.top + 12, rect.height - 70)) } : null);
      el.style.cursor = code ? "pointer" : "grab";
      return code;
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
        const code = pick(e);
        if (code) pickRef.current(code);
      }
      down = null;
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointerup", onUp);
    return () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointerup", onUp);
    };
  }, [stage]);

  // Year animation
  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => {
      const i = matrix.years.indexOf(year);
      if (i < 0 || i >= matrix.years.length - 1) setPlaying(false);
      else onYearChange(matrix.years[i + 1]);
    }, 700);
    return () => window.clearInterval(timer);
  }, [playing, year, matrix.years, onYearChange]);

  if (failed) return <p className="empty">This browser cannot show 3D graphics (WebGL is off).</p>;
  const first = matrix.years[0];
  const last = matrix.years[matrix.years.length - 1];
  const tipSlot = tip && slots.find((s) => s.code === tip.code);

  return (
    <div className="flags3d" data-ready={stage ? "true" : "false"}>
      <div className="row flags3d-controls">
        <div className="field">
          <label htmlFor="flag-mode">Flags</label>
          <select id="flag-mode" value={mode} onChange={(e) => setMode(e.target.value as FlagMode)}>
            <option value="chosen" disabled={!chosen.length}>Countries in the chart</option>
            <option value="top">Highest {rankCount}</option>
            <option value="bottom">Lowest {rankCount}</option>
          </select>
        </div>
        <div className="flags3d-year" aria-live="polite">{year}</div>
      </div>
      <div className="flags3d-view">
        <div className="flags3d-stage" ref={ref} role="img"
          aria-label={`Flags on poles: ${metricLabel} in ${year}, one pole per country. Taller means a higher value.`} />
        {tip && tipSlot && (
          <div className="tooltip flags3d-tip" style={{ left: tip.x, top: tip.y }}>
            <div className="year">{names[tip.code] ?? tip.code} · {year}</div>
            <div>{tipSlot.value === null ? "No statement this year"
              : <><strong>{format(tipSlot.value)}</strong> {metricLabel}</>}</div>
          </div>
        )}
      </div>
      <div className="flags3d-bar">
        <button type="button" className="btn small primary" aria-pressed={playing} onClick={() => {
          if (!playing && year >= last) onYearChange(first);
          setPlaying(!playing);
        }}>{playing ? "❚❚ Pause" : "▶ Play years"}</button>
        <label className="visually-hidden" htmlFor="flag-year">Year shown by the flags</label>
        <input id="flag-year" type="range" min={first} max={last} step={1} value={year} onChange={(e) => {
          setPlaying(false);
          onYearChange(Number(e.target.value));
        }} />
      </div>
      <p className="small muted">Pole height: {metricLabel}. Half-mast: no statement that year. Tap a flag to read the speech.</p>
    </div>
  );
}


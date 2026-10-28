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
import YearPlayer from "../components/YearPlayer";
import { useColorScheme } from "../lib/colors";
import { shortName } from "../lib/format";
import { createFlagPole, type FlagPole, flagTexture } from "./flags";
import { textSprite } from "./labels";
import { isSmallScreen } from "./stage";
import { disposeGroup, useStage } from "./useStage";
import { useTip } from "./useTip";

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
  /** Name labels alternate between two heights so neighbours never overlap. */
  labelY: number;
  x: number;
  z: number;
  height: number;
  targetX: number;
  targetZ: number;
  targetHeight: number;
}

const MIN_POLE = 0.35;

const MAX_POLE = 1.9;

/** A row of flagpoles, like the flags in front of UN headquarters: pole height shows the metric in one year. */
export default function FlagLine({ matrix, metricLabel, format, year, onYearChange, chosen, names, onPick }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const scheme = useColorScheme();
  const small = isSmallScreen();
  const { stage, failed } = useStage(ref, { fov: 34, minDistance: 1.2, maxDistance: 14 });
  const [mode, setMode] = useState<FlagMode>(chosen.length ? "chosen" : "top");
  const rankCount = small ? 5 : 10;
  const tip = useTip<string>();
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

  const average = useMemo(() => {
    if (yearIndex < 0) return null;
    const vals = Object.values(matrix.values).map((s) => s[yearIndex]).filter((v): v is number => v !== null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  }, [matrix, yearIndex]);

  // Scene: ground, lights, and the poles (kept by country so they glide when the order changes)
  const scene = useRef<{ group: Group; poles: Map<string, PoleState>; avg: Mesh } | null>(null);
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
    scene.current = { group, poles: new Map(), avg };
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
        p.name.position.set(p.x, p.labelY, p.z + 0.18);
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
    // Long rows are shown from further away, so their labels are drawn larger to stay readable
    const labelSize = (small ? 0.12 : 0.1) * Math.max(1, Math.sqrt(slots.length / 5));
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
        const name = textSprite(shortName(names[slot.code] ?? slot.code), { color: ink, height: labelSize * 1.05,
          onTop: true });
        p = { pole, plinth, name, value: null, valueText: "", labelY: -0.06, x: targetX, z: targetZ - 0.6,
          height: 0.05, targetX, targetZ, targetHeight: 0.05 };
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
      p.labelY = slots.length > 6 && i % 2 ? -0.06 - labelSize * 1.15 : -0.06;
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
        p.value = textSprite(text, { color: ink, height: labelSize, weight: 500, onTop: true });
        current.group.add(p.value);
        p.valueText = text;
      }
    });

    // The all-country average as a thin line across the row (named in the caption: a label in the scene ends up
    // behind whichever flag reaches that height)
    const width = Math.max(1, perRow * spacing + 0.4);
    current.avg.visible = average !== null;
    current.avg.scale.x = width;
    current.avg.position.set(0, heightOf(average), 0.25);
    // Frame this year's tallest pole (or the average line), gliding smoothly as the years play
    const tallest = Math.max(0.9, ...slots.map((sl) => heightOf(sl.value)), average === null ? 0 : heightOf(average));
    stage.frame({ x: width / 2 + 0.3, y: (tallest + 0.55) / 2 }, [0, tallest / 2 - 0.02, 0], [0, 0.22, 1],
      { smooth: true });
    // (heightOf depends on lo/hi, which change with the metric)
  }, [stage, slots, average, scheme, small, format, names, chosen, lo, hi]);

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
      tip.show(code ?? null, Math.max(4, Math.min(e.clientX - rect.left + 12, rect.width - 200)),
        Math.max(4, Math.min(e.clientY - rect.top + 12, rect.height - 70)));
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
    };
  }, [stage]);

  if (failed) return <p className="empty">This browser cannot show 3D graphics (WebGL is off).</p>;
  const tipCode = tip.item;
  const tipSlot = tipCode !== null ? slots.find((s) => s.code === tipCode) : undefined;

  return (
    <div className="flags3d" data-ready={stage ? "true" : "false"}>
      <div className="row view3d-controls">
        <div className="field">
          <label htmlFor="flag-mode">Flags</label>
          <select id="flag-mode" value={mode} onChange={(e) => setMode(e.target.value as FlagMode)}>
            <option value="chosen" disabled={!chosen.length}>Countries in the chart</option>
            <option value="top">Highest {rankCount}</option>
            <option value="bottom">Lowest {rankCount}</option>
          </select>
        </div>
        <div className="view3d-year" aria-live="polite">{year}</div>
      </div>
      <div className="flags3d-view">
        <div className="flags3d-stage" ref={ref} role="img"
          aria-label={`Flags on poles: ${metricLabel} in ${year}, one pole per country. Taller means a higher value.`} />
        {tipCode !== null && tipSlot && (
          <div className="tooltip view3d-tip" ref={tip.ref}>
            <div className="year">{names[tipCode] ?? tipCode} · {year}</div>
            <div>{tipSlot.value === null ? "No statement this year"
              : <><strong>{format(tipSlot.value)}</strong> {metricLabel}</>}</div>
          </div>
        )}
      </div>
      <YearPlayer years={matrix.years} year={year} onYearChange={onYearChange} label="Year shown by the flags" />
      <p className="small muted">
        Pole height: {metricLabel}.{average !== null && <> Blue line: all-country average, {format(average)}.</>}{" "}
        Half-mast: no statement that year. Tap a flag to read the speech.
      </p>
    </div>
  );
}


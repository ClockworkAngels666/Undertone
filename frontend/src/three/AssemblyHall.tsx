import { useEffect, useMemo, useRef, useState } from "react";
import {
  AmbientLight,
  BoxGeometry,
  CircleGeometry,
  Color,
  DirectionalLight,
  ExtrudeGeometry,
  Group,
  InstancedMesh,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Raycaster,
  Shape,
  Sphere,
  type Sprite,
  Vector2,
  Vector3,
} from "three";
import type { Matrix } from "../api/types";
import YearPlayer from "../components/YearPlayer";
import { useColorScheme } from "../lib/colors";
import { plural, shortName } from "../lib/format";
import { createFlagPole, type FlagPole, flagTexture } from "./flags";
import { speakerFlag, speakerName } from "../lib/history";
import { textSprite } from "./labels";
import { magnitude, scaleFor } from "./scales";
import { isSmallScreen } from "./stage";
import { disposeGroup, useStage } from "./useStage";
import { useTip } from "./useTip";

export type SeatOrder = "value" | "name";

const FRONT = 0.95;                        // radius of the front row
const ROW = 0.17;                          // distance between rows
const STEP = 0.045;                        // each row sits this much higher than the one in front of it
const SPAN = (150 * Math.PI) / 180;        // opening angle of the hemicycle
const DESK = 0.035;                        // desk height
const MIN_COLUMN = 0.02;
const MAX_COLUMN = 0.42;
const HIDDEN = 1e-4;                       // scale of seats nobody sits in

export interface Seat {
  x: number;
  y: number;
  z: number;
  angle: number;
  row: number;
}

export function rowsFor(count: number) {
  return Math.max(2, Math.round(Math.sqrt(count / 3)));
}

/**
 * Seats for `count` delegations in a hemicycle around the rostrum (at the origin, the camera looks from behind it),
 * sorted left to right as the speaker sees them. Rows get seats in proportion to their length.
 */
export function hemicycle(count: number): Seat[] {
  if (count <= 0) return [];
  const rows = rowsFor(count);
  const radii = Array.from({ length: rows }, (_, i) => FRONT + i * ROW);
  const total = radii.reduce((a, b) => a + b, 0);
  const perRow = radii.map((r) => Math.floor((count * r) / total));
  // seats left over from rounding go to the back rows, which are the longest
  let left = count - perRow.reduce((a, b) => a + b, 0);
  for (let i = rows - 1; left > 0; i = (i + rows - 1) % rows, left--) perRow[i]++;
  const seats: Seat[] = [];
  radii.forEach((r, row) => {
    const n = perRow[row];
    for (let k = 0; k < n; k++) {
      const angle = n === 1 ? 0 : -SPAN / 2 + (SPAN * k) / (n - 1);
      seats.push({ x: Math.sin(angle) * r, y: (row + 1) * STEP, z: -Math.cos(angle) * r, angle, row });
    }
  });
  return seats.sort((a, b) => a.angle - b.angle || a.row - b.row);
}

/** One tier of the hall: a ring sector standing on the floor, `height` tall. */
function tier(inner: number, outer: number, height: number, span: number) {
  const shape = new Shape();
  const a0 = Math.PI / 2 - span / 2;
  const a1 = Math.PI / 2 + span / 2;
  shape.absarc(0, 0, outer, a0, a1, false);
  shape.absarc(0, 0, inner, a1, a0, true);
  const geometry = new ExtrudeGeometry(shape, { depth: height, bevelEnabled: false, curveSegments: 40 });
  geometry.rotateX(-Math.PI / 2);         // shape (x, y) → floor (x, −z), extruded upwards
  return geometry;
}

interface SeatState {
  x: number;
  y: number;
  z: number;
  angle: number;
  height: number;
  size: number;
  color: Color;
}

interface Props {
  matrix: Matrix;
  metricLabel: string;
  format: (value: number) => string;
  year: number;
  onYearChange: (year: number) => void;
  /** The chart's countries: they get a flag at their desk. */
  chosen: { code: string; color: string }[];
  names: Record<string, string>;
  onPick: (code: string, year: number) => void;
}

/** The General Assembly hall seen from the rostrum: one desk per delegation that spoke that year. */
export default function AssemblyHall({ matrix, metricLabel, format, year, onYearChange, chosen, names, onPick }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const scheme = useColorScheme();
  const small = isSmallScreen();
  const { stage, failed } = useStage(ref, { fov: 34, minDistance: 1.2, maxDistance: 14 });
  const [order, setOrder] = useState<SeatOrder>("name");
  const tip = useTip<number>();
  const yearIndex = matrix.years.indexOf(year);
  const pickRef = useRef<(code: string) => void>(() => {});
  pickRef.current = (code) => onPick(code, year);

  const scale = useMemo(() => scaleFor(matrix.metric,
    Object.values(matrix.values).flat().filter((v): v is number => v !== null), scheme), [matrix, scheme]);
  // The hall is built for the largest assembly, so it does not change size while the years play
  const maxRows = useMemo(() => {
    let most = 0;
    matrix.years.forEach((_, i) => {
      most = Math.max(most, Object.values(matrix.values).filter((s) => s[i] !== null).length);
    });
    return rowsFor(Math.max(most, 1));
  }, [matrix]);

  // This year's delegations, their seats and ranks
  const present = useMemo(() => {
    const rows = matrix.countries.map((c, index) => ({ index, code: c.code, name: names[c.code] ?? c.name,
      value: yearIndex >= 0 ? matrix.values[c.code]?.[yearIndex] ?? null : null }))
      .filter((r): r is { index: number; code: string; name: string; value: number } => r.value !== null);
    const byValue = [...rows].sort((a, b) => b.value - a.value);
    const rank = new Map(byValue.map((r, i) => [r.index, i + 1]));
    const seated = order === "value" ? byValue.reverse() : rows.sort((a, b) => a.name.localeCompare(b.name));
    return { seated, rank };
  }, [matrix, yearIndex, order, names]);

  const scene = useRef<{
    desks: InstancedMesh;
    columns: InstancedMesh;
    seats: SeatState[];
    targets: SeatState[];
    flags: Map<string, { index: number; pole: FlagPole; label: Sprite }>;
    group: Group;
  } | null>(null);

  // The hall: floor, tiers, rostrum, and an instanced desk and column per country
  useEffect(() => {
    if (!stage) return;
    const dark = scheme === "dark";
    const group = new Group();
    group.add(new AmbientLight(0xffffff, 1.4));
    const sun = new DirectionalLight(0xffffff, 1.7);
    sun.position.set(1.5, 4, 3);
    group.add(sun);

    const outer = FRONT + (maxRows - 1) * ROW;
    const floor = new Mesh(new CircleGeometry(outer + 0.9, 64), new MeshStandardMaterial({
      color: dark ? 0x132536 : 0xdfe7ef, roughness: 0.95 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, -0.001, -0.4);
    group.add(floor);
    const tierMaterials = [0xe9eff5, 0xdbe4ec].map((light, i) => new MeshStandardMaterial({
      color: dark ? [0x1d3246, 0x223a50][i] : light, roughness: 0.9 }));
    for (let row = 0; row < maxRows; row++) {
      const r = FRONT + row * ROW;
      group.add(new Mesh(tier(r - ROW / 2, r + ROW / 2, (row + 1) * STEP, SPAN + 0.14), tierMaterials[row % 2]));
    }
    const wall = new Mesh(tier(outer + ROW / 2 + 0.03, outer + ROW / 2 + 0.07, maxRows * STEP + 0.5, SPAN + 0.3),
      new MeshStandardMaterial({ color: dark ? 0x2a4560 : 0xb7c7d6, roughness: 0.7 }));
    group.add(wall);

    // The speaker's rostrum (green marble, as in the General Assembly) in the foreground
    const dais = new Mesh(new CircleGeometry(0.34, 40), new MeshStandardMaterial({ color: dark ? 0x3a3020 : 0xc9b48a,
      roughness: 0.6 }));
    dais.rotation.x = -Math.PI / 2;
    dais.position.set(0, 0.002, 0.16);
    const lectern = new Mesh(new BoxGeometry(0.3, 0.17, 0.16), new MeshStandardMaterial({ color: 0x2e5940,
      roughness: 0.3, metalness: 0.1 }));
    lectern.position.set(0, 0.085, 0.16);
    group.add(dais, lectern);

    const count = matrix.countries.length;
    const deskGeometry = new BoxGeometry(0.115, DESK, 0.07);
    deskGeometry.translate(0, DESK / 2, 0);
    const desks = new InstancedMesh(deskGeometry, new MeshStandardMaterial({ color: dark ? 0x8a7350 : 0xb59a6a,
      roughness: 0.55 }), count);
    const columnGeometry = new BoxGeometry(0.05, 1, 0.05);
    columnGeometry.translate(0, 0.5, 0);
    const columns = new InstancedMesh(columnGeometry, new MeshStandardMaterial({ color: 0xffffff, roughness: 0.45 }),
      count);
    // Seats move, so both use one fixed sphere around the whole hall for picking and culling
    const bounds = new Sphere(new Vector3(0, 0.3, -outer / 2), outer + 0.6);
    desks.boundingSphere = bounds;
    columns.boundingSphere = bounds.clone();
    const seats: SeatState[] = matrix.countries.map(() => ({ x: 0, y: 0, z: -FRONT, angle: 0, height: MIN_COLUMN,
      size: HIDDEN, color: new Color(scale.color(null)) }));
    const targets: SeatState[] = seats.map((s) => ({ ...s, color: s.color.clone() }));
    const dummy = new Object3D();
    dummy.position.set(0, 0, -FRONT);
    dummy.scale.setScalar(HIDDEN);
    dummy.updateMatrix();
    seats.forEach((s, i) => {
      desks.setMatrixAt(i, dummy.matrix);
      columns.setMatrixAt(i, dummy.matrix);
      columns.setColorAt(i, s.color);
    });
    group.add(desks, columns);
    stage.scene.add(group);
    scene.current = { desks, columns, seats, targets, flags: new Map(), group };

    const stop = stage.onFrame((seconds, delta) => {
      const current = scene.current;
      if (!current) return;
      const k = stage.reducedMotion ? 1 : Math.min(1, delta * 5);
      let moving = false;
      current.seats.forEach((s, i) => {
        const t = current.targets[i];
        const change = Math.abs(t.x - s.x) + Math.abs(t.z - s.z) + Math.abs(t.height - s.height)
          + Math.abs(t.size - s.size) + Math.abs(t.color.r - s.color.r) + Math.abs(t.color.g - s.color.g)
          + Math.abs(t.color.b - s.color.b);
        if (change < 1e-4) return;
        moving = true;
        s.x += (t.x - s.x) * k;
        s.y += (t.y - s.y) * k;
        s.z += (t.z - s.z) * k;
        s.angle += (t.angle - s.angle) * k;
        s.height += (t.height - s.height) * k;
        s.size += (t.size - s.size) * k;
        if (change < 1e-3) s.color.copy(t.color);
        else s.color.lerp(t.color, k);
        dummy.position.set(s.x, s.y, s.z);
        dummy.rotation.set(0, -s.angle, 0);
        dummy.scale.setScalar(s.size);
        dummy.updateMatrix();
        current.desks.setMatrixAt(i, dummy.matrix);
        dummy.position.y = s.y + DESK * s.size;
        dummy.scale.set(s.size, Math.max(HIDDEN, s.height * s.size), s.size);
        dummy.updateMatrix();
        current.columns.setMatrixAt(i, dummy.matrix);
        current.columns.setColorAt(i, s.color);
      });
      if (moving) {
        current.desks.instanceMatrix.needsUpdate = true;
        current.columns.instanceMatrix.needsUpdate = true;
        if (current.columns.instanceColor) current.columns.instanceColor.needsUpdate = true;
      }
      // Flags of the chart's countries stand at their desks, above the column
      for (const f of current.flags.values()) {
        const s = current.seats[f.index];
        const side = 0.045 * s.size;
        f.pole.group.position.set(s.x + Math.cos(s.angle) * side, s.y + DESK, s.z + Math.sin(s.angle) * side);
        f.pole.group.visible = s.size > 0.05;
        f.pole.setHeight(s.height + 0.2);
        f.label.visible = f.pole.group.visible;
        f.label.position.set(s.x, s.y + DESK + s.height + (small ? 0.36 : 0.3), s.z);
        if (!stage.reducedMotion) f.pole.wave(seconds, 0.8);
      }
      if (moving || current.flags.size) stage.invalidate();
    });

    return () => {
      stop();
      disposeGroup(group);
      scene.current = null;
    };
  }, [stage, scheme, matrix, maxRows, scale, small]);

  // From behind the rostrum, looking out over the hall (set again only if the hall's size changes)
  useEffect(() => {
    if (!stage) return;
    const outer = FRONT + (maxRows - 1) * ROW;
    stage.frame({ x: outer * Math.sin(SPAN / 2) + 0.2, y: (outer + 0.6) * 0.34 + 0.2 }, [0, 0.16, -outer / 2 + 0.05],
      [0, 0.95, 1]);
    const controls = stage.controls!;
    controls.minPolarAngle = 0.3;          // from above the hall down to eye level, never under the floor
    controls.maxPolarAngle = 1.4;
    controls.minAzimuthAngle = -1.3;
    controls.maxAzimuthAngle = 1.3;
  }, [stage, maxRows]);

  // Seat this year's delegations
  useEffect(() => {
    const current = scene.current;
    if (!stage || !current) return;
    const seats = hemicycle(present.seated.length);
    const seated = new Set<number>();
    present.seated.forEach((row, i) => {
      const seat = seats[i];
      const t = current.targets[row.index];
      const s = current.seats[row.index];
      if (s.size < 0.05) {                 // a delegation arriving takes its seat directly, without flying across
        Object.assign(s, { x: seat.x, y: seat.y, z: seat.z, angle: seat.angle });
      }
      Object.assign(t, { x: seat.x, y: seat.y, z: seat.z, angle: seat.angle, size: 1,
        height: MIN_COLUMN + magnitude(scale, row.value) * (MAX_COLUMN - MIN_COLUMN) });
      t.color.set(scale.color(row.value));
      seated.add(row.index);
    });
    current.targets.forEach((t, i) => {
      if (!seated.has(i)) t.size = HIDDEN;
    });
    stage.invalidate();
  }, [stage, present, scale]);

  // Flags at the desks of the chart's countries, redrawn when a delegation changes (the Soviet Union becomes Russia)
  const identities = useMemo(() => chosen.map((c) => speakerFlag(c.code, year)).join(","), [chosen, year]);
  useEffect(() => {
    const current = scene.current;
    if (!stage || !current) return;
    const ink = scheme === "dark" ? "#f1f2f3" : "#0f1c2b";
    const indexOf = new Map(matrix.countries.map((c, i) => [c.code, i]));
    const created: string[] = [];
    for (const { code, color } of chosen) {
      const index = indexOf.get(code);
      if (index === undefined) continue;
      const pole = createFlagPole({ width: small ? 0.24 : 0.17, segments: [8, 4], phase: index });
      const label = textSprite(shortName(speakerName(code, year, names[code] ?? code)), {
        color: ink, height: small ? 0.15 : 0.08, weight: 500,
        onTop: true });
      current.group.add(pole.group, label);
      current.flags.set(code, { index, pole, label });
      created.push(code);
      void flagTexture(speakerFlag(code, year), color).then((texture) => {
        if (current.flags.get(code)?.pole === pole) pole.setFlag(texture);
        else texture.dispose();
        stage.invalidate();
      });
    }
    stage.invalidate();
    return () => {
      for (const code of created) {
        const f = current.flags.get(code);
        if (!f) continue;
        const g = new Group();
        g.add(f.pole.group, f.label);
        disposeGroup(g);
        current.flags.delete(code);
      }
    };
  }, [stage, chosen, names, matrix, scheme, small, identities]);

  // Pointer: hover (mouse) shows the delegation, a click or tap opens its speech
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
      const flagMeshes = [...current.flags.values()].flatMap((f) => f.pole.meshes.map((m) => ({ m, index: f.index })));
      const hit = raycaster.intersectObjects([current.columns, current.desks, ...flagMeshes.map((f) => f.m)], false)
        .find((h) => h.instanceId === undefined || current.seats[h.instanceId].size > 0.5);
      const index = hit ? hit.instanceId ?? flagMeshes.find((f) => f.m === hit.object)?.index : undefined;
      tip.show(index ?? null, Math.max(4, Math.min(e.clientX - rect.left + 12, rect.width - 210)),
        Math.max(4, Math.min(e.clientY - rect.top + 12, rect.height - 80)));
      el.style.cursor = index !== undefined ? "pointer" : "grab";
      return index;
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
        const index = pick(e);
        if (index !== undefined) pickRef.current(matrix.countries[index].code);
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
  }, [stage, matrix]);

  if (failed) return <p className="empty">This browser cannot show 3D graphics (WebGL is off).</p>;
  const tipCountry = tip.item !== null ? matrix.countries[tip.item] : undefined;
  const tipValue = tipCountry && yearIndex >= 0 ? matrix.values[tipCountry.code]?.[yearIndex] ?? null : null;
  const [lo, hi] = scale.domain;

  return (
    <div className="hall3d" data-ready={stage ? "true" : "false"}>
      <div className="row view3d-controls">
        <div className="field">
          <label htmlFor="hall-order">Seats</label>
          <select id="hall-order" value={order} onChange={(e) => setOrder(e.target.value as SeatOrder)}>
            <option value="value">Lowest to highest</option>
            <option value="name">Alphabetical</option>
          </select>
        </div>
        <div className="view3d-year" aria-hidden="true">{year}</div>
      </div>
      <div className="flags3d-view">
        <div className="hall3d-stage" ref={ref} role="img" aria-label={`The General Assembly hall in ${year}: `
          + `${plural(present.seated.length, "delegation")}, each desk's column showing ${metricLabel}.`} />
        {tip.item !== null && tipCountry && (
          <div className="tooltip view3d-tip" ref={tip.ref}>
            <div className="year">{speakerName(tipCountry.code, year, names[tipCountry.code] ?? tipCountry.name)} · {year}</div>
            {tipValue === null ? <div>No statement this year</div> : (
              <>
                <div><strong>{format(tipValue)}</strong> {metricLabel}</div>
                <div className="muted">Rank {present.rank.get(tip.item)} of {present.seated.length}</div>
              </>
            )}
          </div>
        )}
      </div>
      <YearPlayer years={matrix.years} year={year} onYearChange={onYearChange} label="Year shown in the hall" />
      <div className="scale-legend">
        <span className="num">{format(lo)}</span>
        <span className="scale-legend-bar" aria-hidden="true"
          style={{ background: `linear-gradient(90deg, ${scale.stops.join(", ")})` }} />
        <span className="num">{format(hi)}</span>
      </div>
      <p className="small muted">
        {plural(present.seated.length, "delegation")} spoke in {year}.{" "}
        {scale.kind === "diverging" ? `Colour: ${metricLabel}; column height: distance from 0.`
          : `Colour and column height: ${metricLabel}.`}{" "}
        {order === "value" ? "Seats run from the lowest value on the left to the highest on the right. " : ""}
        Flags mark the chart&apos;s countries. Tap a desk to read the speech.
      </p>
    </div>
  );
}

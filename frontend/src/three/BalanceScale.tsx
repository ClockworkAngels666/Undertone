import { useEffect, useRef, useState } from "react";
import {
  AmbientLight,
  BoxGeometry,
  CylinderGeometry,
  DirectionalLight,
  Group,
  Mesh,
  MeshStandardMaterial,
  Raycaster,
  RingGeometry,
  SphereGeometry,
  Vector2,
} from "three";
import { useColorScheme } from "../lib/colors";
import { textSprite } from "./labels";
import { isSmallScreen } from "./stage";
import { disposeGroup, useStage } from "./useStage";
import { useTip } from "./useTip";

const MAX_TILT = 0.38;          // beam angle (radians) when one pan holds every word
const ARM = 0.95;               // pivot to pan hook
const HANG = 0.62;              // pan hook to pan
const PIVOT_Y = 1.42;
const BLOCK = 0.075;
const GAP = BLOCK + 0.008;
const DROP_HEIGHT = 1.0;
const GRAVITY = 9;

/** Words per block, so that neither pan holds more than `max` blocks (both pans use the same unit). */
export function blockUnit(hostile: number, cooperative: number, max: number) {
  return Math.max(1, Math.ceil(Math.max(hostile, cooperative) / max));
}

/** The words each block stands for: the most frequent words first, then "other dictionary words". */
export function blockLabels(hits: number, terms: [string, number][], unit: number): string[] {
  const words: string[] = [];
  for (const [term, count] of terms) for (let i = 0; i < count && words.length < hits; i++) words.push(term);
  while (words.length < hits) words.push("other dictionary words");
  const labels: string[] = [];
  for (let i = 0; i < words.length; i += unit) labels.push([...new Set(words.slice(i, i + unit))].join(", "));
  return labels;
}

/** The heavier pan goes down: the beam turns by the tone balance, (cooperative − hostile) / (cooperative + hostile). */
export function beamAngle(hostile: number, cooperative: number) {
  const total = hostile + cooperative;
  return total ? -((cooperative - hostile) / total) * MAX_TILT : 0;
}

/** Resting places for `n` blocks on a pan: a low pile, filled from the middle outwards, layer by layer. */
export function pile(n: number): [number, number, number][] {
  const spots: [number, number, number][] = [];
  for (let layer = 0; spots.length < n; layer++) {
    const radius = Math.max(0.1, 0.17 - layer * 0.035);
    const offset = (layer % 2) * (GAP / 2);
    const k = Math.ceil(radius / GAP) + 1;
    const layerSpots: [number, number, number][] = [];
    for (let i = -k; i <= k; i++) {
      for (let j = -k; j <= k; j++) {
        const x = i * GAP + offset;
        const z = j * GAP + offset;
        if (Math.hypot(x, z) <= radius) layerSpots.push([x, layer * (BLOCK + 0.003), z]);
      }
    }
    layerSpots.sort((a, b) => Math.hypot(a[0], a[2]) - Math.hypot(b[0], b[2]));
    spots.push(...layerSpots.slice(0, n - spots.length));
  }
  return spots;
}

interface Props {
  hostile: number;
  cooperative: number;
  hostileTerms: [string, number][];
  coopTerms: [string, number][];
  /** Average tone balance of the UN speeches, marked on the dial. */
  unAverage: number | null;
}

interface Block {
  mesh: Mesh;
  side: "hostile" | "cooperative";
  label: string;
  rest: [number, number, number];
  dropAt: number;
}

/** A balance scale: one block per hostile or cooperative word, and the beam tips towards the heavier pan. */
export default function BalanceScale({ hostile, cooperative, hostileTerms, coopTerms, unAverage }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const scheme = useColorScheme();
  const { stage, failed } = useStage(ref, { fov: 32, zoom: false, minDistance: 1, maxDistance: 20 });
  const [run, setRun] = useState(0);
  const tip = useTip<string>();
  const small = isSmallScreen();
  const unit = blockUnit(hostile, cooperative, small ? 24 : 36);
  const blocks = useRef<Block[]>([]);

  useEffect(() => {
    if (!stage) return;
    const dark = scheme === "dark";
    const ink = dark ? "#f1f2f3" : "#0f1c2b";
    const group = new Group();
    group.add(new AmbientLight(0xffffff, 1.3));
    const key = new DirectionalLight(0xfff4e0, 2.0);
    key.position.set(1.5, 3, 2.5);
    group.add(key);

    const brass = new MeshStandardMaterial({ color: 0xc9a54a, metalness: 0.6, roughness: 0.35 });
    const marble = new MeshStandardMaterial({ color: 0x2e5940, roughness: 0.3, metalness: 0.1 });
    const foot = new Mesh(new CylinderGeometry(0.34, 0.42, 0.1, 40), marble);
    foot.position.y = 0.05;
    const pillar = new Mesh(new CylinderGeometry(0.03, 0.045, PIVOT_Y - 0.1, 20), brass);
    pillar.position.y = 0.1 + (PIVOT_Y - 0.1) / 2;
    const knob = new Mesh(new SphereGeometry(0.05, 20, 14), brass);
    knob.position.y = PIVOT_Y;
    group.add(foot, pillar, knob);

    // The dial behind the needle: −1 (only hostile words) to +1 (only cooperative), and the UN average in gold
    const dial = new Group();
    dial.position.set(0, PIVOT_Y, -0.06);
    const arc = new Mesh(new RingGeometry(0.5, 0.52, 40, 1, Math.PI / 2 - MAX_TILT - 0.03, 2 * MAX_TILT + 0.06), brass);
    dial.add(arc);
    const ticks: [number, string, number][] = [[-1, "−1", 0x8a6d33], [0, "", 0x8a6d33], [1, "+1", 0x8a6d33]];
    if (unAverage !== null) ticks.push([unAverage, "UN avg", 0xd4af37]);
    for (const [value, text, color] of ticks) {
      const phi = Math.PI / 2 - value * MAX_TILT;
      const gold = text === "UN avg";
      const tick = new Mesh(new BoxGeometry(gold ? 0.016 : 0.01, gold ? 0.11 : 0.07, 0.01),
        new MeshStandardMaterial({ color, metalness: 0.5, roughness: 0.3 }));
      tick.position.set(Math.cos(phi) * 0.51, Math.sin(phi) * 0.51, 0.01);
      tick.rotation.z = phi - Math.PI / 2;
      dial.add(tick);
      if (!text) continue;
      const label = textSprite(text, { color: gold ? (dark ? "#f0d77a" : "#8a6d33") : ink, height: small ? 0.12 : 0.11,
        weight: gold ? 600 : 500 });
      label.position.set(Math.cos(phi) * (gold ? 0.7 : 0.6), Math.sin(phi) * (gold ? 0.7 : 0.6), 0.01);
      dial.add(label);
    }
    group.add(dial);

    // The beam with its needle, and a pan hanging from each end
    const beam = new Group();
    beam.position.y = PIVOT_Y;
    const bar = new Mesh(new BoxGeometry(2 * ARM + 0.08, 0.045, 0.06), brass);
    const needle = new Mesh(new BoxGeometry(0.014, 0.46, 0.014), brass);
    needle.position.y = 0.23;
    beam.add(bar, needle);
    for (const x of [-ARM, ARM]) {
      const end = new Mesh(new SphereGeometry(0.035, 16, 12), brass);
      end.position.x = x;
      beam.add(end);
    }
    group.add(beam);

    const pans = (["hostile", "cooperative"] as const).map((side) => {
      const pan = new Group();
      const dish = new Mesh(new CylinderGeometry(0.34, 0.29, 0.04, 40), brass);
      dish.position.y = -HANG;
      pan.add(dish);
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 + Math.PI / 6;
        const [rx, rz] = [Math.cos(a) * 0.3, Math.sin(a) * 0.3];
        const length = Math.hypot(rx, HANG, rz);
        const chain = new Mesh(new CylinderGeometry(0.004, 0.004, length, 6), brass);
        chain.position.set(rx / 2, -HANG / 2, rz / 2);
        chain.lookAt(rx, -HANG, rz);          // then turn the cylinder (along y) to lie along the line
        chain.rotateX(Math.PI / 2);
        pan.add(chain);
      }
      const count = side === "hostile" ? hostile : cooperative;
      const label = textSprite(`${side === "hostile" ? "Hostile" : "Cooperative"} · ${count} word${count === 1 ? "" : "s"}`,
        { color: ink, height: small ? 0.12 : 0.11, weight: 500, onTop: true });
      label.position.set(0, -HANG - 0.17, 0.2);
      pan.add(label);
      group.add(pan);
      return pan;
    });

    // One block per word (or per `unit` words for long texts)
    const sides = [
      { side: "hostile" as const, labels: blockLabels(hostile, hostileTerms, unit), pan: pans[0],
        color: dark ? 0xe66767 : 0xe34948 },
      { side: "cooperative" as const, labels: blockLabels(cooperative, coopTerms, unit), pan: pans[1],
        color: dark ? 0x3cc293 : 0x1baf7a },
    ];
    const most = Math.max(1, ...sides.map((s) => s.labels.length));
    const interval = Math.min(0.12, 2.4 / most);
    const geometry = new BoxGeometry(BLOCK, BLOCK, BLOCK);
    blocks.current = sides.flatMap(({ side, labels, pan, color }) => {
      const material = new MeshStandardMaterial({ color, roughness: 0.5 });
      return pile(labels.length).map((rest, i) => {
        const mesh = new Mesh(geometry, material);
        mesh.visible = false;
        pan.add(mesh);
        return { mesh, side, label: labels[i], rest, dropAt: 0.3 + i * interval };
      });
    });

    stage.scene.add(group);
    stage.frame({ x: 1.42, y: 1.16 }, [0, 1.08, 0], [0, 0.12, 1]);
    const controls = stage.controls!;
    controls.minAzimuthAngle = -0.9;
    controls.maxAzimuthAngle = 0.9;
    controls.minPolarAngle = 0.95;
    controls.maxPolarAngle = 1.75;

    // Blocks fall into the pans; the beam follows the weight that has landed, on a slightly springy pivot
    const final = beamAngle(hostile, cooperative);
    const fall = Math.sqrt((2 * DROP_HEIGHT) / GRAVITY);
    const panTop = -HANG + 0.02 + BLOCK / 2;
    let angle = 0;
    let speed = 0;
    let started: number | null = null;
    const stop = stage.onFrame((seconds, delta) => {
      if (started === null) started = seconds;
      const elapsed = stage.reducedMotion ? 1e9 : seconds - started;
      const landed = { hostile: 0, cooperative: 0 };
      let falling = false;
      for (const b of blocks.current) {
        const t = elapsed - b.dropAt;
        b.mesh.visible = t >= 0;
        const height = t < fall ? DROP_HEIGHT - 0.5 * GRAVITY * t * t : 0;
        if (t >= 0 && t < fall) falling = true;
        else if (t >= fall) landed[b.side]++;
        b.mesh.position.set(b.rest[0], panTop + b.rest[1] + Math.max(0, height), b.rest[2]);
      }
      const all = landed.hostile + landed.cooperative === blocks.current.length;
      const target = all ? final : beamAngle(landed.hostile, landed.cooperative);
      if (stage.reducedMotion) {
        angle = target;
        speed = 0;
      } else {
        speed += ((target - angle) * 40 - speed * 5) * delta;
        angle += speed * delta;
      }
      beam.rotation.z = angle;
      pans.forEach((pan, i) => {
        const x = (i ? ARM : -ARM);
        pan.position.set(x * Math.cos(angle), PIVOT_Y + x * Math.sin(angle), 0);
      });
      if (falling || !all || Math.abs(target - angle) > 1e-4 || Math.abs(speed) > 1e-4) stage.invalidate();
    });
    return () => {
      stop();
      blocks.current = [];
      disposeGroup(group);
    };
  }, [stage, scheme, hostile, cooperative, hostileTerms, coopTerms, unAverage, unit, small, run]);

  // Pointer: hovering (or tapping) a block names its word
  useEffect(() => {
    if (!stage) return;
    const el = stage.renderer.domElement;
    const raycaster = new Raycaster();
    const pointer = new Vector2();
    const pick = (e: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(pointer, stage.camera);
      const visible = blocks.current.filter((b) => b.mesh.visible);
      const hit = raycaster.intersectObjects(visible.map((b) => b.mesh), false)[0];
      const block = hit && visible.find((b) => b.mesh === hit.object);
      tip.show(block ? `${block.side === "hostile" ? "Hostile" : "Cooperative"}: ${block.label}` : null,
        Math.max(4, Math.min(e.clientX - rect.left + 12, rect.width - 200)),
        Math.max(4, Math.min(e.clientY - rect.top + 12, rect.height - 50)));
      el.style.cursor = block ? "help" : "grab";
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType === "mouse" && !e.buttons) pick(e);
    };
    const onUp = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") pick(e);
    };
    const onLeave = tip.hide;
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointerleave", onLeave);
    return () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointerleave", onLeave);
    };
  }, [stage]);

  if (failed) return null;
  return (
    <div className="balance3d" data-ready={stage ? "true" : "false"}>
      <div className="balance3d-stage" ref={ref} role="img" aria-label={`A balance scale with ${hostile} hostile `
        + `and ${cooperative} cooperative words; ${hostile > cooperative ? "it tips towards the hostile side"
          : cooperative > hostile ? "it tips towards the cooperative side" : "it settles level"}.`} />
      {tip.item !== null && <div className="tooltip view3d-tip" ref={tip.ref}>{tip.item}</div>}
      <div className="row balance3d-bar">
        <button type="button" className="btn small" onClick={() => setRun(run + 1)}>Weigh again</button>
        <span className="small muted">
          {hostile + cooperative === 0 ? "No dictionary words found."
            : `Each block is ${unit === 1 ? "one word" : `${unit} words`}.`} The needle shows the tone balance
          {unAverage !== null ? "; gold marks the UN average" : ""}.
        </span>
      </div>
    </div>
  );
}

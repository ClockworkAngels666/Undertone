import { useEffect, useMemo, useRef } from "react";
import {
  AmbientLight,
  BoxGeometry,
  Color,
  DirectionalLight,
  Group,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Raycaster,
  Vector2,
} from "three";
import type { SentenceScore } from "../api/types";
import { useColorScheme } from "../lib/colors";
import { textSprite } from "./labels";
import { scaleFor } from "./scales";
import { isSmallScreen } from "./stage";
import { disposeGroup, useStage } from "./useStage";
import { useTip } from "./useTip";

interface Props {
  sentences: SentenceScore[];
  onPick?: (index: number) => void;
}

const HOSTILE = "#e34948";
const COOPERATIVE = "#1baf7a";
const STEP = 0.12;

/** Every sentence as a tile (colour = VADER) with columns for its hostile (red) and cooperative (green) words. */
export default function SentenceLandscape({ sentences, onPick }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const scheme = useColorScheme();
  const { stage, failed } = useStage(ref, { fov: 36, minDistance: 0.5, maxDistance: 14 });
  const tip = useTip<SentenceScore>();
  const pickRef = useRef(onPick);
  pickRef.current = onPick;
  const layout = useMemo(() => {
    const n = sentences.length;
    const cols = Math.min(30, Math.max(6, Math.ceil(Math.sqrt(n * 2.2))));
    const rows = Math.ceil(n / cols);
    return { cols, rows, width: cols * STEP, depth: rows * STEP };
  }, [sentences.length]);

  useEffect(() => {
    if (!stage) return;
    const small = isSmallScreen();
    const vader = scaleFor("vader_mean", [-1, 1], scheme);
    const { cols, width, depth } = layout;
    // Sentences run left → right, then the next row (like reading), centred on the origin
    const pos = (i: number): [number, number] => {
      const row = Math.floor(i / cols);
      const col = row % 2 === 0 ? i % cols : cols - 1 - (i % cols);     // snake so neighbours stay adjacent
      return [col * STEP - width / 2 + STEP / 2, row * STEP - depth / 2 + STEP / 2];
    };
    const group = new Group();
    group.add(new AmbientLight(0xffffff, 1.3));
    const light = new DirectionalLight(0xffffff, 1.6);
    light.position.set(2, 4, 3);
    group.add(light);

    const tiles = new InstancedMesh(new BoxGeometry(STEP * 0.9, 0.02, STEP * 0.9),
      new MeshStandardMaterial({ roughness: 0.7 }), sentences.length);
    const bar = new BoxGeometry(STEP * 0.3, 1, STEP * 0.3);
    bar.translate(0, 0.5, 0);
    const hostile = new InstancedMesh(bar, new MeshStandardMaterial({ color: HOSTILE, roughness: 0.5 }), sentences.length);
    const coop = new InstancedMesh(bar.clone(), new MeshStandardMaterial({ color: COOPERATIVE, roughness: 0.5 }),
      sentences.length);
    const m = new Matrix4();
    const color = new Color();
    // The tallest column is about half as high as the landscape is wide; empty counts get no column at all.
    const maxHits = Math.max(1, ...sentences.map((s) => Math.max(s.hostile_hits, s.coop_hits)));
    const maxBar = Math.max(0.24, Math.min(width, Math.max(depth, width * 0.5)) * 0.55);
    const unit = maxBar / maxHits;
    const bar3 = (hits: number, x: number, z: number) =>
      hits > 0 ? m.makeScale(1, hits * unit, 1).setPosition(x, 0.01, z) : m.makeScale(0, 0, 0);
    sentences.forEach((s, i) => {
      const [x, z] = pos(i);
      m.makeTranslation(x, 0, z);
      tiles.setMatrixAt(i, m);
      tiles.setColorAt(i, color.set(vader.color(s.vader)));
      hostile.setMatrixAt(i, bar3(s.hostile_hits, x - STEP * 0.2, z));
      coop.setMatrixAt(i, bar3(s.coop_hits, x + STEP * 0.2, z));
    });
    group.add(tiles, hostile, coop);

    const ink = scheme === "dark" ? "#b9cad8" : "#3d4c5c";
    const start = textSprite("start", { color: ink, height: small ? 0.075 : 0.06, onTop: true });
    const [sx, sz] = pos(0);
    start.position.set(sx, 0.05, sz - STEP * 1.2);
    const end = textSprite("end", { color: ink, height: small ? 0.075 : 0.06, onTop: true });
    const [ex, ez] = pos(sentences.length - 1);
    end.position.set(ex, 0.03, ez + STEP * 1.5);
    group.add(start, end);
    stage.scene.add(group);

    // Frame the whole landscape, columns included, from above and in front (fits wide and narrow screens)
    stage.frame({ x: width / 2 + STEP, y: (depth * 0.7 + maxBar * 0.75) / 2 + STEP / 2 }, [0, maxBar * 0.3, 0],
      [0, 0.95, 1]);

    const raycaster = new Raycaster();
    const pointer = new Vector2();
    const el = stage.renderer.domElement;
    const pick = (e: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(pointer, stage.camera);
      const hit = raycaster.intersectObjects([hostile, coop, tiles], false)[0];
      const s = hit?.instanceId !== undefined ? sentences[hit.instanceId] : undefined;
      tip.show(s ?? null, Math.max(4, Math.min(e.clientX - rect.left + 12, rect.width - 260)),
        Math.max(4, Math.min(e.clientY - rect.top + 12, rect.height - 110)) + 30);
      el.style.cursor = s ? "pointer" : "grab";
      return s;
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
        const s = pick(e);
        if (s) pickRef.current?.(s.index);
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
      disposeGroup(group);
      tip.hide();
    };
  }, [stage, sentences, layout, scheme]);

  if (failed) return <p className="empty">This browser cannot show 3D graphics (WebGL is off).</p>;
  return (
    <div className="landscape3d" data-ready={stage ? "true" : "false"}>
      <div className="legend-keys small">
        <span><i className="globe3d-swatch" style={{ background: HOSTILE }} /> hostile words</span>
        <span><i className="globe3d-swatch" style={{ background: COOPERATIVE }} /> cooperative words</span>
        <span>tile colour: VADER sentiment (red negative · blue positive)</span>
      </div>
      <div className="landscape3d-stage" ref={ref} role="img"
        aria-label={`3D landscape of ${sentences.length} sentences: columns show hostile and cooperative words. The table below lists every sentence.`} />
      {tip.item && (
        <div className="tooltip landscape3d-tip" ref={tip.ref}>
          <div className="year">Sentence {tip.item.index + 1}</div>
          <div className="small">{tip.item.sentence.length > 180 ? `${tip.item.sentence.slice(0, 180)}…` : tip.item.sentence}</div>
          <div className="small muted">VADER {tip.item.vader.toFixed(2)} · {tip.item.hostile_hits} hostile · {tip.item.coop_hits} cooperative</div>
        </div>
      )}
    </div>
  );
}

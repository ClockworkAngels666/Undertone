import { useEffect, useRef } from "react";
import {
  AmbientLight,
  BoxGeometry,
  CanvasTexture,
  DirectionalLight,
  Group,
  Mesh,
  MeshStandardMaterial,
  Raycaster,
  SRGBColorSpace,
  Vector2,
} from "three";
import { useColorScheme } from "../lib/colors";
import { shortName } from "../lib/format";
import { createFlagPole, flagTexture } from "./flags";
import { textSprite } from "./labels";
import { isSmallScreen } from "./stage";
import { disposeGroup, useStage } from "./useStage";

interface Props {
  /** The year's top three, first place first. */
  rows: { country: string; name: string; value: number }[];
  format: (value: number) => string;
  onPick: (code: string) => void;
}

// First place in the middle, second on the left, third on the right
const STEPS = [
  { x: 0, height: 0.42 },
  { x: -0.62, height: 0.3 },
  { x: 0.62, height: 0.2 },
];
const WIDTH = 0.58;
const POLE = 0.5;

/** The step's front: its place number. */
function frontTexture(place: number, height: number, dark: boolean) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = Math.round((256 * height) / WIDTH);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = dark ? "#22384d" : "#eef3f8";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = dark ? "#7cc8f0" : "#0072bc";
  ctx.font = `800 ${Math.round(canvas.height * 0.62)}px "Fraunces Variable", Georgia, serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(place), canvas.width / 2, canvas.height * 0.54);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/** A podium with the flags of the year's three highest-ranked countries. */
export default function Podium({ rows, format, onPick }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const scheme = useColorScheme();
  const small = isSmallScreen();
  const { stage, failed } = useStage(ref, { fov: 32, zoom: false, minDistance: 1, maxDistance: 20 });
  const pickRef = useRef(onPick);
  pickRef.current = onPick;
  const targets = useRef<{ mesh: Mesh; code: string }[]>([]);

  useEffect(() => {
    if (!stage) return;
    const dark = scheme === "dark";
    const ink = dark ? "#f1f2f3" : "#0f1c2b";
    const group = new Group();
    group.add(new AmbientLight(0xffffff, 1.4));
    const sun = new DirectionalLight(0xffffff, 1.8);
    sun.position.set(1.5, 3, 2.5);
    group.add(sun);
    const stagePlatform = new Mesh(new BoxGeometry(2.2, 0.04, 0.8), new MeshStandardMaterial({
      color: dark ? 0x1a2d40 : 0xd5dee7, roughness: 0.9 }));
    stagePlatform.position.y = -0.02;
    group.add(stagePlatform);

    const side = new MeshStandardMaterial({ color: dark ? 0x22384d : 0xeef3f8, roughness: 0.6 });
    const poles: ReturnType<typeof createFlagPole>[] = [];
    targets.current = [];
    let cancelled = false;
    rows.slice(0, 3).forEach((row, i) => {
      const { x, height } = STEPS[i];
      const front = new MeshStandardMaterial({ map: frontTexture(i + 1, height, dark), roughness: 0.6 });
      // BoxGeometry faces: +x, −x, +y, −y, +z (front), −z
      const step = new Mesh(new BoxGeometry(WIDTH, height, 0.5), [side, side, side, side, front, side]);
      step.position.set(x, height / 2, 0);
      group.add(step);

      const pole = createFlagPole({ width: 0.32, segments: small ? [10, 5] : [16, 8], phase: i * 2 });
      pole.group.position.set(x - 0.13, height, -0.08);
      pole.setHeight(POLE);
      group.add(pole.group);
      poles.push(pole);
      void flagTexture(row.country).then((texture) => {
        if (cancelled) texture.dispose();
        else {
          pole.setFlag(texture);
          stage.invalidate();
        }
      });
      const name = textSprite(shortName(row.name, 18),
        { color: ink, height: small ? 0.11 : 0.085, weight: 500, onTop: true });
      name.position.set(x, height + POLE + 0.2, 0);
      const value = textSprite(format(row.value), { color: ink, height: small ? 0.1 : 0.08, onTop: true });
      value.position.set(x, height + POLE + 0.1, 0);
      group.add(name, value);
      for (const mesh of [...pole.meshes, step]) targets.current.push({ mesh, code: row.country });
    });
    stage.scene.add(group);
    stage.frame({ x: 1.0, y: 0.62 }, [0, 0.58, 0], [0, 0.2, 1]);
    const controls = stage.controls!;
    controls.minAzimuthAngle = -0.8;
    controls.maxAzimuthAngle = 0.8;
    controls.minPolarAngle = 0.8;
    controls.maxPolarAngle = 1.6;
    const stop = stage.onFrame((seconds) => {
      if (stage.reducedMotion) return;
      for (const pole of poles) pole.wave(seconds, 1);
      stage.invalidate();
    });
    return () => {
      cancelled = true;
      stop();
      targets.current = [];
      disposeGroup(group);
    };
  }, [stage, rows, format, scheme, small]);

  // A click or tap on a flag or step opens that country's speech
  useEffect(() => {
    if (!stage) return;
    const el = stage.renderer.domElement;
    const raycaster = new Raycaster();
    const pointer = new Vector2();
    const pick = (e: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(pointer, stage.camera);
      const hit = raycaster.intersectObjects(targets.current.map((t) => t.mesh), false)[0];
      const code = hit && targets.current.find((t) => t.mesh === hit.object)?.code;
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

  if (failed) return null;
  return (
    <div className="podium3d" ref={ref} data-ready={stage ? "true" : "false"} role="img"
      aria-label={`Podium: ${rows.slice(0, 3).map((r, i) => `${i + 1}. ${r.name} (${format(r.value)})`).join(", ")}`} />
  );
}

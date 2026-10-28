import { useEffect, useRef } from "react";
import {
  AmbientLight,
  BoxGeometry,
  CanvasTexture,
  CircleGeometry,
  CylinderGeometry,
  DirectionalLight,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  SphereGeometry,
  SRGBColorSpace,
  TorusGeometry,
} from "three";
import { useColorScheme } from "../lib/colors";
import { createFlagPole, flagTexture } from "./flags";
import { isSmallScreen } from "./stage";
import { disposeGroup, useStage } from "./useStage";

interface Props {
  code: string;
  name: string;
  year: number;
  session: number;
  /** The speech is being read aloud: the microphone lights up and sound rings spread from it. */
  speaking?: boolean;
}

function plaque(lines: [string, string]) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 160;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#d9c38f";
  ctx.fillRect(0, 0, 512, 160);
  ctx.strokeStyle = "#8a6d33";
  ctx.lineWidth = 6;
  ctx.strokeRect(6, 6, 500, 148);
  ctx.fillStyle = "#3b2a10";
  ctx.textAlign = "center";
  ctx.font = `800 ${lines[0].length > 18 ? 40 : 52}px "Fraunces Variable", Georgia, serif`;
  ctx.fillText(lines[0], 256, 74);
  ctx.font = `500 34px "Jost Variable", sans-serif`;
  ctx.fillText(lines[1], 256, 126);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/** A General Assembly-style speaker's rostrum with the speaking country's flag beside it. */
export default function Rostrum({ code, name, year, session, speaking = false }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const scheme = useColorScheme();
  const { stage, failed } = useStage(ref, { fov: 32, zoom: false, minDistance: 1, maxDistance: 20 });
  const speakingRef = useRef(speaking);
  useEffect(() => {
    speakingRef.current = speaking;
    stage?.invalidate();
  }, [speaking, stage]);

  useEffect(() => {
    if (!stage) return;
    const small = isSmallScreen();
    const group = new Group();
    group.add(new AmbientLight(0xffffff, 1.2));
    const key = new DirectionalLight(0xfff4e0, 2.0);
    key.position.set(1.5, 3, 2.5);
    group.add(key);

    // Floor and the panelled gold wall behind the speaker (no emblem)
    const floor = new Mesh(new CircleGeometry(9, 48), new MeshStandardMaterial({
      color: scheme === "dark" ? 0x1b2a38 : 0x5a4632, roughness: 0.9 }));
    floor.rotation.x = -Math.PI / 2;
    group.add(floor);
    // (wider and taller than the view, so its edges never show)
    const wall = new Mesh(new BoxGeometry(9, 4, 0.08), new MeshStandardMaterial({ color: 0xb8975a, roughness: 0.5,
      metalness: 0.25 }));
    wall.position.set(0, 2, -0.9);
    group.add(wall);
    const ribMaterial = new MeshStandardMaterial({ color: 0xd2b77c, roughness: 0.4, metalness: 0.35 });
    for (let i = -14; i <= 14; i++) {
      const rib = new Mesh(new BoxGeometry(0.05, 4, 0.04), ribMaterial);
      rib.position.set(i * 0.32, 2, -0.84);
      group.add(rib);
    }

    // The rostrum: green marble body, slanted top, plaque on the front
    const marble = new MeshStandardMaterial({ color: 0x2e5940, roughness: 0.3, metalness: 0.1 });
    const body = new Mesh(new BoxGeometry(1.0, 0.95, 0.55), marble);
    body.position.set(0, 0.475, 0);
    const top = new Mesh(new BoxGeometry(1.1, 0.06, 0.66), new MeshStandardMaterial({ color: 0x24493a, roughness: 0.25 }));
    top.position.set(0, 0.99, 0.02);
    top.rotation.x = -0.14;
    const sign = new Mesh(new PlaneGeometry(0.86, 0.27), new MeshStandardMaterial({
      map: plaque([name, `Session ${session} · ${year}`]), roughness: 0.6 }));
    sign.position.set(0, 0.62, 0.281);
    group.add(body, top, sign);

    // A microphone on a gooseneck
    const metal = new MeshStandardMaterial({ color: 0x222222, metalness: 0.7, roughness: 0.3 });
    const neck = new Mesh(new CylinderGeometry(0.008, 0.008, 0.36, 8), metal);
    neck.position.set(0.12, 1.15, 0.12);
    neck.rotation.set(0.5, 0, -0.25);
    const mic = new Mesh(new SphereGeometry(0.03, 12, 10), metal);
    mic.position.set(0.17, 1.3, 0.21);
    group.add(neck, mic);

    // While the speech is read aloud: a red light ring on the microphone and sound rings spreading from it
    const lamp = new MeshStandardMaterial({ color: 0x401818, emissive: 0xff2a1a, emissiveIntensity: 0, roughness: 0.4 });
    const light = new Mesh(new TorusGeometry(0.034, 0.007, 8, 24), lamp);
    light.position.copy(mic.position);
    group.add(light);
    const rings = [0, 1, 2].map(() => {
      const ring = new Mesh(new TorusGeometry(0.06, 0.004, 6, 40), new MeshBasicMaterial({
        color: scheme === "dark" ? 0x8fd3f5 : 0x0072bc, transparent: true, opacity: 0, depthWrite: false }));
      ring.position.copy(mic.position);
      ring.visible = false;
      group.add(ring);
      return ring;
    });

    // The country's flag on a pole beside the rostrum
    const flag = createFlagPole({ width: 0.7, segments: small ? [12, 6] : [22, 10] });
    flag.group.position.set(-0.95, 0, -0.35);
    flag.setHeight(1.95);
    group.add(flag.group);
    let cancelled = false;
    void flagTexture(code).then((texture) => {
      if (cancelled) texture.dispose();
      else {
        flag.setFlag(texture);
        stage.invalidate();
      }
    });

    stage.scene.add(group);
    const controls = stage.controls!;
    controls.enablePan = false;
    controls.minAzimuthAngle = -0.7;      // turn left and right a little, never behind the wall
    controls.maxAzimuthAngle = 0.7;
    controls.minPolarAngle = 0.9;
    controls.maxPolarAngle = 1.5;
    stage.frame({ x: 1.1, y: 0.92 }, [-0.22, 0.88, 0], [0.3, 0.14, 1]);
    const stop = stage.onFrame((seconds) => {
      if (!stage.reducedMotion) flag.wave(seconds, 1.3);
      const on = speakingRef.current;
      lamp.emissiveIntensity = on ? 2.4 : 0;
      rings.forEach((ring, k) => {
        ring.visible = on && (!stage.reducedMotion || k === 0);
        if (!ring.visible) return;
        const t = stage.reducedMotion ? 0.3 : (seconds * 0.8 + k / 3) % 1;     // each ring a third apart
        ring.scale.setScalar(1 + t * 2.4);
        ring.position.z = mic.position.z + t * 0.22;
        (ring.material as MeshBasicMaterial).opacity = 0.6 * (1 - t);
      });
      stage.invalidate();
    });
    return () => {
      cancelled = true;
      stop();
      disposeGroup(group);
    };
  }, [stage, code, name, year, session, scheme]);

  if (failed) return null;
  return <div className="rostrum3d" ref={ref} role="img" aria-label={`${name} at the rostrum, session ${session}, ${year}`}
    data-ready={stage ? "true" : "false"} />;
}

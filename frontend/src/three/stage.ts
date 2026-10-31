import {
  Color,
  type Material,
  type Mesh,
  type Object3D,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  type Texture,
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { keepLabelsReadable } from "./labels";

/** Can this browser draw WebGL? (Old devices, some privacy settings and remote desktops cannot.) */
export function webglAvailable(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

/** Phones and small tablets get lighter 3D (smaller textures, fewer polygons, lower pixel density). */
export function isSmallScreen(): boolean {
  return typeof window !== "undefined" && Boolean(window.matchMedia?.("(max-width: 760px)").matches);
}

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
}

export interface Stage {
  renderer: WebGLRenderer;
  scene: Scene;
  camera: PerspectiveCamera;
  controls: OrbitControls | null;
  reducedMotion: boolean;
  /** Called every animation frame while the view is visible. Returns a function that stops it. */
  onFrame: (fn: (seconds: number, delta: number) => void) => () => void;
  /** Ask for one more frame (for views that only redraw when something changes). */
  invalidate: () => void;
  /**
   * Point the camera at `target` from `direction`, far enough away that a sphere of `radius` fits whatever the
   * screen's shape (portrait phones included). Re-applied on resize until the user moves the view.
   */
  frame: (radius: number | { x: number; y: number }, target?: [number, number, number],
    direction?: [number, number, number], options?: { smooth?: boolean }) => void;
  dispose: () => void;
}

interface Options {
  fov?: number;
  position?: [number, number, number];
  target?: [number, number, number];
  controls?: boolean;
  zoom?: boolean;
  minDistance?: number;
  maxDistance?: number;
  /** Keep animating every frame (otherwise frames are drawn only on change). */
  continuous?: boolean;
  maxPixelRatio?: number;
}

/**
 * A three.js renderer bound to a container: sizes itself with the container, pauses when off screen or in a
 * background tab, and cleans up everything on dispose (React effects call it on unmount).
 */
export function createStage(container: HTMLElement, options: Options = {}): Stage {
  const small = isSmallScreen();
  const renderer = new WebGLRenderer({ antialias: !small, alpha: true, powerPreference: "low-power" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, small ? 1.5 : options.maxPixelRatio ?? 2));
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.setClearColor(new Color(0x000000), 0);
  renderer.domElement.style.display = "block";
  renderer.domElement.style.width = "100%";
  renderer.domElement.style.height = "100%";
  renderer.domElement.style.touchAction = "pan-y";
  container.appendChild(renderer.domElement);

  const scene = new Scene();
  const camera = new PerspectiveCamera(options.fov ?? 40, 1, 0.01, 100);
  camera.position.set(...(options.position ?? [0, 0, 3.2]));
  const target = new Vector3(...(options.target ?? [0, 0, 0]));
  camera.lookAt(target);

  let controls: OrbitControls | null = null;
  if (options.controls !== false) {
    controls = new OrbitControls(camera, renderer.domElement);
    controls.target.copy(target);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = false;
    controls.enableZoom = options.zoom ?? true;
    controls.minDistance = options.minDistance ?? 1.4;
    controls.maxDistance = options.maxDistance ?? 8;
    controls.update();
    // On touch screens a vertical swipe should still scroll the page; sideways swipes turn the view and
    // two fingers zoom. (OrbitControls would otherwise capture every touch.)
    renderer.domElement.style.touchAction = "pan-y";
  }

  const reducedMotion = prefersReducedMotion();
  const frameCallbacks: ((seconds: number, delta: number) => void)[] = [];
  let visible = true;
  let raf = 0;
  let dirty = true;
  let last = performance.now();

  // radius: a sphere that must fit; {x, y}: half the width and height of a flatter scene (fits wide screens better)
  let framing: { radius: number | { x: number; y: number }; target: Vector3; direction: Vector3 } | null = null;
  let userMoved = false;
  let glide: { position: Vector3; target: Vector3 } | null = null;      // smooth framing in progress
  const applyFrame = (smooth = false) => {
    if (!framing) return;
    const vertical = (camera.fov * Math.PI) / 180;
    const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * camera.aspect);
    const r = framing.radius;
    const distance = typeof r === "number" ? r / Math.sin(Math.min(vertical, horizontal) / 2)
      : Math.max(r.x / Math.tan(horizontal / 2), r.y / Math.tan(vertical / 2)) + 0.3 * Math.max(r.x, r.y);
    const position = framing.target.clone().addScaledVector(framing.direction, distance);
    if (smooth && controls) {
      glide = { position, target: framing.target.clone() };
      controls.maxDistance = Math.max(controls.maxDistance, distance * 1.8);
      dirty = true;
      return;
    }
    glide = null;
    camera.position.copy(position);
    camera.lookAt(framing.target);
    if (controls) {
      controls.target.copy(framing.target);
      controls.maxDistance = Math.max(controls.maxDistance, distance * 1.8);
      controls.update();
    }
    dirty = true;
  };

  const resize = () => {
    const { clientWidth: w, clientHeight: h } = container;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    if (!userMoved) applyFrame(false);
    dirty = true;
    start();
  };

  // `raf` stays non-zero while a frame is scheduled or running, so invalidate() calls made from inside a frame
  // never schedule a second loop. When nothing changes the loop stops (saves battery) until invalidate(),
  // a resize or the user touching the view starts it again.
  const loop = (now: number) => {
    if (!visible || document.hidden) {
      raf = 0;
      return;
    }
    const delta = Math.min(0.1, (now - last) / 1000);
    last = now;
    for (const fn of frameCallbacks) fn(now / 1000, delta);
    if (glide && controls) {
      const k = Math.min(1, delta * 5);
      camera.position.lerp(glide.position, k);
      controls.target.lerp(glide.target, k);
      dirty = true;
      if (camera.position.distanceTo(glide.position) < 1e-3) glide = null;
    }
    const moved = controls ? controls.update() : false;
    const draw = dirty || moved || Boolean(options.continuous);
    if (draw) {
      dirty = false;
      keepLabelsReadable(scene, camera, container.clientHeight);
      renderer.render(scene, camera);
    }
    raf = draw || dirty ? requestAnimationFrame(loop) : 0;
  };
  const start = () => {
    if (!raf) {
      last = performance.now();
      raf = requestAnimationFrame(loop);
    }
  };

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);
  const visibilityObserver = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible) start();
  });
  visibilityObserver.observe(container);
  const onVisibility = () => {
    if (!document.hidden) start();
  };
  document.addEventListener("visibilitychange", onVisibility);
  controls?.addEventListener("change", () => {
    dirty = true;
    start();
  });
  controls?.addEventListener("start", () => {
    userMoved = true;
    glide = null;
    start();
  });
  resize();
  start();

  return {
    renderer,
    scene,
    camera,
    controls,
    reducedMotion,
    onFrame: (fn) => {
      frameCallbacks.push(fn);
      start();
      return () => {
        const i = frameCallbacks.indexOf(fn);
        if (i >= 0) frameCallbacks.splice(i, 1);
      };
    },
    invalidate: () => {
      dirty = true;
      start();
    },
    frame: (radius, target = [0, 0, 0], direction = [0, 0, 1], frameOptions = {}) => {
      framing = { radius, target: new Vector3(...target), direction: new Vector3(...direction).normalize() };
      if (frameOptions.smooth && userMoved) return;      // never yank the view away from someone exploring it
      userMoved = false;
      applyFrame(frameOptions.smooth);
      start();
    },
    dispose: () => {
      cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      visibilityObserver.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      controls?.dispose();
      scene.traverse((object: Object3D) => {
        const mesh = object as Mesh;
        mesh.geometry?.dispose();
        const materials = ([] as (Material | undefined)[]).concat(mesh.material as Material | Material[]);
        for (const material of materials) {
          if (!material) continue;
          for (const value of Object.values(material)) {
            if ((value as Texture)?.isTexture) (value as Texture).dispose();
          }
          material.dispose();
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}

/**
 * Position on a unit sphere for a longitude/latitude, matching three.js SphereGeometry's texture mapping
 * (an equirectangular image with longitude −180° at its left edge).
 */
export function lonLatToVector3(lon: number, lat: number, radius = 1): Vector3 {
  const phi = ((lon + 180) * Math.PI) / 180;
  const theta = (lat * Math.PI) / 180;
  return new Vector3(-Math.cos(phi) * Math.cos(theta) * radius, Math.sin(theta) * radius,
    Math.sin(phi) * Math.cos(theta) * radius);
}

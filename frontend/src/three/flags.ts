import {
  CanvasTexture,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  SphereGeometry,
  SRGBColorSpace,
} from "three";
import { ISO_ALPHA2 } from "./isoCodes";

// Every flag (flag-icons, MIT licence) as a lazily loaded file: only the flags on screen are downloaded.
const FLAG_FILES = import.meta.glob("/node_modules/flag-icons/flags/4x3/*.svg", {
  query: "?url",
  import: "default",
}) as Record<string, () => Promise<string>>;

const W = 320;
const H = 240;
const drawn = new Map<string, Promise<HTMLCanvasElement>>();

/** Path of the flag file for a corpus code (exported for tests). */
export function flagFile(code: string): string | undefined {
  const alpha2 = ISO_ALPHA2[code];
  const path = alpha2 && `/node_modules/flag-icons/flags/4x3/${alpha2}.svg`;
  return path && path in FLAG_FILES ? path : undefined;
}

async function svgImage(url: string): Promise<HTMLImageElement> {
  // The SVGs have only a viewBox; give them a size so every browser can draw them onto a canvas.
  const text = await (await fetch(url)).text();
  const sized = text.replace(/<svg\b/, `<svg width="${W}" height="${H}" preserveAspectRatio="none"`);
  const blobUrl = URL.createObjectURL(new Blob([sized], { type: "image/svg+xml" }));
  try {
    const image = new Image();
    image.src = blobUrl;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

function drawFlag(code: string, fallbackColor: string): Promise<HTMLCanvasElement> {
  const key = `${code}|${fallbackColor}`;
  let promise = drawn.get(key);
  if (!promise) {
    promise = (async () => {
      const canvas = document.createElement("canvas");
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext("2d")!;
      const file = flagFile(code);
      if (file) {
        try {
          ctx.drawImage(await svgImage(await FLAG_FILES[file]()), 0, 0, W, H);
          return canvas;
        } catch {
          // fall through to the plain flag
        }
      }
      // Historical states (Yugoslavia, Czechoslovakia…) and custom codes: a plain flag with the code on it.
      // The Soviet Union's is red with the name in gold, after its flag.
      const soviet = code === "USSR";
      ctx.fillStyle = soviet ? "#cc0000" : fallbackColor;
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = soviet ? "#ffd700" : "#ffffff";
      ctx.font = `600 ${Math.round(H * 0.3)}px "Jost Variable", Jost, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(code, W / 2, H / 2);
      return canvas;
    })();
    drawn.set(key, promise);
  }
  return promise;
}

/** A texture of a country's flag (each call returns its own texture, so disposing it is always safe). */
export async function flagTexture(code: string, fallbackColor = "#5b6b7a"): Promise<CanvasTexture> {
  const texture = new CanvasTexture(await drawFlag(code, fallbackColor));
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

export interface FlagPole {
  group: Group;
  /** Pick targets (the flag cloth and the pole). */
  meshes: Mesh[];
  setHeight: (height: number) => void;
  setFlag: (texture: CanvasTexture) => void;
  /** Lower the flag to half-mast (used for "no statement this year"). */
  setHalfMast: (half: boolean) => void;
  /** Move the cloth; call every frame with the time in seconds. */
  wave: (seconds: number, strength?: number) => void;
}

/** A flagpole with a cloth that waves. Height is the pole's length in scene units. */
export function createFlagPole(options: { width?: number; segments?: [number, number]; phase?: number } = {}): FlagPole {
  const width = options.width ?? 0.42;
  const height = width * 0.75;
  const [sx, sy] = options.segments ?? [18, 8];
  const phase = options.phase ?? 0;

  const group = new Group();
  const poleGeometry = new CylinderGeometry(0.011, 0.014, 1, 10);
  poleGeometry.translate(0, 0.5, 0);
  const pole = new Mesh(poleGeometry, new MeshStandardMaterial({ color: 0xc9d1da, metalness: 0.6, roughness: 0.35 }));
  const finial = new Mesh(new SphereGeometry(0.022, 12, 10),
    new MeshStandardMaterial({ color: 0xd4af37, metalness: 0.7, roughness: 0.3 }));
  const cloth = new PlaneGeometry(width, height, sx, sy);
  cloth.translate(width / 2 + 0.012, -height / 2, 0);            // hangs from the top, attached at the left edge
  const base = Float32Array.from(cloth.attributes.position.array as Float32Array);
  const flag = new Mesh(cloth, new MeshStandardMaterial({ side: DoubleSide, roughness: 0.85, color: 0xffffff }));
  group.add(pole, finial, flag);

  let poleHeight = 1;
  let halfMast = false;
  const placeFlag = () => {
    const top = poleHeight - 0.02;
    flag.position.y = halfMast ? Math.max(height + 0.05, poleHeight * 0.55) : top;
    finial.position.y = poleHeight + 0.015;
  };

  return {
    group,
    meshes: [flag, pole],
    setHeight: (h) => {
      poleHeight = Math.max(0.05, h);
      pole.scale.y = poleHeight;
      placeFlag();
    },
    setFlag: (texture) => {
      const material = flag.material as MeshStandardMaterial;
      material.map?.dispose();
      material.map = texture;
      material.needsUpdate = true;
    },
    setHalfMast: (half) => {
      halfMast = half;
      placeFlag();
    },
    wave: (seconds, strength = 1) => {
      const position = cloth.attributes.position;
      const array = position.array as Float32Array;
      for (let i = 0; i < array.length; i += 3) {
        const x = base[i] / width;                                 // 0 at the pole, 1 at the free end
        const ripple = Math.sin(base[i] * 11 - seconds * 4.2 + phase) + 0.35 * Math.sin(base[i] * 23 - seconds * 6.1 + phase);
        array[i + 2] = ripple * 0.028 * strength * x;
        array[i + 1] = base[i + 1] - 0.012 * strength * x * x;     // the free end droops a little
      }
      position.needsUpdate = true;
      cloth.computeVertexNormals();
    },
  };
}

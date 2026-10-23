import { CanvasTexture, LinearFilter, Sprite, SpriteMaterial, SRGBColorSpace } from "three";

/** A text label that always faces the camera. `height` is its size in scene units. */
export function textSprite(text: string, options: { color?: string; height?: number; weight?: number; font?: string;
  onTop?: boolean } = {}) {
  const fontSize = 64;
  const font = `${options.weight ?? 400} ${fontSize}px ${options.font ?? '"Jost Variable", Jost, sans-serif'}`;
  const measure = document.createElement("canvas").getContext("2d")!;
  measure.font = font;
  const width = Math.ceil(measure.measureText(text).width) + 16;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = fontSize + 24;
  const ctx = canvas.getContext("2d")!;
  ctx.font = font;
  ctx.fillStyle = options.color ?? "#3d4c5c";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 8, canvas.height / 2);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearFilter;
  const sprite = new Sprite(new SpriteMaterial({ map: texture, transparent: true, depthWrite: false,
    depthTest: !options.onTop }));
  if (options.onTop) sprite.renderOrder = 10;     // never hidden behind the scene
  const height = options.height ?? 0.08;
  sprite.scale.set((height * canvas.width) / canvas.height, height, 1);
  return sprite;
}

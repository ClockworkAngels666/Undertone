import {
  CanvasTexture,
  LinearFilter,
  type Object3D,
  type PerspectiveCamera,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  Vector3,
} from "three";

/** The smallest text a 3D view draws, in CSS pixels; labels further away or on a small screen grow to it. */
export const MIN_LABEL_PX = 11;

interface LabelSize {
  height: number;        // the height asked for, in scene units
  aspect: number;        // width / height of the texture
  text: number;          // share of the sprite's height taken by the font
}

/** A text label that always faces the camera. `height` is its size in scene units. `anchor` is the edge that stays
 *  at the label's position when it grows to stay readable: "top" grows downward, "bottom" upward. */
export function textSprite(text: string, options: { color?: string; height?: number; weight?: number; font?: string;
  onTop?: boolean; anchor?: "center" | "top" | "bottom" } = {}) {
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
  if (options.anchor === "top") sprite.center.set(0.5, 1);
  if (options.anchor === "bottom") sprite.center.set(0.5, 0);
  const height = options.height ?? 0.08;
  sprite.scale.set((height * canvas.width) / canvas.height, height, 1);
  sprite.userData.label = { height, aspect: canvas.width / canvas.height, text: fontSize / canvas.height } as LabelSize;
  return sprite;
}

/** The height a label was made with, in scene units (before keepLabelsReadable grows it). */
export function baseHeight(sprite: Object3D): number {
  return (sprite.userData.label as LabelSize | undefined)?.height ?? 0;
}

const where = new Vector3();
const parentScale = new Vector3();

/** Grow every label whose text would be drawn under MIN_LABEL_PX at the camera's current distance; shrink it back
 *  to the size asked for when it comes closer. Runs before each draw (see stage.ts). */
export function keepLabelsReadable(scene: Object3D, camera: PerspectiveCamera, viewportHeight: number) {
  scene.updateMatrixWorld();
  camera.updateMatrixWorld();
  const pixelsPerUnit = viewportHeight / (2 * Math.tan((camera.fov * Math.PI) / 360));    // at distance 1
  scene.traverseVisible((object) => {
    const label = object.userData.label as LabelSize | undefined;
    if (!label) return;
    const depth = -object.getWorldPosition(where).applyMatrix4(camera.matrixWorldInverse).z;
    if (depth <= 0) return;
    const inherited = object.parent ? object.parent.getWorldScale(parentScale).y : 1;
    const textPx = (label.height * inherited * label.text * pixelsPerUnit) / depth;
    const grow = textPx > 0 && textPx < MIN_LABEL_PX ? MIN_LABEL_PX / textPx : 1;
    object.scale.set(label.height * label.aspect * grow, label.height * grow, 1);
  });
}

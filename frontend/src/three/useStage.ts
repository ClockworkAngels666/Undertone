import { type RefObject, useEffect, useState } from "react";
import type { Group, Material, Mesh, Texture } from "three";
import { createStage, type Stage, webglAvailable } from "./stage";

/** Create a three.js stage in a container for the lifetime of a component. */
export function useStage(ref: RefObject<HTMLDivElement | null>, options: Parameters<typeof createStage>[1]) {
  const [stage, setStage] = useState<Stage | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!ref.current) return;
    if (!webglAvailable()) {
      setFailed(true);
      return;
    }
    const created = createStage(ref.current, options);
    setStage(created);
    return () => {
      setStage(null);
      created.dispose();
    };
    // the options are fixed for a component's lifetime
  }, [ref]);
  return { stage, failed };
}

/** Remove a group from its parent and free its GPU memory. */
export function disposeGroup(group: Group) {
  group.removeFromParent();
  group.traverse((object) => {
    const mesh = object as Mesh;
    mesh.geometry?.dispose();
    for (const material of ([] as (Material | undefined)[]).concat(mesh.material as Material | Material[])) {
      if (!material) continue;
      for (const value of Object.values(material)) if ((value as Texture)?.isTexture) (value as Texture).dispose();
      material.dispose();
    }
  });
}

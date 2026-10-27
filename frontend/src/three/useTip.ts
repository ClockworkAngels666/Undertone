import { useCallback, useLayoutEffect, useRef, useState } from "react";

/**
 * Hover tooltip for a 3D view. React re-renders only when the hovered item changes; the position follows the
 * pointer by writing to the element's style, so moving the mouse costs no render.
 */
export function useTip<T>() {
  const [item, setItem] = useState<T | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const at = useRef({ x: 0, y: 0 });
  const place = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.left = `${at.current.x}px`;
    el.style.top = `${at.current.y}px`;
  }, []);
  const show = useCallback((next: T | null, x: number, y: number) => {
    at.current = { x, y };
    setItem(next);   // the same item again skips the render
    place();
  }, [place]);
  const hide = useCallback(() => setItem(null), []);
  // A tooltip that has just appeared gets its position before it is painted
  useLayoutEffect(place);
  return { item, ref, show, hide };
}

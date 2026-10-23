import { useEffect, useRef, useState } from "react";

// Categorical palette (validated for colour-vision deficiencies in both modes).
// Slots are assigned in fixed order and stay with the country, never with its rank.
export const PALETTE = {
  light: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"],
  dark: ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"],
};
export const AVERAGE_COLOR = { light: "#898781", dark: "#a3a29b" };

export type Scheme = "light" | "dark";

export function useColorScheme(): Scheme {
  const query = "(prefers-color-scheme: dark)";
  const get = () => (typeof window !== "undefined" && window.matchMedia?.(query).matches ? "dark" : "light");
  const [scheme, setScheme] = useState<Scheme>(get);
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return;
    const onChange = () => setScheme(mq.matches ? "dark" : "light");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return scheme;
}

/** Keep each key's colour slot while keys are added or removed (colour follows the entity). */
export function assignSlots(previous: Record<string, number>, keys: string[], slots = 8): Record<string, number> {
  const next: Record<string, number> = {};
  for (const key of keys) if (key in previous) next[key] = previous[key];
  for (const key of keys) {
    if (key in next) continue;
    const used = new Set(Object.values(next));
    let slot = 0;
    while (used.has(slot) && slot < slots - 1) slot += 1;
    next[key] = slot;
  }
  return next;
}

export function useStableSlots(keys: string[]): Record<string, number> {
  const memory = useRef<Record<string, number>>({});
  memory.current = assignSlots(memory.current, keys);
  return memory.current;
}

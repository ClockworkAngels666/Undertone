// Small line icons drawn for this app (16px grid, current text colour). Decorative: the button text names the action.

const base = {
  width: 16,
  height: 16,
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  focusable: false,
  className: "icon",
};

export function PlayIcon() {
  return <svg {...base}><path d="M5 3.5v9l7-4.5z" fill="currentColor" /></svg>;
}

export function PauseIcon() {
  return <svg {...base}><path d="M5.5 3.5v9M10.5 3.5v9" /></svg>;
}

export function StopIcon() {
  return <svg {...base}><rect x="4" y="4" width="8" height="8" rx="1.5" fill="currentColor" stroke="none" /></svg>;
}

export function CloseIcon() {
  return <svg {...base}><path d="M4.5 4.5l7 7M11.5 4.5l-7 7" /></svg>;
}

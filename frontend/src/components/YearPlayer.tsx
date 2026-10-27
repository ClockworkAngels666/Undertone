import { useEffect, useId, useState } from "react";

/** Play button and slider for views that show one year at a time. */
export default function YearPlayer({ years, year, onYearChange, label }: {
  years: number[];
  year: number;
  onYearChange: (year: number) => void;
  /** Accessible name of the slider (e.g. "Year shown by the flags"). */
  label: string;
}) {
  const id = useId();
  const [playing, setPlaying] = useState(false);
  const first = years[0];
  const last = years[years.length - 1];

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => {
      const i = years.indexOf(year);
      if (i < 0 || i >= years.length - 1) setPlaying(false);
      else onYearChange(years[i + 1]);
    }, 700);
    return () => window.clearInterval(timer);
  }, [playing, year, years, onYearChange]);

  return (
    <div className="year-player">
      <button type="button" className="btn small primary" aria-pressed={playing} onClick={() => {
        if (!playing && year >= last) onYearChange(first);
        setPlaying(!playing);
      }}>{playing ? "❚❚ Pause" : "▶ Play years"}</button>
      <label className="visually-hidden" htmlFor={id}>{label}</label>
      <input id={id} type="range" min={first} max={last} step={1} value={year} onChange={(e) => {
        setPlaying(false);
        onYearChange(Number(e.target.value));
      }} />
    </div>
  );
}

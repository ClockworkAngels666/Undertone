import { useEffect, useMemo, useRef, useState, type Ref, type RefObject } from "react";
import type { Reading, ReadingSentence } from "../api/types";
import { RATES, voiceLabel, type Speech } from "../lib/speech";
import { HighlightedText } from "./common";
import { PauseIcon, PlayIcon, StopIcon } from "./icons";

/** A reading's sentences in order, and the text to speak for each. */
export function useFlatReading(reading: Reading | null | undefined) {
  return useMemo(() => {
    const flat = (reading ?? []).flat();
    return { flat, texts: flat.map((s) => s.text) };
  }, [reading]);
}

/** Listen / pause / stop, a position slider, and the voice and speed. */
export function ListenBar({ speech, what, barRef }: { speech: Speech; what: string; barRef?: Ref<HTMLDivElement> }) {
  if (!speech.supported) return <p className="muted small">This browser can't read text aloud.</p>;
  const { status, current, total } = speech;
  return (
    <div className="listen" role="group" aria-label={`Listen to ${what}`} ref={barRef}>
      <div className="listen-main">
        {status === "playing" ? (
          <button type="button" className="btn primary" onClick={speech.pause}><PauseIcon /> Pause</button>
        ) : (
          <button type="button" className="btn primary" onClick={() => speech.play()} disabled={!total}>
            <PlayIcon /> {status === "paused" ? "Resume" : "Listen"}
          </button>
        )}
        {status !== "idle" && (
          <button type="button" className="btn" onClick={speech.stop}><StopIcon /> Stop</button>
        )}
        <input type="range" min={0} max={Math.max(0, total - 1)} value={Math.min(current, Math.max(0, total - 1))}
          disabled={!total} aria-label="Sentence" aria-valuetext={`Sentence ${current + 1} of ${total}`}
          onChange={(e) => speech.seek(Number(e.target.value))} />
        <span className="listen-count">{total ? `${(current + 1).toLocaleString("en")} / ${total.toLocaleString("en")}` : "…"}</span>
      </div>
      <div className="listen-settings">
        {speech.voices.length > 1 && (
          <label>
            Voice
            <select value={speech.voice?.voiceURI} onChange={(e) => speech.setVoice(e.target.value)}>
              {speech.voices.map((v) => <option key={v.voiceURI} value={v.voiceURI}>{voiceLabel(v)}</option>)}
            </select>
          </label>
        )}
        <label>
          Speed
          <select value={speech.rate} onChange={(e) => speech.setRate(Number(e.target.value))}>
            {RATES.map((r) => <option key={r} value={r}>{r}×</option>)}
          </select>
        </label>
      </div>
      {speech.error && <p className="listen-error" role="alert">{speech.error}</p>}
    </div>
  );
}

/** While a text is being read aloud, Pause/Resume, Stop and the position stay pinned to the foot of the screen
 *  once the main controls (`anchor`) have scrolled out of view. */
export function MiniPlayer({ speech, anchor, what }: {
  speech: Speech; anchor: RefObject<HTMLElement | null>; what: string;
}) {
  const [away, setAway] = useState(false);
  const active = speech.status !== "idle";
  useEffect(() => {
    const el = anchor.current;
    if (!active || !el) {
      setAway(false);
      return;
    }
    const io = new IntersectionObserver(([entry]) => setAway(!entry.isIntersecting), { rootMargin: "-64px 0px 0px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [active, anchor]);
  if (!active || !away) return null;
  const { status, current, total } = speech;
  return (
    <div className="mini-player" role="group" aria-label={`Reading ${what} aloud`}>
      {status === "playing" ? (
        <button type="button" className="btn small primary" onClick={speech.pause}><PauseIcon /> Pause</button>
      ) : (
        <button type="button" className="btn small primary" onClick={() => speech.play()}><PlayIcon /> Resume</button>
      )}
      <button type="button" className="btn small" onClick={speech.stop}><StopIcon /> Stop</button>
      <span className="listen-count">{(current + 1).toLocaleString("en")} / {total.toLocaleString("en")}</span>
    </div>
  );
}

/** The sentence being read, shown like a subtitle. */
export function NowReading({ sentence }: { sentence: ReadingSentence | undefined }) {
  if (!sentence) return null;
  return (
    <blockquote className="now-reading" data-testid="now-reading">
      <HighlightedText text={sentence.text} spans={sentence.highlights} />
    </blockquote>
  );
}

/** A whole text in paragraphs, with dictionary words marked and the sentence being read lit up.
 *  Clicking a sentence starts reading there (keyboard users have the slider). */
export function ReadingText({ reading, current, onPick, label, testId }: {
  reading: Reading; current: number | null; onPick?: (index: number) => void; label: string; testId?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {          // keep the sentence being read in view inside the box, without moving the page
    const c = box.current;
    const el = current === null ? null : c?.querySelector<HTMLElement>(`[data-i="${current}"]`);
    if (!c || !el || c.scrollHeight <= c.clientHeight) return;
    const r = el.getBoundingClientRect();
    const b = c.getBoundingClientRect();
    if (r.top >= b.top && r.bottom <= b.bottom) return;
    const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    c.scrollTo({ top: c.scrollTop + r.top - b.top - b.height / 3, behavior: smooth ? "smooth" : "auto" });
  }, [current]);
  let n = 0;
  return (
    <div className={`highlighted reading${onPick ? " pickable" : ""}`} ref={box} tabIndex={0} role="region"
      aria-label={label} data-testid={testId}>
      {reading.map((paragraph, p) => (
        <p key={p}>
          {paragraph.map((s) => {
            const i = n++;
            return (
              <span key={i} data-i={i} className={i === current ? "now" : undefined}
                onClick={onPick ? () => onPick(i) : undefined}>
                <HighlightedText text={s.text} spans={s.highlights} />{" "}
              </span>
            );
          })}
        </p>
      ))}
    </div>
  );
}

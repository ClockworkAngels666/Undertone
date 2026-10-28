// Reading texts aloud with the voices built into the visitor's browser (Web Speech API): no audio files,
// no outside service. Each sentence is its own utterance, so the page can follow along and jump around.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { storage, type ListenSettings } from "./storage";

export const RATES = [0.75, 1, 1.25, 1.5, 2];

export type SpeechStatus = "idle" | "playing" | "paused";

export function speechSupported() {
  return typeof window !== "undefined" && "speechSynthesis" in window
    && typeof window.SpeechSynthesisUtterance === "function";
}

/** English voices, best first. Voices on the device come first: online ones (Chrome's Google voices, Edge's
 *  natural voices) send the text to Google's or Microsoft's servers, so they are only used when chosen. */
export function englishVoices(all: SpeechSynthesisVoice[]) {
  const score = (v: SpeechSynthesisVoice) =>
    (v.localService ? 8 : 0) + (/natural|neural|premium|enhanced/i.test(v.name) ? 4 : 0)
    + (v.default ? 1 : 0) + (/^en[-_](GB|US)/i.test(v.lang) ? 1 : 0);
  return all.filter((v) => /^en([-_]|$)/i.test(v.lang))
    .sort((a, b) => score(b) - score(a) || a.name.localeCompare(b.name));
}

/** "Microsoft Aria Online (Natural) - English (United States)" → "Aria (Natural), United States (online)". */
export function voiceLabel(v: SpeechSynthesisVoice) {
  const region = /\(([^)]+)\)\s*$/.exec(v.name.split(" - ")[1] ?? "")?.[1];
  const name = v.name.split(" - ")[0].replace(/^(Microsoft|Google|Apple)\s+/, "").replace(/\s+Online\b/, "");
  return `${region ? `${name}, ${region}` : name}${v.localService ? "" : " (online)"}`;
}

/** Split a long sentence into parts of at most `max` characters, at a comma, semicolon or colon when possible.
 *  Chrome's online voices fall silent after about 15 seconds of one utterance. */
export function speechChunks(text: string, max = 180) {
  const parts: string[] = [];
  let rest = text.trim();
  while (rest.length > max) {
    const head = rest.slice(0, max);
    let cut = Math.max(head.lastIndexOf(", "), head.lastIndexOf("; "), head.lastIndexOf(": "));
    if (cut < max / 3) cut = head.lastIndexOf(" ");
    if (cut <= 0) cut = max - 1;
    parts.push(rest.slice(0, cut + 1).trim());
    rest = rest.slice(cut + 1).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

export interface Speech {
  supported: boolean;
  status: SpeechStatus;
  /** Sentence being read, or where reading resumes. */
  current: number;
  total: number;
  voices: SpeechSynthesisVoice[];
  voice: SpeechSynthesisVoice | null;
  rate: number;
  error: string | null;
  play: (from?: number) => void;
  pause: () => void;
  stop: () => void;
  seek: (index: number) => void;
  setVoice: (voiceURI: string) => void;
  setRate: (rate: number) => void;
}

/** Read `sentences` aloud one by one. Pass a stable array (useMemo): a new one stops the reading. */
export function useSpeech(sentences: string[]): Speech {
  const supported = useMemo(speechSupported, []);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [settings, setSettings] = useState<ListenSettings>(storage.listen);
  const [status, setStatus] = useState<SpeechStatus>("idle");
  const [current, setCurrent] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const run = useRef(0);      // bumped on every start and stop, so events of cancelled utterances are ignored
  const held = useRef<SpeechSynthesisUtterance[]>([]);  // Chrome drops "end" events of collected utterances
  const latest = useRef({ sentences, settings, voices, status, current });
  useLayoutEffect(() => {
    latest.current = { sentences, settings, voices, status, current };
  });

  useEffect(() => {
    if (!supported) return;
    const synth = window.speechSynthesis;
    const update = () => setVoices(englishVoices(synth.getVoices()));
    update();
    synth.addEventListener("voiceschanged", update);
    return () => synth.removeEventListener("voiceschanged", update);
  }, [supported]);

  const silence = useCallback(() => {
    run.current += 1;
    if (supported) window.speechSynthesis.cancel();
  }, [supported]);

  const speakFrom = useCallback((from: number) => {
    if (!supported) return;
    const synth = window.speechSynthesis;
    const id = ++run.current;
    synth.cancel();
    if (synth.paused) synth.resume();
    const { sentences, settings, voices } = latest.current;
    const voice = voices.find((v) => v.voiceURI === settings.voice) ?? voices[0] ?? null;
    const say = (i: number) => {
      if (id !== run.current) return;
      if (i >= sentences.length) {
        setStatus("idle");
        setCurrent(0);
        return;
      }
      setCurrent(i);
      const chunks = speechChunks(sentences[i]);
      held.current = [];
      chunks.forEach((chunk, k) => {
        const u = new SpeechSynthesisUtterance(chunk);
        held.current.push(u);
        u.lang = voice?.lang ?? "en-GB";
        if (voice) u.voice = voice;
        u.rate = settings.rate;
        if (k === chunks.length - 1) u.onend = () => say(i + 1);
        u.onerror = (e) => {
          if (id !== run.current || e.error === "interrupted" || e.error === "canceled") return;
          run.current += 1;
          setStatus("idle");
          setError(e.error === "not-allowed"
            ? "The browser blocked the voice. Press Listen again."
            : "This device's voice could not read the text.");
        };
        synth.speak(u);
      });
    };
    setError(null);
    setStatus("playing");
    say(Math.max(0, Math.min(from, sentences.length - 1)));
  }, [supported]);

  // A new text, or leaving the page, ends the reading.
  useEffect(() => {
    setStatus("idle");
    setCurrent(0);
    return silence;
  }, [sentences, silence]);

  const play = useCallback((from?: number) => speakFrom(from ?? latest.current.current), [speakFrom]);
  const pause = useCallback(() => {
    silence();
    setStatus("paused");
  }, [silence]);
  const stop = useCallback(() => {
    silence();
    setStatus("idle");
    setCurrent(0);
  }, [silence]);
  const seek = useCallback((index: number) => {
    if (latest.current.status === "playing") speakFrom(index);
    else setCurrent(index);
  }, [speakFrom]);
  const change = useCallback((next: ListenSettings) => {
    storage.saveListen(next);
    setSettings(next);
    latest.current.settings = next;
    if (latest.current.status === "playing") speakFrom(latest.current.current);   // restart the sentence
  }, [speakFrom]);
  const setVoice = useCallback((voice: string) => change({ ...latest.current.settings, voice }), [change]);
  const setRate = useCallback((rate: number) => change({ ...latest.current.settings, rate }), [change]);

  const voice = voices.find((v) => v.voiceURI === settings.voice) ?? voices[0] ?? null;
  return {
    supported, status, current, total: sentences.length, voices, voice, rate: settings.rate, error,
    play, pause, stop, seek, setVoice, setRate,
  };
}

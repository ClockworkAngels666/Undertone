import { batches, parseDocumentsCsv, toCsv } from "./csv";
import { assignSlots } from "./colors";
import { fitWords, formatDelta, formatMetric, metricLabel, percent, plural, shortName } from "./format";
import { speakerFlag, speakerName } from "./history";
import { englishVoices, speechChunks, voiceLabel } from "./speech";
import { storage } from "./storage";
import { checkTerms, parseTerms, sameTerms } from "./terms";
import { META } from "../test/fixtures";

describe("format", () => {
  it("formats each metric in its own unit", () => {
    expect(formatMetric("tone_balance", 0.256)).toBe("+0.26");
    expect(formatMetric("tone_balance", -0.5)).toBe("−0.50");
    expect(formatMetric("hostility", 12.345)).toBe("12.3");
    expect(formatMetric("negative_share", 0.375)).toBe("38%");
    expect(formatMetric("kw::NATO", 1.234)).toBe("1.23");
    expect(formatMetric("hostility", null)).toBe("–");
  });

  it("formats differences", () => {
    expect(formatDelta("negative_share", 0.15)).toBe("+15 pts");
    expect(formatDelta("hostility", -2.04)).toBe("−2.0");
    expect(formatDelta("tone_balance", 0.0001)).toBe("0.00");
  });

  it("never rounds a share up to 100%", () => {
    expect(percent(0.9995)).toBe("99%");
  });

  it("counts in the singular and plural", () => {
    expect(plural(1, "sentence")).toBe("1 sentence");
    expect(plural(1990, "sentence")).toBe("1,990 sentences");
    expect(plural(0, "country", "countries")).toBe("0 countries");
  });

  it("shortens long country names", () => {
    expect(shortName("Bosnia and Herzegovina")).toBe("Bosnia and Her.");
    expect(shortName("Viet Nam")).toBe("Viet Nam");
    expect(fitWords("Saint Vincent and the Grenadines", 16)).toBe("Saint Vincent…");
    expect(fitWords("Central African Republic", 16)).toBe("Central African…");
    expect(fitWords("United States", 16)).toBe("United States");
    expect(fitWords("Antidisestablishmentarianism", 10)).toBe("Antidises…");
  });

  it("labels keyword metrics", () => {
    expect(metricLabel("kw::sanction*", META.metrics)).toBe('"sanction…" per 1,000 words');
    expect(metricLabel("hostility", META.metrics)).toBe("Hostile words / 1,000");
  });
});

describe("terms", () => {
  it("parses comma, semicolon and newline separated lists", () => {
    expect(parseTerms("a, b\nc;; d ,")).toEqual(["a", "b", "c", "d"]);
  });

  it("compares lists ignoring case, order and duplicates", () => {
    expect(sameTerms(["War", "peace"], ["peace", "war", "war"])).toBe(true);
    expect(sameTerms(["war"], ["war", "peace"])).toBe(false);
  });

  it("checks limits", () => {
    expect(checkTerms(["ok"])).toBeNull();
    expect(checkTerms(Array(501).fill("x"))).toMatch(/At most 500/);
    expect(checkTerms(["x".repeat(61)])).toMatch(/at most 60 characters/);
  });
});

describe("csv", () => {
  it("parses documents and reports bad rows with their line numbers", () => {
    const csv = "﻿Country,Year,Text,Source\nvnm,2023,\"We welcome dialogue, today.\",VNA\nCHN,abc,Text here today.,\nRUS,2022,,\n";
    const parsed = parseDocumentsCsv(csv);
    expect(parsed.documents).toEqual([
      { country: "VNM", year: 2023, text: "We welcome dialogue, today.", source: "VNA", title: null },
    ]);
    expect(parsed.lines).toEqual([2]);
    expect(parsed.problems).toEqual(['Line 3: "abc" is not a year.', "Line 4: the text is empty."]);
  });

  it("reports missing columns", () => {
    expect(parseDocumentsCsv("country,text\nVNM,hello").problems[0]).toMatch(/Missing column: year/);
  });

  it("splits uploads by count and by size", () => {
    const items = Array.from({ length: 5 }, (_, i) => ({ text: "x".repeat(i === 2 ? 1000 : 10) }));
    expect(batches(items, 2).map((b) => b.length)).toEqual([2, 2, 1]);
    expect(batches(items, 10, 1100).map((b) => b.length)).toEqual([2, 1, 2]);   // the big one goes alone
  });

  it("neutralises spreadsheet formulas in exports", () => {
    const out = toCsv([{ a: "=SUM(1)", b: 2 }], ["a", "b"]);
    expect(out.startsWith("﻿")).toBe(true);
    expect(out).toContain("'=SUM(1)");
  });
});

describe("colours", () => {
  it("keeps each country's colour slot when others are removed or added", () => {
    let slots = assignSlots({}, ["RUS", "USA", "CHN"]);
    expect(slots).toEqual({ RUS: 0, USA: 1, CHN: 2 });
    slots = assignSlots(slots, ["RUS", "CHN"]);
    expect(slots).toEqual({ RUS: 0, CHN: 2 });
    slots = assignSlots(slots, ["RUS", "CHN", "VNM"]);
    expect(slots).toEqual({ RUS: 0, CHN: 2, VNM: 1 });
  });
});

describe("storage", () => {
  it("remembers datasets newest first and forgets them", () => {
    storage.saveDataset({ id: "a", name: "A", token: "t1", createdAt: "2026-01-01" });
    storage.saveDataset({ id: "b", name: "B", token: "t2", createdAt: "2026-01-02" });
    expect(storage.datasets().map((d) => d.id)).toEqual(["b", "a"]);
    expect(storage.token("a")).toBe("t1");
    storage.forgetDataset("a");
    expect(storage.datasets().map((d) => d.id)).toEqual(["b"]);
  });

  it("survives corrupt stored data", () => {
    window.localStorage.setItem("dla.datasets.v1", "{not json");
    expect(storage.datasets()).toEqual([]);
  });
});

describe("speech", () => {
  const voice = (name: string, lang: string, isDefault = false, localService = true) =>
    ({ name, lang, default: isDefault, voiceURI: name, localService }) as SpeechSynthesisVoice;

  it("splits long sentences at commas, never mid-word, and keeps short ones whole", () => {
    expect(speechChunks("We welcome dialogue.")).toEqual(["We welcome dialogue."]);
    const long = `${"word ".repeat(30)}and so, ${"more ".repeat(30)}end.`;
    const chunks = speechChunks(long, 180);
    expect(chunks.every((c) => c.length <= 180)).toBe(true);
    expect(chunks.join(" ").replace(/\s+/g, " ")).toBe(long.replace(/\s+/g, " ").trim());
    expect(chunks[0].endsWith("so,")).toBe(true);
  });

  it("keeps English voices only: on the device first, natural ones before plain ones, online ones last", () => {
    const voices = englishVoices([voice("Microsoft David - English (United States)", "en-US", true),
      voice("Microsoft Hortense - French (France)", "fr-FR"),
      voice("Microsoft Aria Online (Natural) - English (United States)", "en-US", false, false),
      voice("Daniel (Enhanced)", "en-GB")]);
    expect(voices.map((v) => v.name.split(" ")[0])).toEqual(["Daniel", "Microsoft", "Microsoft"]);
    expect(voices[2].name).toContain("Aria");
    expect(voiceLabel(voices[2])).toBe("Aria (Natural), United States (online)");
    expect(voiceLabel(voices[1])).toBe("David, United States");
  });

  it("remembers the voice and speed, and ignores nonsense", () => {
    storage.saveListen({ voice: "Aria", rate: 1.5 });
    expect(storage.listen()).toEqual({ voice: "Aria", rate: 1.5 });
    window.localStorage.setItem("dla.listen.v1", JSON.stringify({ voice: 3, rate: 40 }));
    expect(storage.listen()).toEqual({ voice: null, rate: 1 });
  });
});

describe("history", () => {
  it("names the delegation that held the seat that year", () => {
    expect(speakerName("RUS", 1960, "Russia")).toBe("Soviet Union");
    expect(speakerName("RUS", 1991, "Russia")).toBe("Soviet Union");
    expect(speakerName("RUS", 1992, "Russia")).toBe("Russia");
    expect(speakerFlag("RUS", 1960)).toBe("USSR");
    expect(speakerName("CHN", 1971, "China")).toBe("Republic of China");
    expect(speakerFlag("CHN", 1960)).toBe("TWN");
    expect(speakerFlag("CHN", 1972)).toBe("CHN");
    expect(speakerName("VNM", 1960, "Vietnam")).toBe("Vietnam");
  });
});

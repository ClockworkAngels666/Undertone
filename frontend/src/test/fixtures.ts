import type { AnalyzeResult, Meta } from "../api/types";

export const META: Meta = {
  version: "1.0.0",
  metrics: [
    { id: "tone_balance", label: "Tone balance", explanation: "−1 = fully confrontational, +1 = fully conciliatory", higher_is_worse: false },
    { id: "hostility", label: "Hostile words / 1,000", explanation: "Hostile dictionary words per 1,000 words", higher_is_worse: true },
    { id: "cooperation", label: "Cooperative words / 1,000", explanation: "Cooperative dictionary words per 1,000 words", higher_is_worse: false },
    { id: "vader_mean", label: "Avg sentiment (VADER)", explanation: "Mean VADER compound score per sentence", higher_is_worse: false },
    { id: "negative_share", label: "Share of negative sentences", explanation: "Share of sentences with VADER ≤ −0.05", higher_is_worse: true },
  ],
  default_dictionaries: { hostile: ["sanction*", "war"], cooperative: ["dialogue", "cooperat*"] },
  default_keywords: ["NATO"],
  events: [{ year: 2014, label: "Crimea" }],
  limits: {
    max_text_chars: 200000,
    max_upload_bytes: 4000000,
    max_batch_documents: 100,
    max_dataset_documents: 5000,
    max_chart_countries: 8,
    max_terms: 500,
  },
  context_model: { available: false, name: null },
  citation: "Jankin, Baturo & Dasandi (2024).",
};

export const RESULT: AnalyzeResult = {
  counts: { words: 12, sentences: 2, hostile_hits: 1, coop_hits: 2, vader_sum: 0.2, negative_sentences: 1 },
  metrics: { tone_balance: 0.333, hostility: 83.3, cooperation: 166.7, vader_mean: 0.1, negative_share: 0.5 },
  default_dictionaries: true,
  baseline: {
    first_year: 2016,
    last_year: 2025,
    statements: 1935,
    averages: { tone_balance: 0.2, hostility: 7.0, cooperation: 11.0, vader_mean: 0.2, negative_share: 0.25 },
    hostility_share_below: 0.876,
  },
  highlights: [[7, 16, "hostile"], [33, 41, "cooperative"]],
  top_terms: { hostile: [["sanctions", 1]], cooperative: [["dialogue", 1], ["cooperation", 1]] },
  sentences: [
    { index: 0, sentence: "We reject sanctions as bad policy.", vader: -0.5, hostile_hits: 1, coop_hits: 0, context: null },
    { index: 1, sentence: "We welcome dialogue and cooperation.", vader: 0.7, hostile_hits: 0, coop_hits: 2, context: null },
  ],
  context_model: { available: false, used: false, name: null },
  warnings: [],
};

/** Replace window.fetch with a router of canned JSON responses. */
export function mockFetch(routes: Record<string, (init?: RequestInit) => { status?: number; body?: unknown }>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const key = Object.keys(routes).find((k) => url.startsWith(k));
    if (!key) return new Response(JSON.stringify({ detail: `No mock for ${url}` }), { status: 404 });
    const { status = 200, body } = routes[key](init);
    return new Response(status === 204 ? null : JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

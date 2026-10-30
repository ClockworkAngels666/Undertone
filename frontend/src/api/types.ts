// Shapes returned by the FastAPI backend (see /api/docs).

export type MetricId = string; // "tone_balance" | "hostility" | ... | "kw::<keyword>"
export type Metrics = Record<string, number | null>;
export type Span = [start: number, end: number, kind: "hostile" | "cooperative"];

export interface Counts {
  words: number;
  sentences: number;
  hostile_hits: number;
  coop_hits: number;
  vader_sum: number;
  negative_sentences: number;
}

export interface MetricInfo {
  id: string;
  label: string;
  explanation: string;
  higher_is_worse: boolean;
}

export interface Meta {
  version: string;
  metrics: MetricInfo[];
  default_dictionaries: { hostile: string[]; cooperative: string[] };
  default_keywords: string[];
  events: { year: number; label: string }[];
  limits: {
    max_text_chars: number;
    max_upload_bytes: number;
    max_batch_documents: number;
    max_dataset_documents: number;
    max_chart_countries: number;
    max_terms: number;
    short_text_words: number;
  };
  context_model: { available: boolean; name: string | null };
  citation: string;
}

export interface SentenceScore {
  index: number;
  sentence: string;
  vader: number;
  hostile_hits: number;
  coop_hits: number;
  context: { label: "hostile" | "cooperative" | "neutral"; score: number } | null;
}

export interface AnalyzeResult {
  counts: Counts;
  metrics: Metrics;
  default_dictionaries: boolean;
  baseline: {
    first_year: number;
    last_year: number;
    statements: number;
    averages: Metrics;
    median_words: number | null;
    hostility_share_below: number | null;
    cooperation_share_below: number | null;
  } | null;
  highlights: Span[];
  reading: Reading;
  top_terms: { hostile: [string, number][]; cooperative: [string, number][] };
  sentences: SentenceScore[];
  context_model: { available: boolean; used: boolean; name: string | null };
  warnings: string[];
}

export interface ExtractedText {
  filename: string;
  text: string;
  characters: number;
  pages: number | null;
  truncated: boolean;
}

export interface CountryInfo {
  code: string;
  name: string;
  first_year: number;
  last_year: number;
  statements: number;
}

export interface UNSummary {
  loaded: boolean;
  demo: boolean;
  statements: number;
  first_year: number | null;
  last_year: number | null;
  countries: CountryInfo[];
  keywords: string[];
  loaded_at: string | null;
}

export interface Point {
  year: number;
  value: number | null;
}

export interface SeriesResponse {
  metric: string;
  series: { country: string; name: string; points: Point[] }[];
  average: Point[] | null;
}

/** One metric for every country and year: values[code][i] belongs to years[i] (null = no statement). */
export interface Matrix {
  metric: string;
  years: number[];
  countries: { code: string; name: string }[];
  values: Record<string, (number | null)[]>;
}

export interface Shift {
  country: string;
  name: string;
  from_year: number;
  year: number;
  from_value: number;
  value: number;
  change: number;
}

export interface Ranking {
  year: number;
  metric: string;
  rows: { rank: number; country: string; name: string; value: number }[];
}

export interface NotableSentence {
  kind: "hostile" | "negative" | "cooperative";
  score: number;
  position: number;
  sentence: string;
  highlights: Span[];
}

export interface Statement {
  country: string;
  name: string;
  year: number;
  session: number;
  counts: Counts;
  metrics: Metrics;
  keywords: Record<string, number | null>;
  sentences: NotableSentence[];
}

/** One piece of a text in reading order. `index` is the scored sentence's number (null for short pieces). */
export interface ReadingSentence {
  text: string;
  index: number | null;
  highlights: Span[];
}

/** A whole text as paragraphs of sentences. */
export type Reading = ReadingSentence[][];

export interface StatementText {
  country: string;
  year: number;
  reading: Reading;
}

export interface Dataset {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  keywords: string[];
  hostile_terms: string[];
  coop_terms: string[];
  uses_default_dictionaries: boolean;
  documents: number;
  countries: string[];
  first_year: number | null;
  last_year: number | null;
  stale_documents: number;
}

export interface DocumentIn {
  country: string;
  year: number;
  text: string;
  source?: string | null;
  title?: string | null;
}

export interface BatchResult {
  added: number;
  skipped: { row: number; reason: string }[];
  total_documents: number;
}

export type YearlyRow = Counts & {
  country: string;
  name: string;
  year: number;
  documents: number;
} & Record<string, number | string | null>;

export interface DocumentSummary {
  id: number;
  country: string;
  year: number;
  source: string | null;
  title: string | null;
  preview: string;
  counts: Counts;
  metrics: Metrics;
}

export interface Health {
  status: string;
  database: string;
  un_data: { statements: number; countries: number; first_year: number; last_year: number; source: string } | null;
  version: string;
}

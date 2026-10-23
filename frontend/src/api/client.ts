import type {
  AnalyzeResult,
  BatchResult,
  Dataset,
  DocumentIn,
  DocumentSummary,
  ExtractedText,
  Health,
  Matrix,
  Meta,
  Ranking,
  SeriesResponse,
  Shift,
  Statement,
  UNSummary,
  YearlyRow,
} from "./types";

/** An error with a message that can be shown to the user as-is. */
export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ApiError";
  }
}

const OFFLINE = "Can't reach the server. Check your connection and try again.";

async function request<T>(path: string, init: RequestInit & { token?: string } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
  if (init.token) headers.set("X-Edit-Token", init.token);
  let response: Response;
  try {
    response = await fetch(`/api${path}`, { ...init, headers });
  } catch {
    throw new ApiError(OFFLINE, 0);
  }
  if (!response.ok) throw new ApiError(await errorMessage(response), response.status);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const body = await response.json();
    if (typeof body?.detail === "string") return body.detail;
  } catch {
    // not JSON (for example a proxy error page)
  }
  if (response.status === 413) return "That is too large to upload.";
  if (response.status >= 500) return "The server had a problem. Please try again in a minute.";
  return `Request failed (${response.status}).`;
}

function query(params: Record<string, string | number | boolean | undefined | null>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") search.set(key, String(value));
  }
  const s = search.toString();
  return s ? `?${s}` : "";
}

/** Retry while the server is unreachable or starting up (cold starts, local dev boot). */
export async function withRetry<T>(load: () => Promise<T>, attempts = 4, delayMs = 800): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await load();
    } catch (err) {
      const retryable = err instanceof ApiError && (err.status === 0 || err.status >= 500);
      if (!retryable || i >= attempts) throw err;
      await new Promise((resolve) => setTimeout(resolve, delayMs * i));
    }
  }
}

export interface Dictionaries {
  hostile_terms?: string[];
  coop_terms?: string[];
}

export const api = {
  health: () => request<Health>("/health"),
  meta: () => request<Meta>("/meta"),

  analyze: (text: string, dictionaries: Dictionaries = {}, contextModel = false) =>
    request<AnalyzeResult>("/analyze", {
      method: "POST",
      body: JSON.stringify({ text, ...dictionaries, context_model: contextModel }),
    }),

  extractText: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<ExtractedText>("/extract-text", { method: "POST", body: form });
  },

  un: {
    summary: () => request<UNSummary>("/un/summary"),
    series: (p: { countries: string[]; metric: string; start?: number; end?: number; average?: boolean }) =>
      request<SeriesResponse>(
        `/un/series${query({ countries: p.countries.join(","), metric: p.metric, start: p.start, end: p.end, average: p.average })}`,
      ),
    matrix: (metric: string) => request<Matrix>(`/un/matrix${query({ metric })}`),
    shifts: (p: { countries: string[]; metric: string; start?: number; end?: number; n?: number }) =>
      request<Shift[]>(
        `/un/shifts${query({ countries: p.countries.join(","), metric: p.metric, start: p.start, end: p.end, n: p.n })}`,
      ),
    statement: (country: string, year: number) =>
      request<Statement>(`/un/statements/${encodeURIComponent(country)}/${year}`),
    ranking: (year: number, metric: string) => request<Ranking>(`/un/ranking${query({ year, metric })}`),
    exportUrl: (p: { countries?: string[]; start?: number; end?: number }) =>
      `/api/un/export.csv${query({ countries: p.countries?.join(","), start: p.start, end: p.end })}`,
  },

  datasets: {
    create: (body: { name: string; keywords: string[] } & Dictionaries) =>
      request<{ dataset: Dataset; edit_token: string }>("/datasets", { method: "POST", body: JSON.stringify(body) }),
    get: (id: string) => request<Dataset>(`/datasets/${encodeURIComponent(id)}`),
    remove: (id: string, token: string) =>
      request<void>(`/datasets/${encodeURIComponent(id)}`, { method: "DELETE", token }),
    addDocuments: (id: string, token: string, documents: DocumentIn[]) =>
      request<BatchResult>(`/datasets/${encodeURIComponent(id)}/documents`, {
        method: "POST",
        token,
        body: JSON.stringify({ documents }),
      }),
    documents: (id: string, offset = 0, limit = 50) =>
      request<{ total: number; items: DocumentSummary[] }>(
        `/datasets/${encodeURIComponent(id)}/documents${query({ offset, limit })}`,
      ),
    removeDocument: (id: string, token: string, documentId: number) =>
      request<void>(`/datasets/${encodeURIComponent(id)}/documents/${documentId}`, { method: "DELETE", token }),
    yearly: (id: string) =>
      request<{ keywords: string[]; rows: YearlyRow[] }>(`/datasets/${encodeURIComponent(id)}/yearly`),
    rescore: (id: string, token: string, body?: Dictionaries & { keywords?: string[] }) =>
      request<{ rescored: number; remaining: number }>(`/datasets/${encodeURIComponent(id)}/rescore`, {
        method: "POST",
        token,
        body: body ? JSON.stringify(body) : undefined,
      }),
    exportUrl: (id: string, level: "yearly" | "documents") =>
      `/api/datasets/${encodeURIComponent(id)}/export.csv${query({ level })}`,
  },
};

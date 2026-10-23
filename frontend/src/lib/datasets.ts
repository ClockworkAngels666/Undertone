import { api } from "../api/client";
import type { DocumentIn } from "../api/types";
import { batches } from "./csv";
import { storage } from "./storage";

/** Create a dataset and remember its edit token in this browser. */
export async function createDataset(name: string, keywords: string[], custom: { hostile: string[]; cooperative: string[] } | null) {
  const { dataset, edit_token } = await api.datasets.create({
    name,
    keywords,
    ...(custom ? { hostile_terms: custom.hostile, coop_terms: custom.cooperative } : {}),
  });
  storage.saveDataset({ id: dataset.id, name: dataset.name, token: edit_token, createdAt: dataset.created_at });
  return { dataset, token: edit_token };
}

export interface UploadProgress {
  sent: number;
  total: number;
  added: number;
  skipped: { line: number; reason: string }[];
}

/**
 * Upload documents in small batches (the server and Vercel cap request sizes), reporting progress.
 * `lines` maps each document to its CSV line number so problems can be reported precisely.
 */
export async function uploadDocuments(id: string, token: string, documents: DocumentIn[], lines: number[],
  batchSize: number, onProgress: (p: UploadProgress) => void): Promise<UploadProgress> {
  const indexed = documents.map((d, i) => ({ ...d, line: lines[i] ?? i + 2 }));
  const progress: UploadProgress = { sent: 0, total: documents.length, added: 0, skipped: [] };
  for (const batch of batches(indexed, batchSize)) {
    const result = await api.datasets.addDocuments(id, token, batch.map(({ line: _line, ...doc }) => doc));
    progress.added += result.added;
    for (const s of result.skipped) progress.skipped.push({ line: batch[s.row]?.line ?? 0, reason: s.reason });
    progress.sent += batch.length;
    onProgress({ ...progress, skipped: [...progress.skipped] });
  }
  return progress;
}

/** Rescore out-of-date texts in batches until none are left. */
export async function rescoreAll(id: string, token: string, change: Parameters<typeof api.datasets.rescore>[2],
  onProgress: (done: number, remaining: number) => void) {
  let done = 0;
  let result = await api.datasets.rescore(id, token, change);
  done += result.rescored;
  onProgress(done, result.remaining);
  while (result.remaining > 0) {
    result = await api.datasets.rescore(id, token);
    done += result.rescored;
    onProgress(done, result.remaining);
    if (result.rescored === 0) break;
  }
  return done;
}

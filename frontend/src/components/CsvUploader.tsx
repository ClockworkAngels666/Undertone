import { useId, useState, type ReactNode } from "react";
import { downloadText, parseDocumentsCsv, SAMPLE_CSV, type ParsedCsv } from "../lib/csv";
import type { UploadProgress } from "../lib/datasets";
import { errorText, useMeta } from "../lib/hooks";
import { Notice } from "./common";

const MAX_CSV_BYTES = 25_000_000;

/**
 * Pick a CSV (country, year, text [, source, title]), check it in the browser, then upload it in batches.
 * `children` renders extra fields (dataset name, keywords) next to the submit button.
 */
export default function CsvUploader({ submitLabel, onSubmit, onFileName, children }: {
  submitLabel: string;
  onSubmit: (parsed: ParsedCsv, progress: (p: UploadProgress) => void) => Promise<UploadProgress>;
  onFileName?: (name: string) => void;
  children?: ReactNode;
}) {
  const meta = useMeta();
  const id = useId();
  const [parsed, setParsed] = useState<ParsedCsv | null>(null);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<UploadProgress | null>(null);

  const onFile = async (file: File | undefined) => {
    setParsed(null);
    setError(null);
    setDone(null);
    if (!file) return;
    if (file.size > MAX_CSV_BYTES) {
      setError(`That file is larger than ${MAX_CSV_BYTES / 1_000_000} MB. Split it into smaller files.`);
      return;
    }
    try {
      const result = parseDocumentsCsv(await file.text());
      if (result.documents.length > meta.limits.max_dataset_documents) {
        setError(`A dataset can hold at most ${meta.limits.max_dataset_documents.toLocaleString()} texts; ` +
          `this file has ${result.documents.length.toLocaleString()}.`);
        return;
      }
      setParsed(result);
      setFileName(file.name);
      onFileName?.(file.name.replace(/\.csv$/i, ""));
    } catch (err) {
      setError(`Could not read this file: ${errorText(err)}`);
    }
  };

  const submit = async () => {
    if (!parsed?.documents.length) return;
    setBusy(true);
    setError(null);
    setProgress({ sent: 0, total: parsed.documents.length, added: 0, skipped: [] });
    try {
      setDone(await onSubmit(parsed, setProgress));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const countries = parsed ? new Set(parsed.documents.map((d) => d.country)).size : 0;
  const years = parsed?.documents.map((d) => d.year) ?? [];

  return (
    <div className="stack">
      <p className="small muted">
        A CSV with the columns <strong>country</strong> (code such as VNM), <strong>year</strong> and{" "}
        <strong>text</strong> (full English text), plus optional <strong>source</strong> and <strong>title</strong>.
        Several texts per country and year are added up.{" "}
        <button type="button" className="btn link small" onClick={() => downloadText("sample_data.csv", SAMPLE_CSV)}>
          Download a sample CSV
        </button>
      </p>
      <div className="field">
        <label htmlFor={id}>CSV file</label>
        <input id={id} type="file" accept=".csv,text/csv" className="file-input" disabled={busy}
          onChange={(e) => void onFile(e.target.files?.[0])} />
      </div>
      {parsed && (
        <Notice kind={parsed.problems.length ? "warn" : "info"}>
          <strong>{fileName}</strong>: {parsed.documents.length.toLocaleString()} texts from {countries}{" "}
          {countries === 1 ? "country" : "countries"}
          {years.length ? `, ${Math.min(...years)}–${Math.max(...years)}` : ""}.
          {parsed.problems.length > 0 && (
            <ul>
              {parsed.problems.slice(0, 8).map((p) => <li key={p}>{p}</li>)}
              {parsed.problems.length > 8 && <li>…and {parsed.problems.length - 8} more.</li>}
            </ul>
          )}
        </Notice>
      )}
      {children}
      <div className="row">
        <button type="button" className="btn primary" disabled={busy || !parsed?.documents.length} onClick={() => void submit()}>
          {busy ? "Uploading…" : submitLabel}
        </button>
      </div>
      {progress && busy && (
        <div>
          <progress max={progress.total} value={progress.sent} aria-label="Upload progress" />
          <p className="small muted">Scored {progress.sent.toLocaleString()} of {progress.total.toLocaleString()} texts…</p>
        </div>
      )}
      {error && <Notice kind="error">{error}</Notice>}
      {done && (
        <Notice kind={done.skipped.length ? "warn" : "info"}>
          Added {done.added.toLocaleString()} texts.
          {done.skipped.length > 0 && (
            <>
              {" "}Skipped {done.skipped.length}:
              <ul>
                {done.skipped.slice(0, 8).map((s) => <li key={`${s.line}-${s.reason}`}>Line {s.line}: {s.reason}</li>)}
                {done.skipped.length > 8 && <li>…and {done.skipped.length - 8} more.</li>}
              </ul>
            </>
          )}
        </Notice>
      )}
    </div>
  );
}

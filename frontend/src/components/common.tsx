import type { ReactNode } from "react";
import type { Span } from "../api/types";

export function Notice({ kind = "info", children, onRetry, action }: {
  kind?: "info" | "warn" | "error"; children: ReactNode; onRetry?: () => void;
  /** A button that acts on what the notice reports, such as Undo. */
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className={`notice ${kind}`} role={kind === "error" ? "alert" : "status"}>
      <div>{children}</div>
      {onRetry && <button type="button" className="btn small" onClick={onRetry}>Try again</button>}
      {action && <button type="button" className="btn small" onClick={action.onClick}>{action.label}</button>}
    </div>
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return <p className="muted" role="status" aria-live="polite">{label}</p>;
}

export function Limitations() {
  return (
    <p className="limitations">
      Word counts ignore context ("we do not seek confrontation" still counts one hostile word), VADER was built for
      social media, texts must be in English, and tone is not policy. Read the sentences before trusting a number.
    </p>
  );
}

/** Text with dictionary hits highlighted, built from [start, end, kind] spans (never from HTML). */
export function HighlightedText({ text, spans }: { text: string; spans: Span[] }) {
  const parts: ReactNode[] = [];
  let pos = 0;
  spans.forEach(([start, end, kind], i) => {
    if (start < pos) return;
    if (start > pos) parts.push(text.slice(pos, start));
    parts.push(<mark key={i} className={kind} title={kind === "hostile" ? "Hostile word" : "Cooperative word"}>
      {text.slice(start, end)}</mark>);
    pos = end;
  });
  parts.push(text.slice(pos));
  return <>{parts}</>;
}

export function HighlightKeys() {
  return (
    <div className="legend-keys" aria-hidden="true">
      <span className="key hostile">hostile</span>
      <span className="key cooperative">cooperative</span>
    </div>
  );
}

export function DownloadLink({ href, children }: { href: string; children: ReactNode }) {
  return <a className="btn small" href={href} download>{children}</a>;
}

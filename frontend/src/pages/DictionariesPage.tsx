import { useState } from "react";
import { useSearchParams } from "react-router";
import { Notice } from "../components/common";
import TermCounts from "../components/TermCounts";
import { useDictionaries, useDocumentTitle, useMeta } from "../lib/hooks";
import { storage } from "../lib/storage";
import { checkTerms, joinTerms, parseTerms, sameTerms } from "../lib/terms";

const TABS = [["edit", "Word lists"], ["counts", "How often they occur"]] as const;

export default function DictionariesPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get("v") === "counts" ? "counts" : "edit";
  const choose = (next: typeof tab) => setParams(next === "edit" ? {} : { v: next }, { replace: true });
  useDocumentTitle(tab === "counts" ? "How often they occur · Dictionaries" : "Dictionaries");
  const meta = useMeta();
  const current = useDictionaries();
  const [hostile, setHostile] = useState(joinTerms(current.hostile));
  const [cooperative, setCooperative] = useState(joinTerms(current.cooperative));
  const [message, setMessage] = useState<{ kind: "info" | "error"; text: string } | null>(null);
  // What Reset replaced: the lists on screen and what was saved, so Undo can put both back
  const [undo, setUndo] = useState<{ hostile: string; cooperative: string; saved: typeof current.custom } | null>(null);

  const hostileTerms = parseTerms(hostile);
  const coopTerms = parseTerms(cooperative);
  const problem = checkTerms(hostileTerms, meta.limits.max_terms) ?? checkTerms(coopTerms, meta.limits.max_terms);
  const isDefault = sameTerms(hostileTerms, meta.default_dictionaries.hostile)
    && sameTerms(coopTerms, meta.default_dictionaries.cooperative);

  const save = () => {
    setUndo(null);
    if (problem) return setMessage({ kind: "error", text: problem });
    const ok = storage.saveDictionaries(isDefault ? null : { hostile: hostileTerms, cooperative: coopTerms });
    setMessage(ok ? { kind: "info", text: isDefault ? "Using the default dictionaries." : "Saved in this browser." }
      : { kind: "error", text: "Your browser blocked saving (private mode?)." });
  };

  const reset = () => {
    setUndo({ hostile, cooperative, saved: current.custom });
    setHostile(joinTerms(meta.default_dictionaries.hostile));
    setCooperative(joinTerms(meta.default_dictionaries.cooperative));
    storage.saveDictionaries(null);
    setMessage(null);
  };

  const undoReset = () => {
    if (!undo) return;
    setHostile(undo.hostile);
    setCooperative(undo.cooperative);
    storage.saveDictionaries(undo.saved);
    setUndo(null);
    setMessage({ kind: "info", text: "Your lists are back." });
  };

  return (
    <>
      <div className="page-intro">
        <h1>Dictionaries</h1>
        <p>
          The word lists behind the hostility and cooperation scores. Adapt them to your research question: separate
          terms with commas or new lines, and end a term with * to match any ending (sanction* → sanctions,
          sanctioned).
        </p>
      </div>
      <div className="view-tabs" role="tablist" aria-label="Dictionaries" onKeyDown={(e) => {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        const next = tab === "edit" ? "counts" : "edit";
        choose(next);
        document.getElementById(`dict-tab-${next}`)?.focus();
      }}>
        {TABS.map(([key, text]) => (
          <button key={key} id={`dict-tab-${key}`} type="button" role="tab" aria-selected={tab === key}
            aria-controls="dict-panel" tabIndex={tab === key ? 0 : -1} onClick={() => choose(key)}>{text}</button>
        ))}
      </div>
      <div id="dict-panel" role="tabpanel" aria-labelledby={`dict-tab-${tab}`}>
        {tab === "counts" ? <TermCounts /> : (
          <>
            <Notice kind={current.custom ? "warn" : "info"}>
              {current.custom
                ? "You are using custom dictionaries. Texts are then not compared with UN speeches, which were scored with the defaults."
                : "You are using the default dictionaries."}
            </Notice>
            <div className="grid-2" style={{ gridTemplateColumns: "1fr 1fr" }}>
              <div className="card">
                <div className="field">
                  <label htmlFor="hostile-terms">Hostile words <span className="hint">({hostileTerms.length})</span></label>
                  <textarea id="hostile-terms" rows={14} value={hostile} onChange={(e) => setHostile(e.target.value)} />
                </div>
              </div>
              <div className="card">
                <div className="field">
                  <label htmlFor="coop-terms">Cooperative words <span className="hint">({coopTerms.length})</span></label>
                  <textarea id="coop-terms" rows={14} value={cooperative} onChange={(e) => setCooperative(e.target.value)} />
                </div>
              </div>
            </div>
            <div className="row">
              <button type="button" className="btn primary" onClick={save}>Save dictionaries</button>
              <button type="button" className="btn" onClick={reset} disabled={isDefault && !current.custom}>
                Reset to default
              </button>
            </div>
            {undo && (
              <div style={{ marginTop: 12 }}>
                <Notice kind="info" action={{ label: "Undo", onClick: undoReset }}>Back to the default dictionaries.</Notice>
              </div>
            )}
            {problem && <Notice kind="error">{problem}</Notice>}
            {message && <div style={{ marginTop: 12 }}><Notice kind={message.kind}>{message.text}</Notice></div>}
          </>
        )}
      </div>
    </>
  );
}

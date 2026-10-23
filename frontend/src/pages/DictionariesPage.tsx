import { useState } from "react";
import { Notice } from "../components/common";
import { useDictionaries, useDocumentTitle, useMeta } from "../lib/hooks";
import { storage } from "../lib/storage";
import { checkTerms, joinTerms, parseTerms, sameTerms } from "../lib/terms";

export default function DictionariesPage() {
  useDocumentTitle("Dictionaries");
  const meta = useMeta();
  const current = useDictionaries();
  const [hostile, setHostile] = useState(joinTerms(current.hostile));
  const [cooperative, setCooperative] = useState(joinTerms(current.cooperative));
  const [message, setMessage] = useState<{ kind: "info" | "error"; text: string } | null>(null);

  const hostileTerms = parseTerms(hostile);
  const coopTerms = parseTerms(cooperative);
  const problem = checkTerms(hostileTerms, meta.limits.max_terms) ?? checkTerms(coopTerms, meta.limits.max_terms);
  const isDefault = sameTerms(hostileTerms, meta.default_dictionaries.hostile)
    && sameTerms(coopTerms, meta.default_dictionaries.cooperative);

  const save = () => {
    if (problem) return setMessage({ kind: "error", text: problem });
    const ok = storage.saveDictionaries(isDefault ? null : { hostile: hostileTerms, cooperative: coopTerms });
    setMessage(ok ? { kind: "info", text: isDefault ? "Using the default dictionaries." : "Saved in this browser." }
      : { kind: "error", text: "Your browser blocked saving (private mode?)." });
  };

  const reset = () => {
    setHostile(joinTerms(meta.default_dictionaries.hostile));
    setCooperative(joinTerms(meta.default_dictionaries.cooperative));
    storage.saveDictionaries(null);
    setMessage({ kind: "info", text: "Back to the default dictionaries." });
  };

  return (
    <>
      <div className="page-intro">
        <p className="eyebrow">Method settings</p>
        <h1>Dictionaries</h1>
        <p>
          The word lists behind the hostility and cooperation scores. Adapt them to your research question: separate
          terms with commas or new lines, and end a term with * to match any ending (sanction* → sanctions,
          sanctioned).
        </p>
      </div>
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
        <button type="button" className="btn" onClick={reset}>Reset to default</button>
      </div>
      {problem && <Notice kind="error">{problem}</Notice>}
      {message && <div style={{ marginTop: 12 }}><Notice kind={message.kind}>{message.text}</Notice></div>}
    </>
  );
}

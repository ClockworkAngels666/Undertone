import { useId, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { api } from "../api/client";
import { createDataset } from "../lib/datasets";
import { errorText, useDictionaries, useMeta, useSavedDatasets } from "../lib/hooks";
import { Notice } from "./common";

const NEW = "__new";

/** Store the analyzed text in one of the visitor's datasets, so it can be compared over time. */
export default function SaveToDataset({ text }: { text: string }) {
  const meta = useMeta();
  const dictionaries = useDictionaries();
  const saved = useSavedDatasets();
  const id = useId();
  const [target, setTarget] = useState<string>(saved[0]?.id ?? NEW);
  const [name, setName] = useState("My texts");
  const [country, setCountry] = useState("");
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [title, setTitle] = useState("");
  const [source, setSource] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ id: string; name: string } | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setDone(null);
    if (!/^[A-Za-z]{2,8}$/.test(country.trim())) {
      setError("Enter a country code such as VNM, CHN or USA.");
      return;
    }
    setBusy(true);
    try {
      let datasetId = target;
      let datasetName = saved.find((d) => d.id === target)?.name ?? name;
      let token = saved.find((d) => d.id === target)?.token;
      if (target === NEW || !token) {
        const created = await createDataset(name.trim() || "My texts", meta.default_keywords, dictionaries.custom);
        datasetId = created.dataset.id;
        datasetName = created.dataset.name;
        token = created.token;
        setTarget(datasetId);
      }
      const result = await api.datasets.addDocuments(datasetId, token, [{
        country: country.trim().toUpperCase(), year: Number(year), text, title: title || null, source: source || null,
      }]);
      if (result.added === 0) throw new Error(result.skipped[0]?.reason ?? "The text was not saved.");
      setDone({ id: datasetId, name: datasetName });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="card stack" onSubmit={submit} aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>Save to a dataset</h2>
      <p className="muted small">
        Keep this text to compare it with others over time. Anyone with the dataset’s link can read it, so do not
        save confidential material.
      </p>
      <div className="row">
        <div className="field">
          <label htmlFor={`${id}-target`}>Dataset</label>
          <select id={`${id}-target`} value={target} onChange={(e) => setTarget(e.target.value)}>
            {saved.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            <option value={NEW}>New dataset…</option>
          </select>
        </div>
        {target === NEW && (
          <div className="field">
            <label htmlFor={`${id}-name`}>New dataset name</label>
            <input id={`${id}-name`} type="text" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
          </div>
        )}
        <div className="field">
          <label htmlFor={`${id}-country`}>Country code</label>
          <input id={`${id}-country`} type="text" value={country} placeholder="VNM" maxLength={8} style={{ width: "7rem" }}
            onChange={(e) => setCountry(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor={`${id}-year`}>Year</label>
          <input id={`${id}-year`} type="number" value={year} min={1800} max={2100} onChange={(e) => setYear(e.target.value)} />
        </div>
        <div className="field" style={{ flex: "1 1 200px" }}>
          <label htmlFor={`${id}-title-input`}>Title <span className="hint">(optional)</span></label>
          <input id={`${id}-title-input`} type="text" value={title} maxLength={300} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="field" style={{ flex: "1 1 200px" }}>
          <label htmlFor={`${id}-source`}>Source <span className="hint">(optional)</span></label>
          <input id={`${id}-source`} type="text" value={source} maxLength={200} onChange={(e) => setSource(e.target.value)} />
        </div>
      </div>
      <div className="row">
        <button type="submit" className="btn primary" disabled={busy}>{busy ? "Saving…" : "Save text"}</button>
      </div>
      {error && <Notice kind="error">{error}</Notice>}
      {done && (
        <Notice kind="info">
          Saved to <Link to={`/datasets/${done.id}`}>{done.name}</Link>.
        </Notice>
      )}
    </form>
  );
}

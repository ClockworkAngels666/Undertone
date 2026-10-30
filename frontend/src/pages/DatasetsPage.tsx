import { useState } from "react";
import { Link, useNavigate } from "react-router";
import CsvUploader from "../components/CsvUploader";
import { createDataset, uploadDocuments } from "../lib/datasets";
import { useDictionaries, useDocumentTitle, useMeta, useSavedDatasets } from "../lib/hooks";
import { storage } from "../lib/storage";
import { parseTerms } from "../lib/terms";

export default function DatasetsPage() {
  useDocumentTitle("My datasets");
  const meta = useMeta();
  const navigate = useNavigate();
  const dictionaries = useDictionaries();
  const saved = useSavedDatasets();
  const [name, setName] = useState("");
  const [keywords, setKeywords] = useState("sovereign*, sanction*, NATO");
  const [openId, setOpenId] = useState("");

  return (
    <>
      <div className="page-intro">
        <h1>My datasets</h1>
        <p>
          Your own collections, such as a ministry’s statements or a state broadcaster’s articles, scored by country and
          year. Uploads are stored in the app’s database.
        </p>
      </div>

      <div className="grid-2">
        <div className="card">
          <h2>New dataset from a CSV</h2>
          <CsvUploader
            submitLabel="Create dataset"
            onFileName={(n) => setName((current) => current || n)}
            onSubmit={async (parsed, progress) => {
              const { dataset, token } = await createDataset(name.trim() || "Untitled dataset", parseTerms(keywords),
                dictionaries.custom);
              const result = await uploadDocuments(dataset.id, token, parsed.documents, parsed.lines,
                meta.limits.max_batch_documents, progress);
              if (result.added > 0) navigate(`/datasets/${dataset.id}`, { state: { upload: result } });
              return result;
            }}
          >
            <div className="row" style={{ alignItems: "flex-start" }}>
              <div className="field" style={{ flex: "1 1 220px" }}>
                <label htmlFor="dataset-name">Dataset name</label>
                <input id="dataset-name" type="text" value={name} maxLength={120} placeholder="e.g. Xinhua 2015–2024"
                  onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="field" style={{ flex: "1 1 220px" }}>
                <label htmlFor="dataset-keywords">Keywords to track</label>
                <input id="dataset-keywords" type="text" value={keywords} onChange={(e) => setKeywords(e.target.value)}
                  aria-describedby="dataset-keywords-hint" />
                <span className="hint" id="dataset-keywords-hint">Separate with commas; end a word with * for any ending.</span>
              </div>
            </div>
            <p className="small muted">
              Scored with {dictionaries.custom ? "your custom dictionaries" : "the default dictionaries"}{" "}
              (<Link to="/dictionaries">change</Link>). Anyone with a dataset’s link can view it; only this browser can
              change or delete it. Do not upload confidential texts.
            </p>
          </CsvUploader>
        </div>

        <div className="card">
          <h2>Your datasets</h2>
          {saved.length ? (
            <ul className="sentences" data-testid="saved-datasets">
              {saved.map((d) => (
                <li key={d.id}>
                  <Link to={`/datasets/${d.id}`}>{d.name}</Link>
                  <span className="score">created {new Date(d.createdAt).toLocaleDateString()}</span>
                  <button type="button" className="btn link small" style={{ marginLeft: 8 }}
                    onClick={() => storage.forgetDataset(d.id)}>forget</button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty">None yet. Datasets you create are remembered in this browser.</p>
          )}
          <form className="stack" style={{ marginTop: 16 }} onSubmit={(e) => {
            e.preventDefault();
            const id = openId.trim().split("/").filter(Boolean).pop();
            if (id) navigate(`/datasets/${id}`);
          }}>
            <div className="field">
              <label htmlFor="open-dataset">Open a shared dataset</label>
              <input id="open-dataset" type="text" value={openId} placeholder="Paste a dataset link or id"
                onChange={(e) => setOpenId(e.target.value)} />
            </div>
            <div><button type="submit" className="btn">Open</button></div>
          </form>
        </div>
      </div>
    </>
  );
}

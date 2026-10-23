import { Link } from "react-router";
import { useDocumentTitle, useMeta } from "../lib/hooks";

export default function MethodPage() {
  useDocumentTitle("Method");
  const meta = useMeta();
  return (
    <>
      <div className="page-intro">
        <p className="eyebrow">Methodology</p>
        <h1>Method and limitations</h1>
        <p>
          The tool reads a text in two layers. Both are transparent and reproducible: the same text always gets the
          same scores, and every number can be traced back to the words and sentences that produced it.
        </p>
      </div>
      <div className="card prose">
        <h2>1. Diplomatic dictionaries</h2>
        <p>
          Two word lists count <em>hostile</em> vocabulary (aggression, hegemony, sanctions, interference…) and{" "}
          <em>cooperative</em> vocabulary (dialogue, mutual, partnership, win-win…). Hits are normalised per 1,000 words
          so long and short texts are comparable. The lists can be <Link to="/dictionaries">edited</Link>.
        </p>

        <h2>2. VADER sentiment</h2>
        <p>
          VADER (Hutto &amp; Gilbert 2014) gives every sentence a compound score from −1 (negative) to +1 (positive).
          The tool reports the mean and the share of sentences at or below −0.05.
        </p>

        <h2>Metrics</h2>
        <dl className="defs">
          {meta.metrics.map((m) => (
            <div key={m.id} style={{ display: "contents" }}>
              <dt>{m.label}</dt>
              <dd>{m.explanation}</dd>
            </div>
          ))}
          <dt>Keyword rate</dt>
          <dd>Mentions of a keyword per 1,000 words.</dd>
        </dl>
        <p>
          For a country and year with several texts, the counts are added up first and the metrics are computed from
          the totals, so a long speech weighs more than a short note.
        </p>

        <h2>Turning points</h2>
        <p>
          “Biggest shifts” lists the largest changes in a metric from one statement to the country’s next one. They
          point to speeches worth reading closely. They are not proof that policy changed.
        </p>

        {meta.context_model.available && (
          <>
            <h2>Context model (local only)</h2>
            <p>
              When the app runs on a researcher’s own computer, a transformer model ({meta.context_model.name}) can also
              label each sentence as hostile, cooperative or neutral by reading it as a whole. It is too large for the
              public server, so it is switched off there.
            </p>
          </>
        )}

        <h2>Limitations</h2>
        <ul>
          <li>Word counting ignores context: “we do not seek confrontation” still counts one hostile word, and irony is
            invisible.</li>
          <li>VADER was built for social media, not diplomatic prose. Formal language often scores mildly positive.</li>
          <li>Texts must be in English. UN speeches are the official English versions, which are themselves translations
            for most countries.</li>
          <li>Tone is not policy. A conciliatory speech can accompany a hostile act, and the other way round.</li>
          <li>The dictionaries reflect choices about what counts as hostile or cooperative. Different research questions
            need different lists.</li>
          <li>Always read the highlighted sentences before drawing conclusions from a number.</li>
        </ul>

        <h2>Data</h2>
        <p>{meta.citation}. The corpus is released under CC0. Statements are scored once with the default dictionaries,
          and the most notable sentences of each are stored for close reading.</p>
        <p>
          Texts you upload are stored in the app’s database. Anyone with a dataset’s link can view it; only the browser
          that created it can change or delete it.
        </p>

        <h2>API</h2>
        <p>
          Everything on this site is available as a REST API, documented at <a href="/api/docs">/api/docs</a>.
        </p>
      </div>
    </>
  );
}

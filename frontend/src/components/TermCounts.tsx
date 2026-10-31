import { useMemo, useState } from "react";
import { api } from "../api/client";
import type { TermCount } from "../api/types";
import { useAsync } from "../lib/hooks";
import { Loading, Notice } from "./common";

type Sort = "hits" | "statements" | "term";

function share(part: number, whole: number) {
  if (!whole) return "–";
  const p = (part / whole) * 100;
  return p > 0 && p < 1 ? "under 1%" : `${Math.round(p)}%`;
}

const KIND_NAMES = { hostile: "Hostile", cooperative: "Cooperative" } as const;

/** How often each word of the default dictionaries occurs in the UN statements: a sortable, filterable table. */
export default function TermCounts() {
  const counts = useAsync(() => api.un.terms(), []);
  const [kind, setKind] = useState<"all" | TermCount["kind"]>("all");
  const [sort, setSort] = useState<Sort>("hits");

  const rows = useMemo(() => {
    const shown = (counts.data?.terms ?? []).filter((t) => kind === "all" || t.kind === kind);
    return shown.sort((a, b) => sort === "term" ? a.term.localeCompare(b.term)
      : b[sort] - a[sort] || a.term.localeCompare(b.term));
  }, [counts.data, kind, sort]);

  if (counts.error) return <Notice kind="error" onRetry={counts.reload}>{counts.error}</Notice>;
  if (!counts.data) return <Loading />;
  const { statements, first_year, last_year } = counts.data;
  if (!counts.data.terms.length) return <p className="empty">No UN statements are loaded yet.</p>;

  const header = (key: Sort, text: string, numeric = true) => (
    <th className={numeric ? "num" : undefined}
      aria-sort={sort === key ? (key === "term" ? "ascending" : "descending") : "none"}>
      <button type="button" className="th-sort" onClick={() => setSort(key)}>{text}</button>
    </th>
  );

  return (
    <div className="card">
      <div className="card-head">
        <h2>How often each word occurs</h2>
        <div className="field inline">
          <label htmlFor="term-kind">Show</label>
          <select id="term-kind" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
            <option value="all">All words</option>
            <option value="hostile">Hostile words</option>
            <option value="cooperative">Cooperative words</option>
          </select>
        </div>
      </div>
      <p className="small muted">
        In the {statements.toLocaleString("en")} UN General Debate statements, {first_year}–{last_year}, for the
        default lists. A word ending in * counts every ending; a phrase is counted once, not also as its last word.
      </p>
      <div className="table-wrap tall" tabIndex={0} role="region" aria-label="Dictionary words and how often they occur">
        <table>
          <thead>
            <tr>
              {header("term", "Word", false)}
              <th>List</th>
              {header("hits", "Times found")}
              {header("statements", "Share of statements")}
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr key={`${t.kind}:${t.term}`}>
                <td><mark className={t.kind}>{t.term}</mark></td>
                <td>{KIND_NAMES[t.kind]}</td>
                <td className="num">{t.hits.toLocaleString("en")}</td>
                <td className="num">{share(t.statements, statements)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

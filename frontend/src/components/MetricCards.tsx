import type { Metrics } from "../api/types";
import { formatDelta, formatMetric } from "../lib/format";
import { useMeta } from "../lib/hooks";

/** The five tone metrics, optionally compared with an average (the UN baseline). Their explanations sit in one
 *  disclosure under the strip rather than in every cell. */
export default function MetricCards({ metrics, compareTo, compareLabel }: {
  metrics: Metrics; compareTo?: Metrics | null; compareLabel?: string;
}) {
  return (
    <>
      <Strip metrics={metrics} compareTo={compareTo} compareLabel={compareLabel} />
      <MetricDefinitions />
    </>
  );
}

function Strip({ metrics, compareTo, compareLabel }: {
  metrics: Metrics; compareTo?: Metrics | null; compareLabel?: string;
}) {
  const meta = useMeta();
  return (
    <div className="metrics">
      {meta.metrics.map((m) => {
        const value = metrics[m.id];
        const base = compareTo?.[m.id];
        let delta = null;
        if (value !== null && value !== undefined && base !== null && base !== undefined) {
          delta = (
            <div className="delta">
              {formatDelta(m.id, value - base)} <span className="muted">vs {compareLabel}</span>
            </div>
          );
        }
        return (
          <div className="metric" key={m.id} data-testid={`metric-${m.id}`}>
            <div className="label">{m.label}</div>
            <div className="value">{formatMetric(m.id, value)}</div>
            {delta}
          </div>
        );
      })}
    </div>
  );
}

/** What each measure means, behind one disclosure. */
export function MetricDefinitions() {
  const meta = useMeta();
  return (
    <details className="table-view metric-definitions">
      <summary>What these measures mean</summary>
      <dl className="defs">
        {meta.metrics.map((m) => (
          <div key={m.id} style={{ display: "contents" }}>
            <dt>{m.label}</dt>
            <dd>{m.explanation}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

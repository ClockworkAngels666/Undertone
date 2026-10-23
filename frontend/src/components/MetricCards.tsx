import type { Metrics } from "../api/types";
import { formatDelta, formatMetric } from "../lib/format";
import { useMeta } from "../lib/hooks";

/** The five tone metrics, optionally compared with an average (the UN baseline). */
export default function MetricCards({ metrics, compareTo, compareLabel }: {
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
          const diff = value - base;
          const worse = m.higher_is_worse ? diff > 0 : diff < 0;
          const tone = Math.abs(diff) < 1e-9 ? "neutral" : worse ? "bad" : "good";
          delta = (
            <div className={`delta ${tone}`}>
              {formatDelta(m.id, diff)} <span className="muted">vs {compareLabel}</span>
            </div>
          );
        }
        return (
          <div className="metric" key={m.id} data-testid={`metric-${m.id}`}>
            <div className="label">{m.label}</div>
            <div className="value">{formatMetric(m.id, value)}</div>
            {delta}
            <div className="explain">{m.explanation}</div>
          </div>
        );
      })}
    </div>
  );
}

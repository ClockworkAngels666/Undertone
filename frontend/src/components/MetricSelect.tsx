import { useId } from "react";
import { metricLabel } from "../lib/format";
import { useMeta } from "../lib/hooks";

/** The five tone metrics plus any keyword rates available for the data being shown. */
export default function MetricSelect({ value, onChange, keywords }: {
  value: string; onChange: (id: string) => void; keywords: string[];
}) {
  const meta = useMeta();
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>Metric</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        <optgroup label="Tone">
          {meta.metrics.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
        </optgroup>
        {keywords.length > 0 && (
          <optgroup label="Keywords (per 1,000 words)">
            {keywords.map((k) => <option key={k} value={`kw::${k}`}>{metricLabel(`kw::${k}`, meta.metrics)}</option>)}
          </optgroup>
        )}
      </select>
    </div>
  );
}

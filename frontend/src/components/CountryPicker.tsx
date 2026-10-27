import { useId, useState } from "react";
import { CloseIcon } from "./icons";

export interface PickerOption {
  code: string;
  name: string;
}

/** Choose up to `max` countries: chips for the chosen ones plus a searchable list to add more. */
export default function CountryPicker({ options, value, onChange, max, colors, label = "Countries" }: {
  options: PickerOption[];
  value: string[];
  onChange: (codes: string[]) => void;
  max: number;
  colors: Record<string, string>;
  label?: string;
}) {
  const id = useId();
  const [text, setText] = useState("");
  const byCode = new Map(options.map((o) => [o.code, o]));
  const full = value.length >= max;

  const add = (raw: string) => {
    const query = raw.trim().toLowerCase();
    if (!query) return;
    const match = options.find((o) => `${o.name} (${o.code})`.toLowerCase() === query)
      ?? options.find((o) => o.code.toLowerCase() === query)
      ?? options.find((o) => o.name.toLowerCase() === query)
      ?? options.find((o) => o.name.toLowerCase().startsWith(query));
    if (match && !value.includes(match.code) && !full) onChange([...value, match.code]);
    setText("");
  };

  return (
    <div className="picker">
      <label htmlFor={id}>
        {label} <span className="hint">({value.length}/{max})</span>
      </label>
      <div className="chips" aria-live="polite">
        {value.map((code) => (
          <span className="chip" key={code}>
            <span className="swatch" style={{ background: colors[code] }} aria-hidden="true" />
            {byCode.get(code)?.name ?? code}
            <button type="button" aria-label={`Remove ${byCode.get(code)?.name ?? code}`}
              onClick={() => onChange(value.filter((c) => c !== code))}><CloseIcon /></button>
          </span>
        ))}
      </div>
      <input id={id} type="search" list={`${id}-list`} value={text} disabled={full}
        placeholder={full ? `Maximum ${max} — remove one to add another` : "Type a country name or code…"}
        onChange={(e) => {
          const next = e.target.value;
          setText(next);
          // Picking an entry from the datalist fills in its exact label: add it straight away.
          if (options.some((o) => `${o.name} (${o.code})` === next)) add(next);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add(text);
          }
        }} />
      <datalist id={`${id}-list`}>
        {options.filter((o) => !value.includes(o.code)).map((o) => (
          <option key={o.code} value={`${o.name} (${o.code})`} />
        ))}
      </datalist>
    </div>
  );
}

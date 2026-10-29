import { useId, useState } from "react";
import { CloseIcon } from "./icons";

/** Short names people type for countries whose listed name differs. */
const ALIASES: Record<string, string> = {
  uk: "GBR", britain: "GBR", "great britain": "GBR", us: "USA", "u.s.": "USA", america: "USA", uae: "ARE",
  ussr: "RUS", "soviet union": "RUS", dprk: "PRK", rok: "KOR", prc: "CHN", drc: "COD",
};

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
  const [note, setNote] = useState<string | null>(null);
  const byCode = new Map(options.map((o) => [o.code, o]));
  const full = value.length >= max;

  const add = (raw: string) => {
    const query = raw.trim().toLowerCase();
    if (!query) return;
    // A name that starts with the query, or contains it, counts only when it is the only one (so "Korea" asks)
    const only = (test: (name: string) => boolean) => {
      const hits = query.length >= 3 ? options.filter((o) => test(o.name.toLowerCase())) : [];
      return hits.length === 1 ? hits[0] : null;
    };
    const match = options.find((o) => `${o.name} (${o.code})`.toLowerCase() === query)
      ?? options.find((o) => o.code.toLowerCase() === query)
      ?? options.find((o) => o.name.toLowerCase() === query)
      ?? byCode.get(ALIASES[query] ?? "")
      ?? only((name) => name.startsWith(query))
      ?? only((name) => name.includes(query));
    if (!match) {
      const several = options.filter((o) => o.name.toLowerCase().includes(query)).map((o) => o.name);
      setNote(several.length > 1
        ? `“${raw.trim()}” fits ${several.slice(0, 4).join(", ")}${several.length > 4 ? "…" : ""}. Pick one from the list.`
        : `No country matches “${raw.trim()}”.`);
      return;
    }
    setNote(value.includes(match.code) ? `${match.name} is already in the chart.` : null);
    if (!value.includes(match.code) && !full) onChange([...value, match.code]);
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
        aria-describedby={note ? `${id}-note` : undefined}
        placeholder={full ? `Maximum ${max} — remove one to add another` : "Type a country name or code…"}
        onChange={(e) => {
          const next = e.target.value;
          setText(next);
          setNote(null);
          // Picking an entry from the datalist fills in its exact label: add it straight away.
          if (options.some((o) => `${o.name} (${o.code})` === next)) add(next);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add(text);
          }
        }} />
      {note && <span className="hint" id={`${id}-note`} role="status">{note}</span>}
      <datalist id={`${id}-list`}>
        {options.filter((o) => !value.includes(o.code)).map((o) => (
          <option key={o.code} value={`${o.name} (${o.code})`} />
        ))}
      </datalist>
    </div>
  );
}

// Per-browser memory: the visitor's custom dictionaries and the datasets they created
// (with the edit token, which is the only way to change or delete a dataset).
// Storage can be unavailable (private mode, blocked site data), so every access is guarded.

const DATASETS_KEY = "dla.datasets.v1";
const DICTIONARIES_KEY = "dla.dictionaries.v1";
const LISTEN_KEY = "dla.listen.v1";

export interface ListenSettings {
  voice: string | null;     // voiceURI of the chosen voice; null = the best English voice found
  rate: number;
}

export interface SavedDataset {
  id: string;
  name: string;
  token: string;
  createdAt: string;
}

export interface CustomDictionaries {
  hostile: string[];
  cooperative: string[];
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): boolean {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    window.dispatchEvent(new Event("dla-storage"));
    return true;
  } catch {
    return false;
  }
}

export const storage = {
  datasets(): SavedDataset[] {
    const list = read<SavedDataset[]>(DATASETS_KEY, []);
    return Array.isArray(list) ? list.filter((d) => d && typeof d.id === "string") : [];
  },
  saveDataset(entry: SavedDataset) {
    return write(DATASETS_KEY, [entry, ...this.datasets().filter((d) => d.id !== entry.id)]);
  },
  forgetDataset(id: string) {
    return write(DATASETS_KEY, this.datasets().filter((d) => d.id !== id));
  },
  token(id: string): string | undefined {
    return this.datasets().find((d) => d.id === id)?.token;
  },
  dictionaries(): CustomDictionaries | null {
    const d = read<CustomDictionaries | null>(DICTIONARIES_KEY, null);
    return d && Array.isArray(d.hostile) && Array.isArray(d.cooperative) ? d : null;
  },
  saveDictionaries(d: CustomDictionaries | null) {
    if (d === null) {
      try {
        window.localStorage.removeItem(DICTIONARIES_KEY);
        window.dispatchEvent(new Event("dla-storage"));
      } catch {
        return false;
      }
      return true;
    }
    return write(DICTIONARIES_KEY, d);
  },
  listen(): ListenSettings {
    const s = read<Partial<ListenSettings> | null>(LISTEN_KEY, null);
    return {
      voice: typeof s?.voice === "string" ? s.voice : null,
      rate: typeof s?.rate === "number" && s.rate >= 0.5 && s.rate <= 2 ? s.rate : 1,
    };
  },
  saveListen(s: ListenSettings) {
    try {
      window.localStorage.setItem(LISTEN_KEY, JSON.stringify(s));   // no storage event: only this page cares
      return true;
    } catch {
      return false;
    }
  },
};

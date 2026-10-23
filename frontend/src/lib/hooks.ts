import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { ApiError } from "../api/client";
import type { Meta } from "../api/types";
import { storage, type CustomDictionaries, type SavedDataset } from "./storage";

export interface AsyncState<T> {
  data: T | undefined;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

/** Run an async loader whenever its dependencies change; keeps the previous data while reloading. */
export function useAsync<T>(load: () => Promise<T>, deps: unknown[]): AsyncState<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    loadRef
      .current()
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(errorText(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [...deps, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload };
}

export function errorText(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return "Something went wrong.";
}

export const MetaContext = createContext<Meta | null>(null);

/** Static facts from /api/meta (metric labels, default dictionaries, limits). */
export function useMeta(): Meta {
  const meta = useContext(MetaContext);
  if (!meta) throw new Error("useMeta must be used inside <MetaContext.Provider>");
  return meta;
}

function useStorage<T>(read: () => T): T {
  const [value, setValue] = useState(read);
  const readRef = useRef(read);
  readRef.current = read;
  useEffect(() => {
    const update = () => setValue(readRef.current());
    window.addEventListener("dla-storage", update);
    window.addEventListener("storage", update);
    return () => {
      window.removeEventListener("dla-storage", update);
      window.removeEventListener("storage", update);
    };
  }, []);
  return value;
}

export function useSavedDatasets(): SavedDataset[] {
  return useStorage(() => storage.datasets());
}

/** The dictionaries in use: the visitor's custom lists, or the defaults. */
export function useDictionaries(): { custom: CustomDictionaries | null; hostile: string[]; cooperative: string[] } {
  const meta = useMeta();
  const custom = useStorage(() => storage.dictionaries());
  return {
    custom,
    hostile: custom?.hostile ?? meta.default_dictionaries.hostile,
    cooperative: custom?.cooperative ?? meta.default_dictionaries.cooperative,
  };
}

/** Set the browser tab title for the current page. */
export function useDocumentTitle(title: string) {
  useEffect(() => {
    document.title = title ? `${title} · Diplomatic Language Analyzer` : "Diplomatic Language Analyzer";
  }, [title]);
}

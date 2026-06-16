"use client";

import { useEffect, useRef, useState, useCallback } from "react";

export type ResourceState<T> =
  | { status: "loading"; data: null; error: null }
  | { status: "ready"; data: T; error: null }
  | { status: "not-found"; data: null; error: null }
  | { status: "error"; data: null; error: string };

export function useResourceLoader<T>(
  url: string,
  options?: { onNotFoundRedirect?: () => void },
) {
  const [state, setState] = useState<ResourceState<T>>({ status: "loading", data: null, error: null });

  // Garde la dernière version des options sans la mettre en dépendance de
  // `fetcher` : un objet littéral recréé à chaque render provoquerait sinon une
  // boucle de re-fetch infinie (l'effet se relance à chaque render).
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const fetcher = useCallback(async () => {
    setState({ status: "loading", data: null, error: null });
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (res.status === 404) {
        setState({ status: "not-found", data: null, error: null });
        optionsRef.current?.onNotFoundRedirect?.();
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setState({ status: "error", data: null, error: body.error ?? `HTTP_${res.status}` });
        return;
      }
      const data = (await res.json()) as T;
      setState({ status: "ready", data, error: null });
    } catch (e) {
      setState({ status: "error", data: null, error: (e as Error).message });
    }
  }, [url]);

  useEffect(() => {
    fetcher();
  }, [fetcher]);

  return { ...state, refresh: fetcher };
}

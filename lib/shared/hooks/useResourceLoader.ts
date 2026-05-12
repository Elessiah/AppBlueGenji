"use client";

import { useEffect, useState, useCallback } from "react";

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

  const fetcher = useCallback(async () => {
    setState({ status: "loading", data: null, error: null });
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (res.status === 404) {
        setState({ status: "not-found", data: null, error: null });
        options?.onNotFoundRedirect?.();
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
  }, [url, options]);

  useEffect(() => {
    fetcher();
  }, [fetcher]);

  return { ...state, refresh: fetcher };
}

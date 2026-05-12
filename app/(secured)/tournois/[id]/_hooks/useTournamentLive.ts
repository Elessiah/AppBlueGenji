import { useEffect, useState, useCallback } from "react";
import type { TournamentDetail } from "@/lib/shared/types";
import { useToast } from "@/components/ui/toast";
import { mapError } from "../_lib/error-map";
import { playScoreReady } from "../_lib/sounds";

export function useTournamentLive(tournamentId: number) {
  const { showError } = useToast();
  const [detail, setDetail] = useState<TournamentDetail | null>(null);
  const [isLive, setIsLive] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/tournaments/${tournamentId}`, { cache: "no-store" });
      const payload = (await response.json()) as TournamentDetail & { error?: string };
      if (!response.ok) {
        const errorCode = payload.error || "TOURNAMENT_LOAD_FAILED";
        throw new Error(errorCode);
      }
      setDetail(payload);
    } catch (e) {
      showError(mapError((e as Error).message));
      throw e;
    }
  }, [tournamentId, showError]);

  useEffect(() => {
    if (!tournamentId) return;

    let cancelled = false;
    let reconnectAttempts = 0;
    const maxReconnectAttempts = 5;

    const setupEventSource = () => {
      try {
        const eventSource = new EventSource(`/api/tournaments/${tournamentId}/stream`);
        setIsLive(true);

        load().catch(() => undefined);

        eventSource.onmessage = (event) => {
          if (cancelled) return;
          const payload = JSON.parse(event.data) as { type?: string };
          if (payload.type === "heartbeat" || payload.type === "connected") return;
          if (payload.type === "score_reported") playScoreReady();
          load().catch(() => undefined);
        };

        eventSource.onerror = () => {
          if (cancelled) return;
          eventSource.close();
          setIsLive(false);
          reconnectAttempts++;
          if (reconnectAttempts < maxReconnectAttempts) {
            setTimeout(setupEventSource, 1000 * Math.pow(1.5, reconnectAttempts));
          }
        };

        return () => {
          eventSource.close();
          setIsLive(false);
        };
      } catch {
        if (!cancelled) {
          setIsLive(false);
          reconnectAttempts++;
          if (reconnectAttempts < maxReconnectAttempts) {
            setTimeout(setupEventSource, 1000 * Math.pow(1.5, reconnectAttempts));
          }
        }
      }
    };

    const cleanup = setupEventSource();

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [tournamentId, load]);

  return {
    tournament: detail,
    matches: detail?.matches ?? [],
    isLive,
  };
}

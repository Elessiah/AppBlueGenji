import { useCallback, useEffect, useState } from "react";
import type { TeamDetailResponse } from "@/lib/shared/types";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";

export function useTeamDetail(teamId: number) {
  const [team, setTeam] = useState<TeamDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const { showError } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/teams/${teamId}`, { cache: "no-store" });
      const payload = (await response.json()) as TeamDetailResponse & { error?: string };
      if (!response.ok) {
        const errorCode = payload.error || "TEAM_LOAD_FAILED";
        if (errorCode === "TEAM_NOT_FOUND") {
          showError(errorCode);
          setError(errorCode);
          setTimeout(() => router.push("/equipes"), 1500);
          return;
        }
        throw new Error(errorCode);
      }
      setTeam(payload);
    } catch (e) {
      const msg = (e as Error).message;
      setError(msg);
      showError(msg);
    } finally {
      setLoading(false);
    }
  }, [teamId, router, showError]);

  useEffect(() => {
    load();
  }, [load]);

  const refresh = useCallback(() => {
    load();
  }, [load]);

  return { team, loading, error, refresh };
}

import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";
import { useResourceLoader } from "@/lib/shared/hooks/useResourceLoader";
import type { TeamDetailResponse } from "@/lib/shared/types";

export function useTeamDetail(teamId: number) {
  const router = useRouter();
  const { showError } = useToast();

  const { status, data, error, refresh } = useResourceLoader<TeamDetailResponse>(
    `/api/teams/${teamId}`,
    {
      onNotFoundRedirect: () => {
        showError("TEAM_NOT_FOUND");
        setTimeout(() => router.push("/equipes"), 1500);
      },
    },
  );

  return {
    team: data,
    loading: status === "loading",
    error: status === "not-found" || status === "error" ? error : null,
    refresh,
  };
}

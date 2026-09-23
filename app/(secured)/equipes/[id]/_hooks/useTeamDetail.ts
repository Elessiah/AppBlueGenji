import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";
import { useResourceLoader } from "@/lib/shared/hooks/useResourceLoader";
import type { TeamDetailResponse } from "@/lib/shared/types";
import { teamErrorMessage } from "../../_lib/team-errors";

export function useTeamDetail(teamId: number) {
  const router = useRouter();
  const { showError } = useToast();

  const { status, data, error, revalidate } = useResourceLoader<TeamDetailResponse>(
    `/api/teams/${teamId}`,
    {
      onNotFoundRedirect: (payload) => {
        // Un identifiant d'entrée solo n'est pas une équipe manquante : le
        // joueur a bien une fiche, ailleurs. On y mène sans faire clignoter une
        // erreur — le lien était valide.
        const soloUserId = payload.soloUserId;
        if (typeof soloUserId === "number") {
          router.replace(`/joueurs/${soloUserId}`);
          return;
        }
        // Le code partait tel quel : « TEAM_NOT_FOUND » en capitales.
        showError(teamErrorMessage("TEAM_NOT_FOUND"));
        setTimeout(() => router.push("/equipes"), 1500);
      },
    },
  );

  return {
    team: data,
    loading: status === "loading",
    error: status === "not-found" || status === "error" ? error ?? status : null,
    /**
     * Relecture **silencieuse** après un geste : la fiche reste affichée
     * pendant l'appel au lieu de repasser par « Chargement… ».
     */
    refresh: revalidate,
  };
}

import { useCallback } from "react";
import type { TeamDetailResponse, TeamRole } from "@/lib/shared/types";
import { useToast } from "@/components/ui/toast";

export function useMemberManagement(teamId: number, onChanged: () => void) {
  const { showError, showSuccess } = useToast();

  const addMember = useCallback(
    async (pseudo: string, roles: TeamRole[]) => {
      try {
        const response = await fetch(`/api/teams/${teamId}/members`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ pseudo, roles }),
        });
        const payload = (await response.json()) as TeamDetailResponse & {
          error?: string;
          result?: "INVITED" | "JOINED";
        };
        if (!response.ok) throw new Error(payload.error || "TEAM_MEMBER_ADD_FAILED");
        showSuccess(
          payload.result === "JOINED"
            ? "Demande du joueur validée : il a rejoint l'équipe."
            : "Invitation envoyée au joueur.",
        );
        onChanged();
      } catch (e) {
        showError((e as Error).message);
      }
    },
    [teamId, onChanged, showError, showSuccess],
  );

  const removeMember = useCallback(
    async (userId: number) => {
      try {
        const response = await fetch(`/api/teams/${teamId}/members`, {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ userId }),
        });
        const payload = (await response.json()) as TeamDetailResponse & { error?: string };
        if (!response.ok) throw new Error(payload.error || "TEAM_MEMBER_REMOVE_FAILED");
        showSuccess("Membre retiré.");
        onChanged();
      } catch (e) {
        showError((e as Error).message);
      }
    },
    [teamId, onChanged, showError, showSuccess],
  );

  const updateRoles = useCallback(
    async (userId: number, roles: TeamRole[]) => {
      try {
        const response = await fetch(`/api/teams/${teamId}/members`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ userId, roles }),
        });
        const payload = (await response.json()) as TeamDetailResponse & { error?: string };
        if (!response.ok) throw new Error(payload.error || "TEAM_MEMBER_UPDATE_FAILED");
        showSuccess("Rôles mis à jour.");
        onChanged();
      } catch (e) {
        showError((e as Error).message);
      }
    },
    [teamId, onChanged, showError, showSuccess],
  );

  return { addMember, removeMember, updateRoles };
}

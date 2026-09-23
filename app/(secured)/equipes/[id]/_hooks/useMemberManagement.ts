import { useCallback } from "react";
import type { TeamRole } from "@/lib/shared/types";
import { useToast } from "@/components/ui/toast";
import { teamErrorMessage } from "../../_lib/team-errors";
import { jsonRequest, teamApi } from "../_lib/team-api";

/**
 * Gestes de la gestion sur le roster.
 *
 * Chacun **rend son issue** (`true` si le serveur a accepté). Ils avalaient
 * l'échec après l'avoir signalé, si bien que l'appelant poursuivait comme sur
 * un succès : la modale des rôles se refermait sur un refus, la sélection
 * perdue, et le formulaire d'invitation se vidait sur un pseudo mal tapé — qu'il
 * fallait alors ressaisir pour le corriger.
 */
export function useMemberManagement(teamId: number, onChanged: () => void) {
  const { showError, showSuccess } = useToast();

  const run = useCallback(
    async (action: () => Promise<string>): Promise<boolean> => {
      try {
        const message = await action();
        showSuccess(message);
        onChanged();
        return true;
      } catch (e) {
        showError(teamErrorMessage((e as Error).message));
        return false;
      }
    },
    [onChanged, showError, showSuccess],
  );

  const addMember = useCallback(
    (pseudo: string, roles: TeamRole[]) =>
      run(async () => {
        const payload = await teamApi<{ result?: "INVITED" | "JOINED" }>(
          `/api/teams/${teamId}/members`,
          jsonRequest("POST", { pseudo, roles }),
          "TEAM_MEMBER_ADD_FAILED",
        );
        return payload.result === "JOINED"
          ? `${pseudo} avait demandé à rejoindre l'équipe : c'est fait.`
          : `Invitation envoyée à ${pseudo}.`;
      }),
    [run, teamId],
  );

  const removeMember = useCallback(
    (userId: number, pseudo: string) =>
      run(async () => {
        await teamApi(`/api/teams/${teamId}/members`, jsonRequest("DELETE", { userId }), "TEAM_MEMBER_REMOVE_FAILED");
        return `${pseudo} ne fait plus partie de l'équipe.`;
      }),
    [run, teamId],
  );

  const updateRoles = useCallback(
    (userId: number, roles: TeamRole[]) =>
      run(async () => {
        await teamApi(`/api/teams/${teamId}/members`, jsonRequest("PATCH", { userId, roles }), "TEAM_MEMBER_UPDATE_FAILED");
        return "Rôles mis à jour.";
      }),
    [run, teamId],
  );

  const cancelInvitation = useCallback(
    (invitationId: number, pseudo: string) =>
      run(async () => {
        await teamApi(`/api/invitations/${invitationId}`, { method: "DELETE" }, "INVITATION_CANCEL_FAILED");
        return `Invitation de ${pseudo} retirée.`;
      }),
    [run],
  );

  return { addMember, removeMember, updateRoles, cancelInvitation };
}

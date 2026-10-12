import { useCallback } from "react";
import type { TeamRole } from "@/lib/shared/types";
import { useToast } from "@/components/ui/toast";
import { useTeamErrorMessage } from "@/components/i18n/team-errors-text";
import { useTeamPageText } from "@/components/i18n/team-page-text";
import { jsonRequest, teamApi } from "../_lib/team-api";

/**
 * Reçoit le code d'un refus et sa phrase, pour le rattacher au champ qu'il
 * désigne (`useFieldErrors().report`). Le hook garde la notification : c'est
 * la convention, et le rattachement s'y ajoute sans la remplacer.
 */
export type RefusalListener = (code: string, message: string) => void;

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
  const { t } = useTeamPageText();
  const teamErrorMessage = useTeamErrorMessage();

  const run = useCallback(
    async (action: () => Promise<string>, onRefused?: RefusalListener): Promise<boolean> => {
      try {
        const message = await action();
        showSuccess(message);
        onChanged();
        return true;
      } catch (e) {
        const code = (e as Error).message;
        const message = teamErrorMessage(code);
        showError(message);
        onRefused?.(code, message);
        return false;
      }
    },
    [onChanged, showError, showSuccess, teamErrorMessage],
  );

  const addMember = useCallback(
    (pseudo: string, roles: TeamRole[], onRefused?: RefusalListener) =>
      run(async () => {
        const payload = await teamApi<{ result?: "INVITED" | "JOINED" }>(
          `/api/teams/${teamId}/members`,
          jsonRequest("POST", { pseudo, roles }),
          "TEAM_MEMBER_ADD_FAILED",
        );
        return payload.result === "JOINED"
          ? t("members.invitedJoined", { pseudo })
          : t("members.invitationSent", { pseudo });
      }, onRefused),
    [run, teamId, t],
  );

  const removeMember = useCallback(
    (userId: number, pseudo: string) =>
      run(async () => {
        await teamApi(`/api/teams/${teamId}/members`, jsonRequest("DELETE", { userId }), "TEAM_MEMBER_REMOVE_FAILED");
        return t("members.removed", { pseudo });
      }),
    [run, teamId, t],
  );

  const updateRoles = useCallback(
    (userId: number, roles: TeamRole[]) =>
      run(async () => {
        await teamApi(`/api/teams/${teamId}/members`, jsonRequest("PATCH", { userId, roles }), "TEAM_MEMBER_UPDATE_FAILED");
        return t("members.rolesUpdated");
      }),
    [run, teamId, t],
  );

  const cancelInvitation = useCallback(
    (invitationId: number, pseudo: string) =>
      run(async () => {
        await teamApi(`/api/invitations/${invitationId}`, { method: "DELETE" }, "INVITATION_CANCEL_FAILED");
        return t("members.invitationWithdrawn", { pseudo });
      }),
    [run, t],
  );

  return { addMember, removeMember, updateRoles, cancelInvitation };
}

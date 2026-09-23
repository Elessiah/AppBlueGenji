import { useCallback, useEffect, useState } from "react";
import type { TeamJoinRequest, TeamSentInvitation } from "@/lib/shared/types";

/**
 * Ce qui attend une réponse, vue gestion : demandes reçues et invitations
 * envoyées, lues d'un seul appel.
 *
 * `enabled` vaut faux pour qui ne gère pas l'équipe, pour une fantôme (aucun
 * membre, la route refuse) et pour une équipe dissoute : pas d'appel du tout
 * plutôt qu'un 403 attendu.
 */
export function useTeamPendingInvitations(teamId: number, enabled: boolean) {
  const [requests, setRequests] = useState<TeamJoinRequest[]>([]);
  const [invitations, setInvitations] = useState<TeamSentInvitation[]>([]);

  const reload = useCallback(async () => {
    if (!enabled) {
      setRequests([]);
      setInvitations([]);
      return;
    }
    try {
      const res = await fetch(`/api/teams/${teamId}/invitations`, { cache: "no-store" });
      if (!res.ok) return;
      const payload = (await res.json()) as {
        requests?: TeamJoinRequest[];
        invitations?: TeamSentInvitation[];
      };
      setRequests(payload.requests ?? []);
      setInvitations(payload.invitations ?? []);
    } catch {
      // Une liste d'attente absente ne bloque aucun geste : la page reste utile.
    }
  }, [teamId, enabled]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { requests, invitations, reload };
}

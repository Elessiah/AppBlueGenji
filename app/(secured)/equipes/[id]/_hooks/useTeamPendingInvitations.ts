import { useCallback, useEffect, useRef, useState } from "react";
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
  /**
   * Numéro de la dernière lecture lancée — même règle que `useResourceLoader` :
   * deux gestes rapprochés lancent deux lectures, et la plus ancienne ne doit
   * pas faire réapparaître une invitation que la seconde vient de retirer.
   */
  const latestRef = useRef(0);

  const reload = useCallback(async () => {
    const seq = ++latestRef.current;
    if (!enabled) {
      setRequests([]);
      setInvitations([]);
      return;
    }
    try {
      const res = await fetch(`/api/teams/${teamId}/invitations`, { cache: "no-store" });
      if (!res.ok || seq !== latestRef.current) return;
      const payload = (await res.json()) as {
        requests?: TeamJoinRequest[];
        invitations?: TeamSentInvitation[];
      };
      if (seq !== latestRef.current) return;
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

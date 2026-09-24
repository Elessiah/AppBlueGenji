import { emptyDeepStats } from "@/lib/shared/stats";
import type { TeamDetailResponse } from "@/lib/shared/types";

/**
 * Une `TeamDetailResponse` **complète** — la fiche de `getTeamDetail` —, dont
 * l'en-tête `team` se surcharge champ par champ.
 *
 * Les tests de route la réduisaient à `{ team: { id } }` passé en `as never` :
 * la route la renvoie telle quelle, mais un champ ajouté au type ne se voyait
 * dans aucune de ces réponses.
 */
export function teamDetailResponse(
  overrides: Partial<Omit<TeamDetailResponse, "team">> & {
    team?: Partial<TeamDetailResponse["team"]>;
  } = {},
): TeamDetailResponse {
  const { team, ...rest } = overrides;
  return {
    team: {
      id: 1,
      name: "Équipe",
      tag: null,
      logoUrl: null,
      description: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      deletedAt: null,
      isGhost: false,
      ...team,
    },
    members: [],
    tournaments: [],
    stats: emptyDeepStats(new Date("2026-01-01T00:00:00.000Z")),
    ranking: null,
    canManage: false,
    managedAsGhost: false,
    viewerUserId: 1,
    viewerMembership: "NONE",
    viewerInvitation: "NONE",
    viewerInvitationId: null,
    ...rest,
  };
}

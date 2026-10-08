import type { TournamentFormat, TournamentState } from "@/lib/shared/types";

export interface ForfeitContext {
  format: TournamentFormat;
  state: TournamentState;
  /** L'utilisateur a la permission « tournaments » (arbitrage / admin). */
  isAdmin: boolean;
  myTeamId: number | null;
  /** Équipes que l'utilisateur représente (capitaine / propriétaire). */
  canCreateReportsForTeamIds: number[];
  /**
   * A-t-il qualité pour **engager ou désengager** son équipe (`OWNER` /
   * `MANAGER`) ? Le même fait que celui qui ouvre l'inscription
   * (`TournamentViewerContext.canRegisterEntrant`), et pour la même raison :
   * un abandon retire l'équipe entière du tournoi, sans retour.
   */
  canActForEntrant: boolean;
}

/** Formats où une équipe reste en lice tant qu'elle ne se retire pas d'elle-même. */
const FORMATS_WITH_FORFEIT: ReadonlySet<TournamentFormat> = new Set<TournamentFormat>(["SURVIVAL", "SWISS", "BG_SURVIE"]);

/**
 * Le bouton « Forfait » du classement doit-il être proposé pour cette équipe ?
 *
 * L'abandon n'a de sens que dans un tournoi Survie, BlueGenji Survie ou Ronde
 * suisse en cours :
 * les formats à élimination n'ont pas de notion d'abandon en cours de route (le
 * match perdu suffit). Un **responsable** de l'équipe déclare son propre
 * forfait — `OWNER` ou `MANAGER`, la qualité qui permet déjà de l'inscrire ;
 * l'arbitrage peut le déclarer pour n'importe quelle équipe. Même règle côté
 * serveur, dans `app/api/tournaments/[id]/forfeit/route.ts`, qui refuse un
 * simple membre du roster en `403 NOT_TEAM_MANAGER`.
 *
 * L'appelant reste responsable de n'afficher le bouton que sur une équipe encore
 * en lice (statut `ACTIVE`).
 *
 * Sur un tournoi multi-phases, `format` doit porter le format de la **phase en
 * cours**, pas `MULTI` : c'est la phase qui détermine si l'abandon a un sens.
 */
export function canForfeitTeam(context: ForfeitContext, teamId: number): boolean {
  if (!FORMATS_WITH_FORFEIT.has(context.format)) return false;
  if (context.state !== "RUNNING") return false;
  if (context.isAdmin) return true;
  if (!context.canActForEntrant) return false;
  return context.myTeamId === teamId && context.canCreateReportsForTeamIds.includes(teamId);
}

/**
 * Les boutons « Annuler l'abandon » du classement doivent-ils être proposés ?
 *
 * **Administrateur strict** (`TournamentViewerContext.canCancelForfeit`), sur
 * un tournoi **en cours** dont le suivi n'est pas arrêté (`frozen`) : un
 * tournoi terminé ne se rouvre pas, et le serveur refuse de même
 * (`TOURNAMENT_NOT_RUNNING`). L'appelant n'affiche le bouton que sur une ligne
 * `FORFEIT` — la vue sait seule quelle ligne porte ce statut.
 */
export function canCancelForfeits(context: {
  canCancelForfeit: boolean;
  state: TournamentState;
  frozen: boolean;
}): boolean {
  return context.canCancelForfeit && context.state === "RUNNING" && !context.frozen;
}

/**
 * Annule l'abandon d'un engagé (administrateur strict) : il revient en lice,
 * le match perdu par forfait reste perdu (`docs/features/FORFEIT_CANCELLATION.md`).
 *
 * @throws le code d'erreur rendu par la route, à traduire par `mapError`.
 */
export async function requestForfeitCancellation(tournamentId: number, teamId: number): Promise<void> {
  const response = await fetch(`/api/admin/tournaments/${tournamentId}/forfeits/${teamId}`, {
    method: "DELETE",
  });
  const payload = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(payload.error || "FORFEIT_CANCEL_FAILED");
}

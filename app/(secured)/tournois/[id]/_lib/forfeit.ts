import type { TournamentFormat, TournamentState } from "@/lib/shared/types";

export interface ForfeitContext {
  format: TournamentFormat;
  state: TournamentState;
  /** L'utilisateur a la permission « tournaments » (arbitrage / admin). */
  isAdmin: boolean;
  myTeamId: number | null;
  /** Équipes que l'utilisateur représente (capitaine / propriétaire). */
  canCreateReportsForTeamIds: number[];
}

/** Formats où une équipe reste en lice tant qu'elle ne se retire pas d'elle-même. */
const FORMATS_WITH_FORFEIT: TournamentFormat[] = ["SURVIVAL", "SWISS", "BG_SURVIE"];

/**
 * Le bouton « Forfait » du classement doit-il être proposé pour cette équipe ?
 *
 * L'abandon n'a de sens que dans un tournoi Survie, BlueGenji Survie ou Ronde
 * suisse en cours :
 * les formats à élimination n'ont pas de notion d'abandon en cours de route (le
 * match perdu suffit). Un représentant de l'équipe déclare son propre forfait ;
 * l'arbitrage peut le déclarer pour n'importe quelle équipe. Même règle côté
 * serveur, dans `app/api/tournaments/[id]/forfeit/route.ts`.
 *
 * L'appelant reste responsable de n'afficher le bouton que sur une équipe encore
 * en lice (statut `ACTIVE`).
 *
 * Sur un tournoi multi-phases, `format` doit porter le format de la **phase en
 * cours**, pas `MULTI` : c'est la phase qui détermine si l'abandon a un sens.
 */
export function canForfeitTeam(context: ForfeitContext, teamId: number): boolean {
  if (!FORMATS_WITH_FORFEIT.includes(context.format)) return false;
  if (context.state !== "RUNNING") return false;
  if (context.isAdmin) return true;
  return context.myTeamId === teamId && context.canCreateReportsForTeamIds.includes(teamId);
}

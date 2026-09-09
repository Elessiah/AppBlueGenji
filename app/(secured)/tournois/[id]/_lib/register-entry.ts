import type { TournamentDetail } from "@/lib/shared/types";

/**
 * Pourquoi le bouton d'inscription n'est-il pas là ?
 *
 * Le bouton se cache dès que `canRegister` est faux, et c'est la bonne règle :
 * pas de bouton grisé. Mais un cas mérite une phrase plutôt qu'un vide — le
 * joueur qui **a** une équipe, sur un tournoi dont les inscriptions **sont**
 * ouvertes, et qui n'a simplement pas la charge de l'engager. Les autres refus
 * se lisent seuls : les inscriptions fermées le disent en tête de page, une
 * équipe déjà inscrite figure dans la liste des engagées, et l'absence d'équipe
 * saute aux yeux de qui n'en a pas.
 *
 * Rend `null` quand il n'y a rien à expliquer. Le serveur reste le juge : cette
 * phrase double le refus (`NOT_TEAM_MANAGER`), elle ne le remplace pas.
 */
export function registerBlockedNotice(detail: TournamentDetail): string | null {
  if (detail.card.state !== "REGISTRATION") return null;
  if (detail.canRegister) return null;
  if (detail.canRegisterEntrant) return null;
  // Sans équipe active, le refus n'est pas celui-ci.
  if (detail.myTeamId === null) return null;
  // Déjà engagée : la question de qui l'inscrit ne se pose plus.
  if (detail.registrations.some((row) => row.teamId === detail.myTeamId)) return null;

  return "Seuls le propriétaire et les managers de ton équipe peuvent l'inscrire à un tournoi.";
}

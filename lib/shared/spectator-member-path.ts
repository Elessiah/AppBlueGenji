/**
 * Où un membre connecté, arrivé sur une page sans compte, est renvoyé : la page
 * du match de son espace pour `/suivre/tournois/<id>/matchs/<match>`, la fiche du
 * tournoi partout ailleurs. Commun au renvoi du serveur (chemin lu dans
 * `x-pathname`) et à son relais client (`usePathname`, quand une mise en page
 * préchargée est réutilisée sans ce en-tête).
 */
import { matchPageIdsFromSpectatorPath, matchPagePath } from "@/lib/shared/match-page";
import { memberTournamentPath } from "@/lib/shared/spectator-view";

/**
 * @param spectatorPath Chemin demandé, sans préfixe de langue ; `null` : inconnu.
 * @param tournamentId Tournoi de la mise en page (celui du chemin quand il est connu).
 */
export function memberPathForSpectatorPath(spectatorPath: string | null | undefined, tournamentId: number): string {
  const matchPage = matchPageIdsFromSpectatorPath(spectatorPath);
  return matchPage?.tournamentId === tournamentId
    ? matchPagePath(tournamentId, matchPage.matchId)
    : memberTournamentPath(tournamentId);
}

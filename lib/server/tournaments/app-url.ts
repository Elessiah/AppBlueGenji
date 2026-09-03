/**
 * Adresse publique d'une page de tournoi.
 *
 * Trois messages Discord la portent — le rappel de match, le signalement d'un
 * problème, l'alerte arbitre — et chacun l'avait réécrite pour son compte : même
 * variable, même nettoyage des barres obliques finales, trois exemplaires. Une
 * seule lecture d'`APP_URL` évite qu'un correctif (un chemin de base, un
 * changement de route) n'en oublie deux.
 *
 * `null` quand `APP_URL` n'est pas réglée : le site ne sait alors pas sous quel
 * nom il est servi, et un lien inventé vaut moins que pas de lien du tout — les
 * rédactions savent toutes s'en passer.
 */
export function tournamentPageUrl(tournamentId: number): string | null {
  const base = process.env.APP_URL?.trim().replace(/\/+$/, "");
  return base ? `${base}/tournois/${tournamentId}` : null;
}

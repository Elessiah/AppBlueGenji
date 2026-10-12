/**
 * Lien des règles d'un mode portant **un** tournoi (`/regles/<mode>?tournoi=<id>`),
 * et sa lecture côté page.
 *
 * Module à part, et sans dépendance : le bouton flottant « ? » de la fiche
 * (`RulesHelpFab`, composant client) n'importe que ce lien, sans tirer dans son
 * bundle le constructeur des réglages (`tournament-settings.ts`, serveur) ni ses
 * libellés et la configuration du moteur.
 */

/**
 * Lit l'identifiant de tournoi passé aux règles (`?tournoi=12`) : un entier
 * positif en base 10, rien d'autre — la valeur vient de l'URL.
 */
export function parseRulesTournamentParam(value: string | string[] | undefined): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string" || !/^[1-9]\d{0,15}$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) ? id : null;
}

/** Lien vers les règles d'un mode, portant le tournoi dont afficher les réglages. */
export function rulesHrefWithTournament(baseHref: string, tournamentId: number): string {
  return `${baseHref}?tournoi=${tournamentId}`;
}

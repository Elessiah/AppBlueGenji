/**
 * Colonne `swiss_round` d'une requête de manche : vraie quand la manche est une
 * ronde suisse — tournoi `SWISS`, ou phase suisse d'un `MULTI`.
 *
 * Les notifications nomment alors la manche « Ronde N » (`matchRoundLabel`,
 * `pushRoundLabel`), le mot que le site affiche sur la vue suisse
 * (`tournamentViews.json` → `swiss.roundNoun`) : « Manche 3 » dans un message
 * et « Ronde 3 » sur la page désigneraient deux choses au joueur.
 *
 * La phase se lit par sa clé primaire, et seulement quand la manche en a une
 * (`phase_id = 0` hors multi-phases) : aucune jointure ajoutée aux requêtes.
 *
 * @param match Alias de `bg_matches` dans la requête.
 * @param tournament Alias de `bg_tournaments` dans la requête.
 * @returns L'expression SQL, suivie de `AS swiss_round`.
 */
export function swissRoundSql(match: string, tournament: string): string {
  return (
    `(${tournament}.format = 'SWISS' OR (${match}.phase_id <> 0 AND EXISTS (` +
    `SELECT 1 FROM bg_tournament_phases sp WHERE sp.id = ${match}.phase_id AND sp.format = 'SWISS'))) AS swiss_round`
  );
}

/** La colonne `swiss_round` lue : MySQL rend un booléen en `0` / `1`. */
export function isSwissRound(row: { swiss_round?: unknown }): boolean {
  return Number(row.swiss_round ?? 0) === 1;
}

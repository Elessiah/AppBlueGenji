/**
 * D'où vient le BattleTag d'un compte (`bg_users.overwatch_battletag_typed`).
 *
 * Deux écrivains : la saisie du joueur sur `/profil`, et Blizzard au
 * rattachement comme à chaque connexion Battle.net. Un compte Battle.net qui
 * ne donne **aucun** BattleTag laisse en place celui que le joueur a tapé
 * (décision de l'utilisateur D3, 2026-10-29) : la colonne dit alors `1`, et ce
 * BattleTag n'est **jamais** tenu pour vérifié — ni contact certifié, ni
 * pastille, ni condition du cast ou de l'arbitrage. `0` : venu de Blizzard (ou
 * aucun BattleTag). Voir `docs/features/BATTLETAG_ORIGIN.md`.
 *
 * Les tags antérieurs à la colonne valent `0` sans remplissage : on ne sait pas
 * lesquels ont été tapés, et ils gardent la règle d'avant (Battle.net rattaché
 * et un BattleTag) jusqu'à la prochaine connexion Battle.net, qui réécrit la
 * colonne.
 */

/** Colonnes de `bg_users` que lit `battletagFromBlizzard`. */
export type BattletagOriginFields = {
  blizzard_sub: string | null;
  /** Absente d'une ligne lue sans elle : comme `0`. */
  overwatch_battletag_typed?: number | boolean | null;
};

/**
 * Battle.net rattaché **et** BattleTag stocké venu de lui — la moitié
 * « Battle.net » de `hasVerifiedBattletag` (`blizzardLinked`), qui y ajoute un
 * BattleTag non vide.
 */
export function battletagFromBlizzard(row: BattletagOriginFields): boolean {
  return row.blizzard_sub !== null && Number(row.overwatch_battletag_typed ?? 0) === 0;
}

/**
 * Même règle en SQL, sur l'alias `alias` de `bg_users` (constante du code,
 * jamais une entrée ; `""` sans alias).
 */
export function battletagFromBlizzardSql(alias = ""): string {
  const prefix = alias ? `${alias}.` : "";
  return `(${prefix}blizzard_sub IS NOT NULL AND ${prefix}overwatch_battletag_typed = 0)`;
}

/** BattleTag vérifié en SQL : `battletagFromBlizzardSql` et un BattleTag non vide. */
export function verifiedBattletagSql(alias = ""): string {
  const prefix = alias ? `${alias}.` : "";
  return `(${battletagFromBlizzardSql(alias)} AND COALESCE(${prefix}overwatch_battletag, '') <> '')`;
}

/**
 * Ce qu'écrit Blizzard (rattachement, connexion Battle.net), deux paramètres :
 * le BattleTag normalisé deux fois (`normalizeBattletag`, `null` s'il n'en
 * donne aucun). Le sien remplace toujours celui du joueur ; sans BattleTag, la
 * saisie reste, marquée tapée — jamais vérifiée. La seconde affectation ne lit
 * que son paramètre : l'ordre des `SET` n'y change rien.
 */
export const BLIZZARD_BATTLETAG_SET_SQL = `overwatch_battletag = COALESCE(?, overwatch_battletag),
           overwatch_battletag_typed = CASE WHEN ? IS NULL THEN 1 ELSE 0 END`;

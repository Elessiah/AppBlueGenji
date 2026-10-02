import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";

/** Une clé étrangère de la base, telle que `information_schema` la décrit. */
export type ForeignKeyRule = {
  table: string;
  column: string;
  parentTable: string;
  parentColumn: string;
  deleteRule: "CASCADE" | "SET NULL";
};

/**
 * Nombre maximal de passes du balayage des orphelins. Une passe efface les
 * enfants directs d'une ligne disparue ; leurs propres enfants (une phase, puis
 * ses équipes qualifiées) ne deviennent orphelins qu'à la passe suivante. La
 * chaîne la plus longue du schéma compte trois niveaux sous un tournoi : six
 * passes laissent une marge, et la boucle s'arrête dès qu'une passe ne touche
 * plus rien.
 */
export const ORPHAN_SWEEP_MAX_PASSES = 6;

// Ordre important : enfants (matchs, inscriptions, membres) avant parents.
const STEPS: { label: string; sql: string }[] = [
  { label: "matchs", sql: "DELETE FROM bg_matches WHERE tournament_id IN (SELECT id FROM bg_tournaments WHERE name LIKE 'Test -%')" },
  { label: "inscriptions", sql: "DELETE FROM bg_tournament_registrations WHERE tournament_id IN (SELECT id FROM bg_tournaments WHERE name LIKE 'Test -%')" },
  { label: "classements suisse", sql: "DELETE FROM bg_swiss_standings WHERE tournament_id IN (SELECT id FROM bg_tournaments WHERE name LIKE 'Test -%')" },
  { label: "classements survie", sql: "DELETE FROM bg_survival_standings WHERE tournament_id IN (SELECT id FROM bg_tournaments WHERE name LIKE 'Test -%')" },
  { label: "tournois", sql: "DELETE FROM bg_tournaments WHERE name LIKE 'Test -%'" },
  { label: "membres d'équipe", sql: "DELETE FROM bg_team_members WHERE team_id IN (SELECT id FROM bg_teams WHERE name LIKE 'Test -%')" },
  { label: "équipes", sql: "DELETE FROM bg_teams WHERE name LIKE 'Test -%'" },
  // Entrées solo (tournois individuels) : nommées d'après le pseudo du joueur,
  // elles ne portent pas le préfixe « Test - » des équipes. On vise aussi
  // celles dont le compte a déjà disparu (exécution précédente interrompue) :
  // sans ça elles resteraient à jamais, en réservant leur pseudo dans l'espace
  // de noms unique des équipes.
  { label: "entrées solo", sql: "DELETE t FROM bg_teams t LEFT JOIN bg_users u ON u.id = t.solo_user_id WHERE t.solo_user_id IS NOT NULL AND (u.id IS NULL OR u.pseudo LIKE 'Test%')" },
  { label: "sessions", sql: "DELETE FROM bg_user_sessions WHERE user_id IN (SELECT id FROM bg_users WHERE pseudo LIKE 'Test_%')" },
  { label: "joueurs", sql: "DELETE FROM bg_users WHERE pseudo LIKE 'Test_%'" },
  { label: "sponsors", sql: "DELETE FROM bg_sponsors WHERE name LIKE 'Test -%'" },
  { label: "annonces de recrutement", sql: "DELETE FROM bg_recruitment_ads WHERE title LIKE 'Test -%'" },
  { label: "membres du bureau", sql: "DELETE FROM bg_bureau_members" },
  // Équipes héritées préfixées « Team_ » (underscore échappé pour LIKE).
  { label: "matchs (équipes Team_)", sql: String.raw`DELETE FROM bg_matches WHERE team1_id IN (SELECT id FROM bg_teams WHERE name LIKE 'Team\_%') OR team2_id IN (SELECT id FROM bg_teams WHERE name LIKE 'Team\_%')` },
  { label: "inscriptions (équipes Team_)", sql: String.raw`DELETE FROM bg_tournament_registrations WHERE team_id IN (SELECT id FROM bg_teams WHERE name LIKE 'Team\_%')` },
  { label: "membres d'équipe (équipes Team_)", sql: String.raw`DELETE FROM bg_team_members WHERE team_id IN (SELECT id FROM bg_teams WHERE name LIKE 'Team\_%')` },
  { label: "équipes Team_", sql: String.raw`DELETE FROM bg_teams WHERE name LIKE 'Team\_%'` },
];

/** Échappe un identifiant MySQL lu dans `information_schema`. */
function quoteIdentifier(name: string): string {
  return `\`${name.replaceAll("`", "``")}\``;
}

/**
 * Requête qui rejoue, pour une clé étrangère, ce que son `ON DELETE` aurait
 * fait : effacer l'enfant (`CASCADE`) ou vider sa référence (`SET NULL`) quand
 * le parent n'existe plus.
 */
export function orphanSweepSql(fk: ForeignKeyRule): string {
  const child = quoteIdentifier(fk.table);
  const column = quoteIdentifier(fk.column);
  const parent = quoteIdentifier(fk.parentTable);
  const parentColumn = quoteIdentifier(fk.parentColumn);
  const orphan = `LEFT JOIN ${parent} p ON p.${parentColumn} = c.${column} WHERE c.${column} IS NOT NULL AND p.${parentColumn} IS NULL`;
  return fk.deleteRule === "CASCADE"
    ? `DELETE c FROM ${child} c ${orphan}`
    : `UPDATE ${child} c ${orphan.replace("WHERE", `SET c.${column} = NULL WHERE`)}`;
}

/** Clés étrangères à `ON DELETE CASCADE` ou `SET NULL` de la base courante. */
async function listForeignKeyRules(connection: PoolConnection): Promise<ForeignKeyRule[]> {
  const [rows] = await connection.query<(RowDataPacket & ForeignKeyRule)[]>(
    `SELECT k.TABLE_NAME AS \`table\`, k.COLUMN_NAME AS \`column\`,
            k.REFERENCED_TABLE_NAME AS parentTable, k.REFERENCED_COLUMN_NAME AS parentColumn,
            r.DELETE_RULE AS deleteRule
       FROM information_schema.KEY_COLUMN_USAGE k
       JOIN information_schema.REFERENTIAL_CONSTRAINTS r
         ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA
        AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
        AND r.TABLE_NAME = k.TABLE_NAME
      WHERE k.TABLE_SCHEMA = DATABASE()
        AND k.REFERENCED_TABLE_NAME IS NOT NULL
        AND r.DELETE_RULE IN ('CASCADE', 'SET NULL')
      ORDER BY k.TABLE_NAME, k.COLUMN_NAME`,
  );
  return rows.map((row) => ({
    table: row.table,
    column: row.column,
    parentTable: row.parentTable,
    parentColumn: row.parentColumn,
    deleteRule: row.deleteRule,
  }));
}

/**
 * Rejoue les `ON DELETE` que `FOREIGN_KEY_CHECKS=0` a désarmés.
 *
 * Les suppressions du nettoyage tournent clés étrangères coupées : sans ce
 * balayage, chaque exécution laissait orphelines les lignes que les cascades
 * auraient emportées — phases et équipes qualifiées, classements d'endurance,
 * rappels de match… — et la base locale en accumulait des milliers. Lire les
 * règles dans `information_schema` plutôt que d'en tenir la liste couvre aussi
 * les tables à venir, et efface du même geste les orphelins laissés par les
 * exécutions antérieures au correctif. Une clé `RESTRICT` n'est pas rejouée :
 * elle aurait refusé la suppression, pas suivi.
 *
 * @returns le nombre de lignes effacées ou détachées.
 */
export async function sweepOrphans(connection: PoolConnection): Promise<number> {
  const rules = await listForeignKeyRules(connection);
  let total = 0;
  for (let pass = 0; pass < ORPHAN_SWEEP_MAX_PASSES; pass++) {
    let touched = 0;
    for (const rule of rules) {
      const [result] = await connection.execute<ResultSetHeader>(orphanSweepSql(rule));
      touched += result.affectedRows;
    }
    total += touched;
    if (touched === 0) break;
  }
  return total;
}

// Supprime toutes les données générées par une exécution précédente du seed
// (équipes, joueurs, tournois, sponsors), identifiées par les préfixes de test
// `Test -%` / `Test_%`. Chaque suppression est indépendante : l'échec de l'une
// ne doit jamais empêcher les autres (sinon des équipes resteraient orphelines).
export async function clearDatabase(db: Pool): Promise<void> {
  console.log("🧹 Nettoyage des données test existantes...");

  // Une connexion **dédiée** : `FOREIGN_KEY_CHECKS` vaut pour la session, et
  // passer par le pool l'aurait coupé sur une connexion, fait tourner les
  // suppressions sur d'autres, puis rétabli sur une troisième — laissant au
  // pool une connexion clés coupées pour la suite du seed.
  const connection = await db.getConnection();
  try {
    await connection.execute("SET FOREIGN_KEY_CHECKS=0");

    for (const step of STEPS) {
      try {
        const [result] = await connection.execute<ResultSetHeader>(step.sql);
        if (result.affectedRows > 0) {
          console.log(`  ✓ ${result.affectedRows} ${step.label} supprimé(s)`);
        }
      } catch (error) {
        console.error(`  ✗ ${step.label}:`, (error as Error).message);
      }
    }

    try {
      const swept = await sweepOrphans(connection);
      if (swept > 0) console.log(`  ✓ ${swept} ligne(s) orpheline(s) effacée(s) ou détachée(s)`);
    } catch (error) {
      console.error("  ✗ orphelins:", (error as Error).message);
    }

    console.log("  ✓ Base nettoyée");
  } finally {
    try {
      await connection.execute("SET FOREIGN_KEY_CHECKS=1");
    } finally {
      connection.release();
    }
  }
}

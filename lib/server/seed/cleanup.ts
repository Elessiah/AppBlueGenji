import type { Pool, ResultSetHeader } from "mysql2/promise";

// Supprime toutes les données générées par une exécution précédente du seed
// (équipes, joueurs, tournois, sponsors), identifiées par les préfixes de test
// `Test -%` / `Test_%`. Chaque suppression est indépendante : l'échec de l'une
// ne doit jamais empêcher les autres (sinon des équipes resteraient orphelines).
export async function clearDatabase(db: Pool): Promise<void> {
  console.log("🧹 Nettoyage des données test existantes...");

  // Ordre important : enfants (matchs, inscriptions, membres) avant parents.
  const steps: { label: string; sql: string }[] = [
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

  try {
    await db.execute("SET FOREIGN_KEY_CHECKS=0");

    for (const step of steps) {
      try {
        const [result] = await db.execute<ResultSetHeader>(step.sql);
        if (result.affectedRows > 0) {
          console.log(`  ✓ ${result.affectedRows} ${step.label} supprimé(s)`);
        }
      } catch (error) {
        console.error(`  ✗ ${step.label}:`, (error as Error).message);
      }
    }

    console.log("  ✓ Base nettoyée");
  } finally {
    await db.execute("SET FOREIGN_KEY_CHECKS=1");
  }
}

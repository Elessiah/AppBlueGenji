import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..", "..");
const sql = readFileSync(join(ROOT, "lib", "server", "database.ts"), "utf8");

/**
 * Le schéma, **tel qu'il est** — et non l'histoire de la façon dont on y est
 * arrivé.
 *
 * Soixante-trois `ALTER TABLE` s'étaient empilés au fil des fonctionnalités,
 * chacun dans son `try {} catch {}` parce qu'il devait retomber en silence sur
 * une base qui l'avait déjà subi. Les replier dans les `CREATE TABLE` n'est sans
 * danger que parce que la production porte déjà le schéma complet : sur une base
 * existante, `CREATE TABLE IF NOT EXISTS` ne rattrape ni colonne ni index.
 *
 * Ce contrôle est au niveau source — les migrations tournent contre un vrai
 * MySQL, qu'aucun test unitaire n'exerce. Ce qu'il tient est ce qu'une relecture
 * laisserait passer : qu'une colonne repliée figure bien dans sa table, et
 * qu'aucune des deux familles d'instructions ne reparte à la dérive.
 */

/** La définition d'une table, du `CREATE` à son point-virgule de fin. */
function table(name: string): string {
  const start = sql.indexOf(`CREATE TABLE IF NOT EXISTS ${name} (`);
  expect(start).toBeGreaterThan(-1);
  return sql.slice(start, sql.indexOf("`);", start));
}

describe("Schéma — les colonnes autrefois ajoutées par ALTER vivent dans leur table", () => {
  it.each([
    ["bg_users", ["discord_pseudo", "discord_verified_at", "blizzard_sub", "platform_roles_json", "open_to_recruitment", "is_deleted"]],
    ["bg_teams", ["tag", "description", "is_ghost", "solo_user_id", "deleted_at"]],
    ["bg_discord_login_challenges", ["handle"]],
    ["bg_matches", ["phase_id", "swiss_round", "is_bye", "team1_placeholder", "forfeit_team_id", "start_at", "live_trigger", "live_started_at"]],
    ["bg_swiss_standings", ["phase_id", "seed", "status", "forfeit_round"]],
    ["bg_survival_standings", ["phase_id"]],
    ["bg_endurance_standings", ["draws"]],
    ["bg_benevoles", ["category_order"]],
  ])("%s", (name, columns) => {
    const definition = table(name);
    for (const column of columns) {
      expect(definition).toContain(column);
    }
  });

  it("bg_tournaments porte les réglages des quatre moteurs", () => {
    const definition = table("bg_tournaments");
    for (const column of [
      "game",
      "participant_type",
      "has_third_place_match",
      "manual_seeding",
      "registration_discord_requirement",
      "registration_min_players",
      "match_format_type",
      "match_format_max_maps",
      "match_format_draws",
      "swiss_tiebreakers_json",
      "survival_barrage_rounds",
      "endurance_playoffs_started",
      "endurance_playoff_format_value",
      "current_phase_id",
      "live_url",
    ]) {
      expect(definition).toContain(column);
    }
  });
});

describe("Schéma — les ENUM sont à leur état final", () => {
  it("le format d'un tournoi connaît les six modes", () => {
    expect(table("bg_tournaments")).toContain(
      "ENUM('SINGLE', 'DOUBLE', 'SWISS', 'SURVIVAL', 'MULTI', 'BG_SURVIE')",
    );
  });

  it("le jeu ne connaît plus « OW2 », renommé en « OW »", () => {
    expect(sql).not.toContain("OW2");
  });

  it("le tableau d'un match connaît la petite finale", () => {
    expect(table("bg_matches")).toContain("ENUM('UPPER', 'LOWER', 'GRAND', 'THIRD_PLACE')");
  });

  it("le mode d'antenne connaît START_TIME", () => {
    expect(table("bg_matches")).toContain("ENUM('AUTO', 'START_TIME', 'MANUAL')");
  });

  it("le classement d'endurance connaît « hors course »", () => {
    expect(table("bg_endurance_standings")).toContain("'OUT_OF_CONTENTION'");
  });

  it("le canal de contact d'une annonce ne connaît plus l'e-mail", () => {
    expect(table("bg_recruitment_ads")).toContain("ENUM('AUTO', 'DISCORD', 'LINK')");
    expect(table("bg_recruitment_ads")).not.toContain("contact_email");
  });
});

describe("Schéma — les clés primaires portent la phase", () => {
  it.each(["bg_swiss_standings", "bg_survival_standings"])("%s", (name) => {
    expect(table(name)).toContain("PRIMARY KEY (tournament_id, phase_id, team_id)");
  });

  it("l'endurance n'a pas de phase — le mode ne se joue pas en multi-phases", () => {
    expect(table("bg_endurance_standings")).toContain("PRIMARY KEY (tournament_id, team_id)");
  });
});

describe("Schéma — les index repliés sont bien là", () => {
  it.each([
    ["bg_matches", "idx_bg_matches_phase (tournament_id, phase_id)"],
    ["bg_matches", "idx_bg_matches_live (live_trigger, status)"],
    ["bg_teams", "uniq_bg_teams_tag (tag)"],
    ["bg_teams", "uniq_bg_teams_solo_user (solo_user_id)"],
  ])("%s → %s", (name, index) => {
    expect(table(name)).toContain(index);
  });
});

describe("Schéma — l'adresse e-mail a disparu", () => {
  it("ne figure dans aucune table", () => {
    expect(table("bg_users")).not.toContain("email");
  });

  it("est retirée des bases existantes par un ALTER, que le fichier porte encore", () => {
    expect(sql).toContain("ALTER TABLE bg_users DROP COLUMN email");
  });
});

describe("Schéma — la règle des deux endroits", () => {
  /**
   * Une colonne **récente** — dont on ne peut pas affirmer que la production l'a
   * déjà jouée — s'écrit **deux fois** : dans le `CREATE TABLE` pour une base
   * neuve, et en `ALTER` pour celle qui tourne. Un `CREATE TABLE IF NOT EXISTS`
   * n'ajoute rien à une table présente, il ne fait rien du tout.
   *
   * Oublier la seconde moitié ne casse aucun test qui lirait la seule table : la
   * panne est au **redémarrage de la production**, sur une requête qui nomme la
   * colonne, et il est alors trop tard pour la reposer sans interruption.
   */
  const RECENT = [
    ["bg_discord_login_challenges", "handle"],
    ["bg_users", "discord_verified_at"],
    ["bg_users", "blizzard_sub"],
    ["bg_tournaments", "registration_discord_requirement"],
    ["bg_tournaments", "registration_min_players"],
    ["bg_tournaments", "registration_blizzard_requirement"],
  ] as const;

  // Bornée aux deux extrémités : après elle vivent les « rattrapages
  // permanents », qui gardent volontairement un `catch` muet.
  const migrations = sql.slice(
    sql.indexOf("const RECENT_COLUMNS"),
    sql.indexOf("// Rattrapages permanents"),
  );

  it.each(RECENT)("%s.%s est dans la table neuve", (tableName, column) => {
    expect(table(tableName)).toContain(column);
  });

  it.each(RECENT)("%s.%s est aussi dans la liste des migrations", (tableName, column) => {
    expect(migrations).toMatch(
      new RegExp(`"${tableName}",\\s*\n?\\s*"${column}"|\\["${tableName}", "${column}"`),
    );
  });

  it("joue la liste par un seul ALTER paramétré", () => {
    expect(sql).toContain(
      "ALTER TABLE ${table} ADD COLUMN ${column} ${definition}",
    );
  });

  it("ne laisse aucun échec de migration passer en silence", () => {
    // Un droit `ALTER` manquant ou un verrou de métadonnées laisserait le schéma
    // en arrière du code : la base démarre, et la panne se lit plus tard sur une
    // requête qui nomme la colonne. Les deux migrations passent donc par le même
    // rapporteur.
    //
    // Le contrôle porte sur la **section des migrations** seule : les
    // `CREATE TABLE` des tables de notification et les deux rattrapages
    // permanents gardent leur `catch` muet, et c'est voulu — un rappel perdu
    // vaut mieux qu'un report de score en erreur.
    expect([...migrations.matchAll(/reportSchemaFailure\(error, /g)]).toHaveLength(2);
    expect(migrations).not.toMatch(/catch\s*\{\s*\/\/[^\n]*\n\s*\}/);
  });

  it("ne fait pourtant pas tomber le démarrage avec elle", () => {
    // Relancer ferait 500 sur **toute** requête : `createOnceGate` n'a pas de
    // mémoire de l'échec, la passe entière se rejoue à chaque appel sans recul,
    // et les autres processus expirent sur le verrou nommé. Un dépassement de
    // délai de verrou sur `bg_users` suffit à y entrer, et il est transitoire.
    const reporter = sql.slice(
      sql.indexOf("function reportSchemaFailure"),
      sql.indexOf("async function runMigrations"),
    );
    expect(reporter).toContain("console.error");
    expect(reporter).not.toContain("throw");
  });

  it("ne relâche pas la garde sur le DROP, qui **est** l'effacement", () => {
    // Rien ne lit plus `email`, donc la base démarre parfaitement sans le DROP —
    // et `anonymizeOwnAccount` ne met plus l'adresse à NULL. Un ALTER refusé et
    // avalé garderait les adresses indéfiniment, y compris sur les comptes qui
    // ont demandé leur suppression.
    const drop = sql.slice(sql.indexOf("DROP COLUMN email"));
    expect(drop.slice(0, 200)).toContain("reportSchemaFailure");
  });

  it("ne journalise rien sur le cas nominal, qui se produit à chaque démarrage", () => {
    // Une ligne par entrée à chaque redémarrage noierait la seule qui compte.
    const reporter = sql.slice(sql.indexOf("function reportSchemaFailure"));
    expect(reporter.slice(0, 400)).toContain("if (isSchemaNoOpError(error)) return;");
  });
});

describe("Schéma — ce qui reste à côté des CREATE", () => {
  it("ne garde que les migrations pas encore jouées en production", () => {
    // Le compte se fait sur les lignes de **code**, commentaires écartés : ils
    // parlent des soixante-trois ALTER repliés. Et il ne s'accroche pas à une
    // forme d'écriture — l'ancienne version cherchait `db.execute(\`ALTER`, si
    // bien qu'une migration posée sur plusieurs lignes ne comptait pas et que
    // l'assertion restait verte en ne voyant rien.
    const code = sql
      .split("\n")
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .join("\n");
    // Deux seulement : la boucle paramétrée des colonnes récentes, et le retrait
    // de l'adresse e-mail. Les libellés passés au rapporteur d'échec citent la
    // même instruction sans l'exécuter — ils ne comptent pas.
    const statements = code
      .split("\n")
      .filter((line) => line.includes("ALTER TABLE") && !line.includes("reportSchemaFailure"));
    expect(statements).toHaveLength(2);
    expect(code).toContain("ALTER TABLE bg_users DROP COLUMN email");
  });

  it("garde les deux rattrapages permanents, dont la cause peut se reproduire", () => {
    // L'invitation Discord périmée en pied de page, et le logo d'une entrée solo
    // qui republierait un avatar masqué.
    expect(sql).toContain("SUPERSEDED_DISCORD_INVITE_URLS");
    expect(sql).toContain("SET t.logo_url = NULL");
  });

  it("ne rejoue plus les rattrapages d'une conversion déjà faite", () => {
    for (const gone of [
      "information_schema",
      "SET tag = UPPER(tag)",
      "SET visible_pseudo = 1",
      "ROW_NUMBER() OVER",
      "CHANGE COLUMN game domain",
    ]) {
      expect(sql).not.toContain(gone);
    }
  });
});

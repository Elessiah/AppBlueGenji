import { describe, expect, it } from "@jest/globals";
import { declaredColumns } from "@/lib/server/database";
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
    ["bg_team_invitations", ["roles_json"]],
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
    // Sur le **SQL** et non sur le fichier entier : le filet de schéma explique
    // en commentaire pourquoi il surveille cette conversion, et nommer la
    // valeur périmée y est le propos.
    expect(table("bg_tournaments")).toContain("ENUM('OW', 'MR')");
    // Sur le **DDL** seul : le filet de schéma nomme la valeur périmée pour la
    // surveiller (`forbid`), et son commentaire l'explique — les deux sont le
    // propos, pas une survivance.
    const ddl = sql
      .slice(0, sql.indexOf("async function warnIfSchemaIsBehind"))
      .split("\n")
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .join("\n");
    expect(ddl).not.toContain("'OW2'");
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
  // Bornée aux deux extrémités : après elle vivent les « rattrapages
  // permanents », qui gardent volontairement un `catch` muet.
  const migrations = sql.slice(
    sql.indexOf("const RECENT_SCHEMA_CHANGES"),
    sql.indexOf("// Rattrapages permanents"),
  );

  /**
   * La liste est **lue dans la source**, jamais recopiée ici.
   *
   * Une copie à la main ne peut pas voir l'oubli qu'elle est censée empêcher :
   * ajouter une colonne au seul `CREATE TABLE` laisse la copie inchangée, donc
   * tous les tests verts, et la production tombe au redémarrage. Dériver de la
   * source ferme au moins le sens qui se vérifie — toute migration annoncée doit
   * exister dans sa table.
   *
   * L'autre sens ne se ferme pas au niveau de la source : rien dans le fichier
   * ne dit d'une colonne qu'elle est « récente ». C'est un jugement de
   * déploiement, et c'est pourquoi `docs/DATABASE_SCHEMA.md` en fait une règle
   * écrite plutôt qu'une assertion.
   */
  const RECENT = [...migrations.matchAll(/ALTER TABLE (\w+) ADD COLUMN\s+(\w+)/g)].map(
    (m) => [m[1], m[2]] as const,
  );

  it("lit une liste non vide — sinon les cas ci-dessous ne prouveraient rien", () => {
    expect(RECENT.length).toBeGreaterThanOrEqual(6);
  });

  it("toute colonne annoncée en migration existe dans sa table neuve", () => {
    const orphans = RECENT.filter(([tableName, column]) => !table(tableName).includes(column));
    expect(orphans).toEqual([]);
  });

  it("couvre bien les trois PR postérieures au dernier déploiement connu", () => {
    // Nommées ici parce que leur *absence* est le défaut à voir : une entrée
    // retirée par anticipation ne laisse aucune trace ailleurs.
    const names = RECENT.map(([t, c]) => `${t}.${c}`);
    expect(names).toEqual(
      expect.arrayContaining([
        "bg_discord_login_challenges.handle",
        "bg_users.discord_verified_at",
        "bg_users.blizzard_sub",
        "bg_tournaments.registration_discord_requirement",
        "bg_tournaments.registration_min_players",
        "bg_tournaments.registration_blizzard_requirement",
        "bg_team_invitations.roles_json",
      ]),
    );
  });

  it("porte des instructions entières, et non des triplets table/colonne/type", () => {
    // Un triplet ne sait dire qu'`ADD COLUMN` : la règle des deux endroits ne
    // s'appliquait alors ni à un `ENUM` élargi, ni à un index posé, ni à une clé
    // primaire recomposée. La prochaine valeur de `format` n'aurait existé que
    // dans le `CREATE TABLE`, et la base qui tourne aurait rendu « Data
    // truncated » sur le premier tournoi créé.
    expect(migrations).toContain("const RECENT_SCHEMA_CHANGES: readonly string[]");
    expect(migrations).toContain("await db.execute(statement);");
  });

  it("ne pose lancés, au déploiement, que les matchs déjà jouables", () => {
    // Un match programmé plus tard doit passer par son lancement à l'heure
    // dite : le lancer d'office au déploiement ferait taire la modale et les
    // « Prêt » pour lui (`lib/shared/match-launch.ts`).
    const backfill = migrations.slice(migrations.indexOf("const launchedAtStatement"));
    const update = backfill.slice(backfill.indexOf("UPDATE bg_matches"), backfill.indexOf("} catch"));
    expect(update).toMatch(/status = 'READY' AND \(start_at IS NULL OR start_at <= NOW\(\)\)/);
    expect(update).toContain("launch_pairing = CONCAT(team1_id, ':', team2_id)");
    expect(update).not.toContain("status <> 'PENDING'");
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
    // Huit : la boucle des changements récents, les quatre retraits de colonne,
    // les deux reports qui précèdent un retrait (`user_id` → `authenticated`
    // des visites, `highlight` → `priority` des annonces de recrutement), et
    // `launched_at`, dont le remplissage ne suit que l'ajout effectif.
    expect([...migrations.matchAll(/reportSchemaFailure\(error, /g)]).toHaveLength(8);
    expect(migrations).not.toMatch(/catch\s*\{\s*\}/);
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
    expect(reporter.slice(0, 500)).toContain("if (isSchemaNoOpError(error, statement)) return;");
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
    // Trois seulement, et le test nomme lesquelles plutôt que de compter : la
    // boucle paramétrée des colonnes récentes, et les deux **retraits**, qui
    // n'ont aucune contrepartie dans un `CREATE TABLE` et ne pouvaient donc pas
    // être repliés. Les libellés passés au rapporteur d'échec citent la même
    // instruction sans l'exécuter — ils ne comptent pas.
    const drops = code
      .split("\n")
      .filter(
        (line) =>
          /\bALTER TABLE \w+ DROP COLUMN/.test(line) && !line.includes("reportSchemaFailure"),
      )
      .map((line) => line.trim());
    expect(drops).toEqual([
      "await db.execute(`ALTER TABLE bg_recruitment_ads DROP COLUMN contact_email`);",
      'const DROP_EMAIL = "ALTER TABLE bg_users DROP COLUMN email";',
      // Les visites ne désignent plus de compte : seul `authenticated` reste.
      'const DROP_VISIT_USER = "ALTER TABLE bg_site_visits DROP COLUMN user_id";',
      // La mise en avant d'une annonce est devenue un statut d'importance.
      'const DROP_RECRUITMENT_HIGHLIGHT = "ALTER TABLE bg_recruitment_ads DROP COLUMN highlight";',
    ]);
    // Et la liste des changements récents, jouée par la boucle.
    expect(code).toContain("for (const statement of RECENT_SCHEMA_CHANGES)");
    expect(code).toContain("await db.execute(DROP_EMAIL);");
    expect(code).toContain("await db.execute(DROP_VISIT_USER);");
    expect(code).toContain("await db.execute(DROP_RECRUITMENT_HIGHLIGHT);");
  });

  it("reporte la mise en avant des annonces en statut avant de retirer la colonne", () => {
    const section = sql.slice(
      sql.indexOf("SET priority = CASE highlight"),
      sql.indexOf("await db.execute(DROP_RECRUITMENT_HIGHLIGHT);"),
    );
    // Modale → prioritaire, banderole → importante ; le reste garde le défaut.
    expect(section).toContain("WHEN 'MODAL' THEN 'PRIORITY' WHEN 'BANNER' THEN 'IMPORTANT' ELSE priority END");
    // Le report consomme sa source dans la même instruction, **après** l'avoir
    // lue : rejoué après un DROP refusé, il ne trouverait plus rien et ne
    // pourrait pas écraser un statut choisi depuis.
    expect(section.indexOf("SET priority =")).toBeLessThan(section.indexOf("highlight = 'NONE'"));
    expect(section).toContain("WHERE highlight <> 'NONE'");
    // Le retrait attend un report réussi (ou une source déjà partie) : sinon il
    // emporterait la seule trace de ce qui était mis en avant.
    expect(section).toContain("if (highlightCarriedOver) {");
    expect(section).toContain(".includes(\"'highlight'\")");
  });

  it("déclare le statut dans la table neuve et l'ajoute aux bases qui tournent", () => {
    expect(table("bg_recruitment_ads")).toContain(
      "priority ENUM('PRIORITY', 'IMPORTANT', 'OPTIONAL') NOT NULL DEFAULT 'OPTIONAL'",
    );
    expect(table("bg_recruitment_ads")).not.toContain("highlight");
    expect(sql).toMatch(/ALTER TABLE bg_recruitment_ads ADD COLUMN priority\s+ENUM\('PRIORITY', 'IMPORTANT', 'OPTIONAL'\)/);
  });

  it("garde les trois tables tolérantes, dont des chemins accessoires dépendent", () => {
    // `isMissingTableError` décrit ce contrat, et `deletion.ts` / `rollback.ts` /
    // les chemins de notification s'y appuient : un rappel, une alerte ou une
    // sanction perdus valent mieux qu'un démarrage qui tombe.
    for (const tableName of [
      "bg_match_reminders",
      "bg_referee_alerts",
      "bg_endurance_penalties",
    ]) {
      const before = sql.slice(0, sql.indexOf(`CREATE TABLE IF NOT EXISTS ${tableName}`));
      expect(before.slice(-60)).toContain("try {");
    }
  });

  it("garde les deux rattrapages permanents, dont la cause peut se reproduire", () => {
    // L'invitation Discord périmée en pied de page, et le logo d'une entrée solo
    // qui republierait un avatar masqué.
    expect(sql).toContain("SUPERSEDED_DISCORD_INVITE_URLS");
    expect(sql).toContain("SET t.logo_url = NULL");
  });

  it("ne rejoue plus les rattrapages d'une conversion déjà faite", () => {
    for (const gone of [
      "SET tag = UPPER(tag)",
      "SET visible_pseudo = 1",
      "ROW_NUMBER() OVER",
      "CHANGE COLUMN game domain",
    ]) {
      expect(sql).not.toContain(gone);
    }
  });

  it("ne lit `information_schema` pour migrer qu'à l'endroit où rien d'autre ne peut répondre", () => {
    // L'ancien fichier l'interrogeait pour décider s'il devait jouer un
    // rattrapage — une lecture par démarrage et par cas. Le contrôle portait
    // donc « aucune lecture hors du filet », et c'est l'invariant qu'il tenait.
    //
    // Il en reste **une**, et elle ne ressemble pas aux anciennes : la règle de
    // `fk_bg_team_inv_creator` ne se déduit d'aucun `try` tolérant. Une clef
    // étrangère se remplace en trois instructions dont aucune n'est idempotente,
    // et « c'est déjà fait » ne se lit ni sur un code d'erreur ni sur la
    // nullabilité de la colonne (elle bascule à la deuxième des trois, donc une
    // passe interrompue se croirait terminée). `DELETE_RULE` est le seul endroit
    // qui dise la vérité : la clef existe **et** dit ce qu'il faut.
    //
    // Le contrôle garde donc son objet — on ne relit pas `information_schema`
    // pour décider d'un `ADD COLUMN` — en nommant l'exception plutôt qu'en
    // levant le compte, sans quoi il ne verrait plus rien revenir.
    const reads = [...sql.matchAll(/FROM information_schema/gi)];
    expect(reads).toHaveLength(5);

    const net = sql.slice(sql.indexOf("async function warnIfSchemaIsBehind"));
    expect([...net.matchAll(/FROM information_schema/gi)]).toHaveLength(4);
    expect(net).toContain("information_schema.STATISTICS");
    expect(net).toContain("information_schema.COLUMNS");
    expect(net).toContain("console.error");

    // La cinquième, et le fait qu'elle soit **seule** hors du filet.
    const migrations = sql.slice(0, sql.indexOf("async function warnIfSchemaIsBehind"));
    const outside = [...migrations.matchAll(/FROM\s+information_schema\.(\w+)/gi)].map((m) => m[1]);
    expect(outside).toEqual(["REFERENTIAL_CONSTRAINTS"]);
    expect(migrations).toContain("CONSTRAINT_NAME = 'fk_bg_team_inv_creator'");
  });

  it("voit les trois classes de retard, et pas seulement la colonne absente", () => {
    // Une colonne **présente mais du mauvais type** est le cas qu'un simple
    // contrôle de présence ne peut pas voir : une base restée avant la
    // conversion du jeu porte bien `game`, et rend « Data truncated » au premier
    // tournoi écrit. Une colonne qui devait **partir** est la classe symétrique,
    // et c'est celle des adresses e-mail.
    const net = sql.slice(sql.indexOf("async function warnIfSchemaIsBehind"));
    expect(net).toContain("COLUMN_TYPE");
    expect(net).toContain('{ table: "bg_users", column: "email", absent: true }');
    expect(net).toContain('expect: "\'OW\'"');
  });

  it("surveille le retrait de l'adresse, que rien d'autre ne rattrape", () => {
    // Le `DROP` est best-effort et n'est jamais rejoué dans le processus, la
    // porte mémorisant une passe qui se résout toujours ; et
    // `anonymizeOwnAccount` a perdu son `email = NULL` dans la même version.
    const net = sql.slice(sql.indexOf("async function warnIfSchemaIsBehind"));
    expect(net).toContain("la colonne reste à retirer à la main");
    // Le filet ne lit qu'`information_schema` : il ne sait **pas** si des
    // adresses subsistent, et l'affirmer se contredisait avec le repli qui
    // venait de les vider, dans le même démarrage.
    expect(net).not.toContain("les adresses y sont encore");
  });

  it("surveille aussi les index, que `COLUMNS` ne montre pas", () => {
    // L'absence d'un index unique est la plus silencieuse de toutes : elle ne
    // fait rien tomber, elle cesse seulement de trancher la course qu'il existe
    // pour trancher — deux équipes créées au même instant prendraient le même
    // sigle, et `mapTeamTagConflict` traduirait un `ER_DUP_ENTRY` qui n'arrive
    // plus jamais.
    const net = sql.slice(sql.indexOf("async function warnIfSchemaIsBehind"));
    expect(net).toContain("uniq_bg_teams_tag");
    expect(net).toContain("uniq_bg_teams_solo_user");
  });

  it("surveille la largeur des clés primaires à phase, que rien ne fait tomber", () => {
    // `phase_id` présent mais la clé restée à `(tournament_id, team_id)` ne lève
    // nulle part : le classement de la phase 2 d'un tournoi `MULTI` **écrase**
    // la ligne de la phase 1 pour la même équipe. Un écrasement silencieux est
    // exactement ce qu'un filet doit rendre bruyant.
    const net = sql.slice(sql.indexOf("async function warnIfSchemaIsBehind"));
    expect(net).toContain("INDEX_NAME = 'PRIMARY'");
    expect(net).toContain("bg_swiss_standings");
    expect(net).toContain("bg_survival_standings");
    expect(net).toMatch(/n\s*<\s*3/);
  });

  it("vide la liste retenue au début de chaque passe", () => {
    // `createOnceGate` oublie ses échecs : une passe interrompue se rejoue dans
    // le même processus. Sans remise à zéro, `createTable` empilerait une
    // seconde copie de chaque DDL, et le filet annoncerait deux fois chaque
    // colonne manquante — avec un compte deux fois trop grand.
    const run = sql.slice(sql.indexOf("async function runMigrations"));
    const head = run.slice(0, run.indexOf("await createTable"));
    expect(head).toContain("DECLARED_TABLES.length = 0");
  });

  it("dérive les colonnes surveillées du fichier au lieu de les choisir", () => {
    // Cinq témoins écrits à la main sur ~70 `ALTER` repliés laissaient
    // soixante-cinq façons d'être en retard sans que rien ne le dise. La liste
    // vient désormais des `CREATE TABLE` que `createTable` retient.
    expect(sql).toContain("const DECLARED_TABLES");
    const net = sql.slice(sql.indexOf("async function warnIfSchemaIsBehind"));
    expect(net).toContain("DECLARED_TABLES.map(declaredColumns)");
    // Une table entièrement absente n'est pas un retard : trois d'entre elles
    // sont volontairement tolérées, et les `CREATE` viennent de passer.
    expect(net).toContain("tables.has(");
  });

  it("ne jette pas les constats d'une sonde quand l'autre échoue", () => {
    // Les deux sondes sont indépendantes ; partageant un `try`, l'échec de la
    // seconde emportait ce que la première venait d'établir — dont « les
    // adresses sont encore là », qui est la raison d'être du filet.
    const net = sql.slice(sql.indexOf("async function warnIfSchemaIsBehind"));
    expect([...net.matchAll(/\btry \{/g)].length).toBeGreaterThanOrEqual(2);
    // Le tableau des constats est déclaré **avant** les `try`, et le rapport
    // vient après : il doit dire ce qu'on sait, même partiellement.
    expect(net.indexOf("const gaps: string[] = []")).toBeLessThan(net.indexOf("try {"));
    expect(net.lastIndexOf("} catch {")).toBeLessThan(net.indexOf("if (gaps.length > 0)"));
  });

  it("distingue une base à demi convertie d'une base à jour", () => {
    // `enum('OW2','MR','OW')` contient bien `'OW'` : la présence de la valeur
    // neuve ne prouve rien, c'est l'**absence** de l'ancienne qui tranche.
    const net = sql.slice(sql.indexOf("async function warnIfSchemaIsBehind"));
    expect(net).toContain("forbid: \"'OW2'\"");
  });

  it("vide les adresses quand le retrait de la colonne échoue", () => {
    // Le `DROP` est le seul effaceur restant, `anonymizeOwnAccount` ayant perdu
    // son `email = NULL`. Un repli sans DDL n'obtient pas le même résultat — la
    // colonne survit — mais il obtient le seul qui soit urgent.
    const drop = sql.slice(sql.indexOf("const DROP_EMAIL"));
    expect(drop.slice(0, 900)).toContain("UPDATE bg_users SET email = NULL WHERE email IS NOT NULL");
  });

  it("le filet ne devient jamais la panne qu'il signale", () => {
    // Une base qui refuse `information_schema` doit rester servie comme avant,
    // et un retard de schéma ne s'éteint pas en interrompant le démarrage : cela
    // remplacerait un site dégradé par un site mort.
    const net = sql.slice(sql.indexOf("async function warnIfSchemaIsBehind"));
    expect(net.slice(0, net.indexOf("\n}"))).toMatch(/catch\s*\{/);
    expect(net.slice(0, net.indexOf("\n}"))).not.toContain("throw");
  });
});

describe("Schéma — la liste des colonnes se lit sur le CREATE, pas sur ses lignes", () => {
  /**
   * Le filet ne vaut que s'il se **tait sur une base saine**. Trois écritures
   * parfaitement ordinaires d'un `CREATE TABLE` fabriquaient chacune une colonne
   * qui n'existe pas, donc une alerte de retard sur un schéma à jour — et un
   * filet qui crie au loup est un filet qu'on éteint. Les trois cas ci-dessous
   * ont été observés, dans cet ordre, contre une vraie base.
   */

  it("nomme la table et ses colonnes ordinaires", () => {
    const parsed = declaredColumns(`CREATE TABLE IF NOT EXISTS bg_demo (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(80) NOT NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uniq_demo_name (name),
      KEY idx_demo_name (name)
    )`);
    // Les clauses de clé ne sont pas des colonnes : leur premier mot suffit à les
    // écarter, et c'est pourquoi la liste des mots réservés existe.
    expect(parsed).toEqual({ table: "bg_demo", columns: ["id", "name"] });
  });

  it("ne prend pas la ligne de continuation d'une FOREIGN KEY pour une colonne", () => {
    // Le cas qui a produit trente fausses entrées au premier essai, toutes
    // nommées « REFERENCES » : lue ligne à ligne, la seconde ligne d'une clé
    // étrangère commence par un mot qui n'est dans aucune liste de mots
    // réservés, donc elle passait pour une définition de plus.
    const parsed = declaredColumns(`CREATE TABLE IF NOT EXISTS bg_demo (
      id INT NOT NULL,
      user_id INT NOT NULL,
      FOREIGN KEY (user_id)
        REFERENCES bg_users(id) ON DELETE CASCADE
    )`);
    expect(parsed?.columns).toEqual(["id", "user_id"]);
  });

  it("ignore un commentaire SQL glissé entre deux colonnes", () => {
    // Celui-là a survécu à la correction précédente et rendait
    // `bg_tournaments.la` : trois lignes de commentaire dans le corps de la
    // table, dont la première se lisait comme une définition.
    const parsed = declaredColumns(`CREATE TABLE IF NOT EXISTS bg_demo (
      id INT NOT NULL,
      -- la cible se règle en nombre fixe ou en pourcentage
      -- (voir lib/shared/tournament-phases.ts)
      target INT NULL
    )`);
    expect(parsed?.columns).toEqual(["id", "target"]);
  });

  it("ne découpe pas sur une virgule prise dans une valeur par défaut", () => {
    // Latent, et c'est bien le problème : aucun `CREATE` du fichier ne porte
    // aujourd'hui de virgule entre apostrophes, si bien que le jour où l'un en
    // porterait une, le filet crierait au loup sur une base parfaitement saine.
    const parsed = declaredColumns(`CREATE TABLE IF NOT EXISTS bg_demo (
      id INT NOT NULL,
      label VARCHAR(40) NOT NULL DEFAULT 'a, b et c',
      state VARCHAR(10) NOT NULL
    )`);
    expect(parsed?.columns).toEqual(["id", "label", "state"]);
  });

  it("s'arrête à la parenthèse fermante du corps, pas à la première venue", () => {
    // Un `DECIMAL(10, 2)` porte une virgule *à l'intérieur* d'une parenthèse,
    // et la clause `ENGINE=` qui suit le corps ne doit rien ajouter.
    const parsed = declaredColumns(`CREATE TABLE IF NOT EXISTS bg_demo (
      id INT NOT NULL,
      amount DECIMAL(10, 2) NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    expect(parsed?.columns).toEqual(["id", "amount"]);
  });

  it("rend null sur ce qui n'est pas un CREATE TABLE nommé", () => {
    expect(declaredColumns("ALTER TABLE bg_demo ADD COLUMN x INT NULL")).toBeNull();
  });
});

import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { isDuplicateEntryError, isSchemaNoOpError, isUnknownColumnError } from "@/lib/server/mysql-errors";
import { withoutInvisiblesKeepingSpaces } from "@/lib/shared/visible-text";
import { reportSchemaFailure } from "./report-schema-failure";

/*
 * Migrations de données ponctuelles : un remplissage lié à l'ajout d'une colonne,
 * un défaut changé, les retraits de colonnes (`DROP COLUMN`) et les reports
 * d'une ancienne colonne vers sa remplaçante. Chacune ne fait rien sur une base
 * qui l'a déjà jouée.
 */

/** Ajout de `bg_matches.launched_at`, et lancement des matchs déjà jouables. */
export async function backfillLaunchedAt(db: Pool): Promise<void> {
  // `launched_at` : un match jouable ne se joue plus qu'une fois **lancé**
  // (`lib/shared/match-launch.ts`). Sur une base qui tourne, les matchs déjà
  // jouables au déploiement se jouaient sous l'ancienne règle : ils sont posés
  // lancés, sans quoi une rencontre en cours se verrait refuser son score au
  // milieu d'un tournoi. **Seulement ceux-là** : un match programmé plus tard
  // passera par son lancement à l'heure dite, comme tout match à venir. Le remplissage ne suit **que** l'ajout effectif de la
  // colonne — rejoué à chaque démarrage, il lancerait d'office tout match
  // devenu jouable depuis.
  const launchedAtStatement = `ALTER TABLE bg_matches ADD COLUMN launched_at DATETIME NULL AFTER lobby_opened_at`;
  try {
    await db.execute(launchedAtStatement);
    // L'empreinte de l'appariement est posée avec : sans elle, le lancement
    // serait lu comme celui d'un autre appariement, donc ignoré.
    await db.execute(
      `UPDATE bg_matches
       SET launched_at = NOW(), launch_pairing = CONCAT(team1_id, ':', team2_id)
       WHERE launched_at IS NULL
         AND team1_id IS NOT NULL AND team2_id IS NOT NULL
         AND (status IN ('AWAITING_CONFIRMATION', 'COMPLETED')
              OR (status = 'READY' AND (start_at IS NULL OR start_at <= NOW())))`,
    );
  } catch (error) {
    reportSchemaFailure(error, launchedAtStatement);
  }
}

/** Bascule du défaut de `bg_users.open_to_recruitment`, jouée une fois. */
export async function switchOpenToRecruitmentDefault(db: Pool): Promise<void> {
  // `open_to_recruitment` : un compte neuf ne s'annonce plus « free agent »
  // (`lib/shared/player-roster-status.ts`). Le défaut était « ouvert », si bien
  // que tout joueur sans équipe se présentait disponible sans l'avoir jamais
  // dit — c'est une case qu'on **coche**, pas qu'on découvre cochée.
  //
  // Sur une base qui tourne, le changement de défaut ne touche aucune ligne :
  // les joueurs sans équipe sont donc passés « sans équipe » **une fois**, au
  // moment où le défaut bascule, et jamais plus — rejoué à chaque démarrage, le
  // remplissage refermerait la case de qui l'a cochée depuis. La condition se lit
  // sur le **défaut de la colonne**, seule trace durable de ce passage : il n'y a
  // pas de colonne neuve dont l'ajout effectif ferait foi, comme pour
  // `launched_at`.
  //
  // L'ordre est le propos. Le défaut bascule **d'abord** : un compte créé par un
  // autre processus pendant la manœuvre naît donc fermé, ou existe déjà quand le
  // remplissage passe — dans l'ordre inverse, celui qui naissait entre les deux
  // gardait le défaut 1 pour toujours. Et un `ALTER` refusé n'entraîne aucun
  // remplissage : sans quoi, rejoué à chaque démarrage faute de bascule, il
  // refermerait la case des joueurs qui l'ont cochée entre-temps. Si c'est le
  // **remplissage** qui échoue (verrou de ligne sur `bg_users`), le défaut est
  // remis à 1 pour que tout se retente au démarrage suivant.
  //
  // « Sans équipe » est la lecture de l'annuaire (`listPlayers`) : aucune
  // appartenance en cours. Ce bloc se retire une fois la bascule constatée en
  // production (`pm2 logs` : « Défaut de bg_users.open_to_recruitment passé
  // à 0 »), la définition restant dans le `CREATE TABLE`.
  const OPEN_TO_RECRUITMENT_DEFAULT = "ALTER TABLE bg_users ALTER COLUMN open_to_recruitment SET DEFAULT 0";
  const OPEN_TO_RECRUITMENT_BACKFILL = `UPDATE bg_users u
            SET u.open_to_recruitment = 0
          WHERE u.open_to_recruitment = 1
            AND NOT EXISTS (
              SELECT 1 FROM bg_team_members tm
               WHERE tm.user_id = u.id AND tm.left_at IS NULL
            )`;
  let currentDefault: string | null = null;
  try {
    const [defaultRows] = await db.execute<(RowDataPacket & { columnDefault: string | null })[]>(
      `SELECT COLUMN_DEFAULT AS columnDefault
         FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'bg_users'
          AND COLUMN_NAME = 'open_to_recruitment'`,
    );
    currentDefault = defaultRows[0]?.columnDefault ?? null;
  } catch (error) {
    reportSchemaFailure(error, "lecture du défaut de bg_users.open_to_recruitment");
  }
  if (currentDefault !== null && currentDefault !== "0") {
    let defaultSwitched = false;
    try {
      await db.execute(OPEN_TO_RECRUITMENT_DEFAULT);
      defaultSwitched = true;
    } catch (error) {
      reportSchemaFailure(error, OPEN_TO_RECRUITMENT_DEFAULT);
    }
    if (defaultSwitched) {
      try {
        const [closed] = await db.execute<ResultSetHeader>(OPEN_TO_RECRUITMENT_BACKFILL);
        console.log(
          `[migrations] Défaut de bg_users.open_to_recruitment passé à 0 : ` +
            `${closed.affectedRows} joueur(s) sans équipe passé(s) « sans équipe ».`,
        );
      } catch (error) {
        reportSchemaFailure(error, "UPDATE bg_users SET open_to_recruitment = 0 (joueurs sans équipe)");
        try {
          await db.execute(`ALTER TABLE bg_users ALTER COLUMN open_to_recruitment SET DEFAULT 1`);
        } catch (restoreError) {
          // Le défaut reste à 0 : la garde ne redemandera plus le remplissage.
          console.error(
            "[migrations] Le passage « sans équipe » des joueurs a échoué et le défaut n'a pas pu " +
              "être remis à 1 : le remplissage ne sera pas rejoué, il est à jouer à la main.",
            restoreError,
          );
        }
      }
    }
  }
}

/** Retrait de `bg_recruitment_ads.contact_email`. */
export async function dropRecruitmentContactEmail(db: Pool): Promise<void> {
  // **Un retrait de colonne ne se replie pas.** Une colonne qui part n'a aucune
  // contrepartie dans un `CREATE TABLE` : elle y est simplement absente, si bien
  // qu'une table neuve ne la porte jamais et qu'une base existante la garde pour
  // toujours. Les quatre ci-dessous restent donc ici quoi qu'il arrive ; les deux premières
  // disent la même chose : une adresse que plus personne ne lit.
  //
  // Celle des annonces de recrutement a perdu son lecteur quand le contact est
  // passé en « AUTO / DISCORD / LIEN » — plus aucun écran ne la saisit ni ne
  // l'affiche.
  try {
    await db.execute(`ALTER TABLE bg_recruitment_ads DROP COLUMN contact_email`);
  } catch (error) {
    reportSchemaFailure(error, "ALTER TABLE bg_recruitment_ads DROP COLUMN contact_email");
  }
}

/** Retrait de `bg_users.email`, vidée à défaut. */
export async function dropUserEmail(db: Pool): Promise<void> {
  // L'adresse e-mail n'a plus aucun lecteur — le scope `email` a disparu de la
  // demande faite à Google et un compte ne se revendique plus par son adresse
  // (`docs/features/OAUTH_PROVIDERS.md`). La colonne restait pourtant, et avec
  // elle les adresses collectées avant la règle : garder une donnée que plus
  // personne ne lit n'est pas de la prudence, c'est une fuite en attente. Elle
  // part donc de la table, ce qui efface les valeurs du même geste.
  //
  // **L'échec ne passe ni en silence, ni sans recours**, et c'est ici qu'il
  // compte le plus : le `DROP` est le geste d'effacement lui-même. Rien ne lit
  // plus la colonne, donc la base démarre parfaitement sans lui — et
  // `anonymizeOwnAccount` ne met plus l'adresse à `NULL`, cette ligne n'ayant
  // plus d'objet. Un `ALTER` refusé (droit manquant, verrou de métadonnées
  // tenace) laisserait donc les adresses **indéfiniment**, y compris sur les
  // comptes qui ont demandé leur suppression.
  //
  // D'où un repli qui ne demande **aucun DDL** : vider la colonne. Il n'obtient
  // pas le même résultat — la colonne survit, et il restera à la retirer — mais
  // il obtient le seul qui soit urgent : les adresses ne sont plus là. Le
  // `WHERE` le rend gratuit au passage suivant, et il se rejoue à chaque
  // démarrage tant que le `DROP` ne passe pas.
  const DROP_EMAIL = "ALTER TABLE bg_users DROP COLUMN email";
  try {
    await db.execute(DROP_EMAIL);
  } catch (error) {
    reportSchemaFailure(error, DROP_EMAIL);
    if (!isSchemaNoOpError(error, DROP_EMAIL)) {
      try {
        const [erased] = await db.execute<ResultSetHeader>(
          `UPDATE bg_users SET email = NULL WHERE email IS NOT NULL`,
        );
        if (erased.affectedRows > 0) {
          console.error(
            `[migrations] Le retrait de bg_users.email a échoué : ${erased.affectedRows} ` +
              `adresse(s) ont été vidées à la place. La colonne reste à retirer à la main.`,
          );
        }
      } catch (fallbackError) {
        console.error(
          `[migrations] Les adresses de bg_users.email n'ont pu être ni retirées ni vidées.`,
          fallbackError,
        );
      }
    }
  }
}

/** Retrait de `bg_site_visits.user_id`, vidée à défaut. */
export async function dropSiteVisitUserId(db: Pool): Promise<void> {
  // Les visites ne pointent plus vers un compte : `bg_site_visits.user_id` gardait
  // qui avait vu quelle page, et à quelle heure, tant que le compte vivait — une
  // trace de navigation nominative que la mesure d'audience n'a jamais demandée.
  // Seul le fait « visite d'un compte connecté » est conservé (`authenticated`),
  // repris des lignes existantes avant le retrait.
  //
  // Même filet que l'adresse e-mail : si le `DROP` est refusé, la colonne est
  // **vidée** — c'est l'effacement qui est urgent, pas la forme du schéma. Le
  // report de `authenticated` échoue en silence sur une base déjà migrée (la
  // colonne source n'existe plus), ce qui est la réussite attendue.
  try {
    await db.execute(`UPDATE bg_site_visits SET authenticated = 1 WHERE user_id IS NOT NULL`);
  } catch (error) {
    if (!isUnknownColumnError(error)) {
      reportSchemaFailure(error, "UPDATE bg_site_visits SET authenticated (report depuis user_id)");
    }
  }
  const DROP_VISIT_USER = "ALTER TABLE bg_site_visits DROP COLUMN user_id";
  try {
    await db.execute(DROP_VISIT_USER);
  } catch (error) {
    reportSchemaFailure(error, DROP_VISIT_USER);
    if (!isSchemaNoOpError(error, DROP_VISIT_USER)) {
      try {
        await db.execute(`UPDATE bg_site_visits SET user_id = NULL WHERE user_id IS NOT NULL`);
        console.error(
          "[migrations] Le retrait de bg_site_visits.user_id a échoué : la colonne a été vidée à la place. " +
            "Elle reste à retirer à la main.",
        );
      } catch (fallbackError) {
        console.error(
          "[migrations] bg_site_visits.user_id n'a pu être ni retirée ni vidée.",
          fallbackError,
        );
      }
    }
  }
}

/** Reprise unique des empreintes dans `bg_site_visitors`. */
export async function seedSiteVisitors(db: Pool): Promise<void> {
  // Les visiteurs uniques « depuis toujours » se comptent désormais sur
  // `bg_site_visitors`, alimentée à chaque visite enregistrée : sur une base qui
  // tourne, elle naît vide alors que le détail garde tout l'historique. Elle est
  // remplie **une fois**, avant le premier repli du détail (qui effacerait les
  // empreintes à reprendre) — vide, c'est qu'aucune visite n'a encore été
  // enregistrée par la version qui l'alimente. Un échec ici ne perd rien pour
  // de bon : le repli reporte lui-même les empreintes de ce qu'il efface
  // (`rollUpExpiredSiteVisits`), le total est seulement en retard le temps que
  // le détail restant soit replié. À retirer une fois constaté joué en
  // production.
  try {
    const [seeded] = await db.execute<RowDataPacket[]>(`SELECT 1 FROM bg_site_visitors LIMIT 1`);
    if (seeded.length === 0) {
      await db.execute(
        `INSERT INTO bg_site_visitors (visitor_key, authenticated, last_seen_at)
         SELECT visitor_key, MAX(authenticated), MAX(created_at) FROM bg_site_visits GROUP BY visitor_key
         ON DUPLICATE KEY UPDATE
           authenticated = GREATEST(bg_site_visitors.authenticated, VALUES(authenticated)),
           last_seen_at = GREATEST(bg_site_visitors.last_seen_at, VALUES(last_seen_at))`,
      );
    }
  } catch (error) {
    reportSchemaFailure(error, "INSERT INTO bg_site_visitors (reprise des empreintes)");
  }
}

/** Report de `highlight` vers `priority`, puis retrait de `highlight`. */
export async function migrateRecruitmentPriority(db: Pool): Promise<void> {
  // La mise en avant d'une annonce de recrutement (`highlight` : `NONE` /
  // `BANNER` / `MODAL`) est devenue un **statut d'importance** (`priority`,
  // `lib/shared/recruitment.ts`) : modale → prioritaire, banderole → importante,
  // rien → facultative (le défaut de la colonne, donc rien à écrire).
  //
  // Le report **consomme** sa source : `highlight` est remise à `NONE` dans la
  // même instruction, après avoir été lue (MySQL affecte de gauche à droite).
  // Si le `DROP` qui suit échouait, le report rejoué au démarrage suivant ne
  // trouverait donc plus rien à faire, et ne pourrait pas écraser un statut
  // choisi depuis par le staff.
  //
  // Une base neuve n'a jamais eu `highlight`, et une base migrée ne l'a plus :
  // l'`UPDATE` y bute sur une colonne inconnue, c'est la réussite attendue. Mais
  // le même code d'erreur nommerait aussi `priority`, si son ajout avait été
  // refusé plus haut — et la source serait alors tout ce qui reste. Plutôt que
  // de lire le texte de l'erreur (sa forme dépend de la langue des messages du
  // serveur) ou `information_schema` (réservé à ce qu'aucun essai ne peut
  // trancher), une lecture de `priority` départage : lisible, c'est bien
  // `highlight` qui manque.
  //
  // Le `DROP` ne suit que si le report a réussi ou que la source est partie :
  // il emporterait sinon la seule trace de ce qui était mis en avant.
  let highlightCarriedOver = true;
  try {
    await db.execute(
      `UPDATE bg_recruitment_ads
       SET priority = CASE highlight WHEN 'MODAL' THEN 'PRIORITY' WHEN 'BANNER' THEN 'IMPORTANT' ELSE priority END,
           highlight = 'NONE'
       WHERE highlight <> 'NONE'`,
    );
  } catch (error) {
    // `priority` illisible elle aussi : la source reste, on n'y touche pas.
    const sourceGone =
      isUnknownColumnError(error) &&
      (await db.execute(`SELECT priority FROM bg_recruitment_ads LIMIT 0`).then(
        () => true,
        () => false,
      ));
    if (!sourceGone) {
      highlightCarriedOver = false;
      reportSchemaFailure(error, "UPDATE bg_recruitment_ads SET priority (report depuis highlight)");
    }
  }
  const DROP_RECRUITMENT_HIGHLIGHT = "ALTER TABLE bg_recruitment_ads DROP COLUMN highlight";
  if (highlightCarriedOver) {
    try {
      await db.execute(DROP_RECRUITMENT_HIGHLIGHT);
    } catch (error) {
      reportSchemaFailure(error, DROP_RECRUITMENT_HIGHLIGHT);
    }
  }
}

/** Colonnes de noms saisis, lus partout sur le site (`UNTRUSTED_NAMES.md`). */
const STORED_NAME_COLUMNS = [
  { table: "bg_teams", column: "name", logIds: true },
  { table: "bg_users", column: "pseudo", logIds: false },
  { table: "bg_tournaments", column: "name", logIds: true },
] as const;

/**
 * Marqueur de la passe (`bg_settings`) : posé une fois toutes les lignes
 * traitées, il évite de relire trois tables à chaque démarrage. Le nettoyage à
 * l'écriture garantit qu'aucun nom sale n'apparaît ensuite.
 */
export const CLEAN_STORED_NAMES_MARKER = "migration_clean_stored_names";

/** Attente de verrou de ligne pendant la passe, en secondes (`innodb_lock_wait_timeout`). */
const CLEAN_NAMES_LOCK_WAIT_SECONDS = 5;

type StoredNameRow = RowDataPacket & { id: number; name: string | null };

/**
 * Retire une fois des noms enregistrés **avant** que l'écriture ne les
 * nettoie ce qui ne se voit pas : caractères invisibles et commandes de
 * direction (`withoutInvisiblesKeepingSpaces`, `UNTRUSTED_NAMES.md`).
 *
 * Le nettoyage ne jouait qu'à l'écriture : un ancien nom à commande de
 * direction (U+202E) ou à caractère invisible brouillait donc chaque surface
 * qui l'oubliait à la lecture (menu du compte, dialogue de programmation,
 * pages de tournoi). Réécrit en base, il est propre partout à la fois.
 *
 * Ni NFKC ni réduction des espaces : ce serait renommer en silence, et sans
 * retour, un nom stylisé que son auteur a choisi (« Team² » → « Team2 »,
 * lettres pleine chasse, espace fine insécable). Seul ce qui ne s'affiche
 * pas disparaît, si bien que le nom se lit à l'identique après la passe.
 *
 * **Ponctuelle** : le marqueur {@link CLEAN_STORED_NAMES_MARKER} est posé une
 * fois la passe menée à bout, et un démarrage qui le trouve ne lit rien. Une
 * panne (hors doublon) le laisse absent : la passe reprend au démarrage suivant.
 *
 * La lecture filtre en JavaScript, pas en `REGEXP` : la syntaxe des classes
 * Unicode diffère entre MySQL (ICU) et MariaDB (PCRE), et trois tables de
 * quelques milliers de lignes au plus se lisent d'un trait. Les écritures
 * partent ligne à ligne, mais seules les lignes sales sont écrites, une seule
 * fois (marqueur) : un `UPDATE` groupé n'économiserait rien de mesurable.
 *
 * Une ligne est **laissée telle quelle** — les filtres de sortie restent donc
 * en place — quand son nom nettoyé serait vide (la saisie le refuserait), ou
 * quand la base le refuse pour **doublon** (`ER_DUP_ENTRY`) : un sosie
 * (`Adm` + U+200B + `in`) dont la forme propre est déjà prise par l'original
 * (`UNIQUE`). Toute autre erreur (attente de verrou comprise) n'est **pas** un
 * « laissé » : elle est signalée (`reportSchemaFailure`) et la passe reste à
 * rejouer. La condition sur l'ancien nom évite d'écraser un renommage fait
 * entre la lecture et l'écriture ; elle compare **octet à octet**
 * (`utf8mb4_bin`) : la collation des colonnes (`utf8mb4_0900_ai_ci`,
 * `utf8mb4_uca1400_ai_ci` sous MariaDB) ignore casse, accents et caractères
 * invisibles, si bien que « TEAM », renommé entre-temps, y égalerait l'ancien
 * « Te » + U+200B + « am » et serait réécrit « Team ». `updated_at` est gardé :
 * les trois tables le remettent à l'heure à chaque `UPDATE`, et le classement
 * date un tournoi terminé sans `finished_at` par lui — un simple nettoyage ne
 * doit pas en déplacer les tendances. Le journal compte des lignes et, pour les
 * équipes et les tournois laissés tels quels, en donne les **identifiants** (de
 * quoi les renommer à la main) — jamais un nom ni l'identifiant d'un joueur
 * (`RGPD_LOGS_AND_VISITS.md`).
 */
export async function cleanStoredNames(db: Pool): Promise<void> {
  if (await cleanNamesAlreadyDone(db)) return;
  let connection: PoolConnection;
  try {
    connection = await db.getConnection();
  } catch (error) {
    reportSchemaFailure(error, "connexion (nettoyage des noms)");
    return;
  }
  let complete = true;
  try {
    // Attente de verrou courte, pour cette connexion seulement : une ligne
    // verrouillée longtemps (transaction bloquée) ne retient pas la passe
    // jusqu'au délai par défaut pendant que les autres processus attendent le
    // verrou de migration.
    await connection.execute(`SET SESSION innodb_lock_wait_timeout = ${CLEAN_NAMES_LOCK_WAIT_SECONDS}`);
    for (const target of STORED_NAME_COLUMNS) {
      // Une écriture en échec (verrou tenu : 5 s d'attente par ligne) arrête la passe : elle reprendra au démarrage suivant.
      const done = await cleanNameColumn(connection, target);
      if (done === "aborted") {
        complete = false;
        break;
      }
      complete = done && complete;
    }
  } catch (error) {
    complete = false;
    reportSchemaFailure(error, "SET SESSION innodb_lock_wait_timeout (nettoyage des noms)");
  } finally {
    // Délai rendu au pool ; une connexion qui ne répond plus est détruite, pas rendue avec son délai de 5 s.
    const reset = await connection
      .execute("SET SESSION innodb_lock_wait_timeout = DEFAULT")
      .then(() => true)
      .catch(() => false);
    if (reset) connection.release();
    else connection.destroy();
  }
  if (complete) await markCleanNamesDone(db);
}

/** Vrai quand la passe a déjà été menée à bout sur cette base. */
async function cleanNamesAlreadyDone(db: Pool): Promise<boolean> {
  try {
    const [rows] = await db.execute<RowDataPacket[]>("SELECT 1 FROM bg_settings WHERE setting_key = ? LIMIT 1", [
      CLEAN_STORED_NAMES_MARKER,
    ]);
    return rows.length > 0;
  } catch {
    // Lecture impossible : on rejoue, la passe est idempotente.
    return false;
  }
}

async function markCleanNamesDone(db: Pool): Promise<void> {
  try {
    await db.execute(
      "INSERT INTO bg_settings (setting_key, setting_value) VALUES (?, '1') ON DUPLICATE KEY UPDATE setting_value = '1'",
      [CLEAN_STORED_NAMES_MARKER],
    );
  } catch (error) {
    reportSchemaFailure(error, "INSERT bg_settings (marqueur du nettoyage des noms)");
  }
}

type CleanTarget = (typeof STORED_NAME_COLUMNS)[number];

/** Une colonne de `cleanStoredNames` : lue d'un trait, réécrite ligne à ligne. Vrai si menée à bout ; `"aborted"` si une écriture a échoué (la passe s'arrête). */
async function cleanNameColumn(
  db: PoolConnection,
  { table, column, logIds }: CleanTarget,
): Promise<boolean | "aborted"> {
  let rows: StoredNameRow[];
  try {
    [rows] = await db.execute<StoredNameRow[]>(`SELECT id, ${column} AS name FROM ${table}`);
  } catch (error) {
    reportSchemaFailure(error, `SELECT ${column} FROM ${table} (nettoyage des noms)`);
    return false;
  }
  let cleaned = 0;
  let failed = false;
  const keptIds: number[] = [];
  for (const row of rows) {
    const outcome = await rewriteName(db, table, column, row);
    if (outcome === "kept") keptIds.push(row.id);
    else if (outcome === "failed") {
      failed = true;
      break;
    } else cleaned += outcome;
  }
  if (cleaned > 0 || keptIds.length > 0) {
    const ids = logIds && keptIds.length > 0 ? ` (id : ${keptIds.join(", ")})` : "";
    console.log(
      `[migrations] ${table}.${column} : ${cleaned} nom(s) réécrit(s) sans caractère invisible, ` +
        `${keptIds.length} laissé(s) tel(s) quel(s) (vide une fois nettoyé, ou doublon)${ids}.`,
    );
  }
  return failed ? "aborted" : true;
}

/** Lignes réécrites (0 si le nom est déjà propre ou a changé depuis), `"kept"` ou `"failed"`. */
async function rewriteName(
  db: PoolConnection,
  table: string,
  column: string,
  row: StoredNameRow,
): Promise<number | "kept" | "failed"> {
  if (typeof row.name !== "string") return 0;
  const clean = withoutInvisiblesKeepingSpaces(row.name);
  if (clean === row.name) return 0;
  if (!clean) return "kept";
  try {
    const [result] = await db.execute<ResultSetHeader>(
      `UPDATE ${table} SET ${column} = ?, updated_at = updated_at WHERE id = ? AND ${column} COLLATE utf8mb4_bin = ?`,
      [clean, row.id, row.name],
    );
    return result.affectedRows;
  } catch (error) {
    if (isDuplicateEntryError(error)) return "kept";
    reportSchemaFailure(error, `UPDATE ${table}.${column} (nettoyage des noms)`);
    return "failed";
  }
}

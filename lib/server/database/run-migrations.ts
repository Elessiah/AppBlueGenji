import type { Pool } from "mysql2/promise";
import { applyPermanentCatchUps } from "./catch-ups";
import {
  backfillLaunchedAt,
  dropRecruitmentContactEmail,
  dropSiteVisitUserId,
  dropUserEmail,
  migrateRecruitmentPriority,
  seedSiteVisitors,
  switchOpenToRecruitmentDefault,
} from "./data-migrations";
import { DECLARED_TABLES } from "./declared-tables";
import { applyRecentSchemaChanges } from "./recent-schema-changes";
import { warnIfSchemaIsBehind } from "./schema-check";
import { createAccountTables } from "./schema/accounts";
import { createComplianceTables } from "./schema/compliance";
import { createSentNotificationTables } from "./schema/notifications";
import { createPhaseTables } from "./schema/phases";
import { createShowcaseTables } from "./schema/showcase";
import { createReplayStandingTables } from "./schema/standings";
import { createTeamTables } from "./schema/teams";
import { createTournamentTables } from "./schema/tournaments";

/**
 * Le schéma, **tel qu'il est aujourd'hui** — et non l'histoire de la façon dont
 * on y est arrivé.
 *
 * Jusqu'ici ce module racontait cette histoire : une poignée de `CREATE TABLE`
 * d'origine, puis soixante-trois `ALTER TABLE` empilés au fil des
 * fonctionnalités, chacun dans son `try {} catch {}` parce qu'il devait
 * retomber en silence sur une base qui l'avait déjà subi. Personne ne pouvait
 * plus lire la définition d'une table sans parcourir mille lignes, l'ordre des
 * colonnes n'avait plus aucun rapport avec leur sens, et chaque démarrage
 * rejouait des conversions d'ENUM et des `UPDATE` de rattrapage sans objet
 * depuis des mois.
 *
 * **La contrepartie, à connaître avant de toucher au schéma.** Sur une base
 * qui existe déjà, `CREATE TABLE IF NOT EXISTS` ne fait *rien* : il ne rattrape
 * ni une colonne ni un index manquants. Replier les anciens `ALTER` dans les
 * `CREATE` n'est donc sans danger que parce que la production porte déjà le
 * schéma complet — elle a joué tous ces `ALTER`, un par un, avant cette
 * consolidation. Une base restée à une version antérieure n'est **pas**
 * rattrapée par ces modules et doit être migrée à la main.
 *
 * **La règle pour la suite est donc inchangée** : un changement de schéma
 * s'écrit en **deux** endroits — dans le `CREATE TABLE` (`schema/`), pour les
 * bases neuves, *et* en `ALTER TABLE` tolérant parmi les migrations, pour
 * celles qui tournent. Les migrations portent donc trois choses, et rien
 * d'autre :
 *
 * - `RECENT_SCHEMA_CHANGES` (`recent-schema-changes.ts`), les changements trop
 *   récents pour qu'on sache la production passée dessus — des **instructions
 *   entières**, pour que la règle vaille aussi bien pour un `ENUM` élargi ou un
 *   index posé que pour une colonne ajoutée ; à retirer un par un, une fois un
 *   déploiement constaté ;
 * - les trois `DROP COLUMN` (`data-migrations.ts`), qui n'ont pas de pendant
 *   dans un `CREATE TABLE` puisqu'ils *retirent* ;
 * - `warnIfSchemaIsBehind` (`schema-check.ts`), qui **dit** au démarrage
 *   qu'une base n'a pas joué les `ALTER` repliés — la prémisse ci-dessus était
 *   jusqu'ici affirmée et jamais vérifiée.
 *
 * L'ordre des appels ci-dessous est celui des instructions émises : les tables
 * d'abord (les clés étrangères pointent vers les précédentes), les migrations
 * ensuite, le filet en dernier.
 */
export async function runMigrations(db: Pool): Promise<void> {
  // La porte **oublie ses échecs** (`createOnceGate`) : une passe interrompue se
  // rejoue dans le même processus, et la liste retenue par `createTable`
  // doublerait à chaque reprise — le filet annoncerait alors deux fois chaque
  // colonne manquante, et un compte deux fois trop grand. Elle appartient à la
  // passe, pas au processus.
  DECLARED_TABLES.length = 0;

  await createAccountTables(db);
  await createTeamTables(db);
  await createTournamentTables(db);
  await createReplayStandingTables(db);
  await createPhaseTables(db);
  await createSentNotificationTables(db);
  await createShowcaseTables(db);
  await createComplianceTables(db);
  await applyRecentSchemaChanges(db);
  await backfillLaunchedAt(db);
  await switchOpenToRecruitmentDefault(db);
  await dropRecruitmentContactEmail(db);
  await dropUserEmail(db);
  await dropSiteVisitUserId(db);
  await seedSiteVisitors(db);
  await migrateRecruitmentPriority(db);
  await applyPermanentCatchUps(db);
  await warnIfSchemaIsBehind(db);
}

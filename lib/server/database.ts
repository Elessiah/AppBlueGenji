import "dotenv/config";
import mysql, { type ExecuteValues, type Pool, type PoolConnection } from "mysql2/promise";
import { createOnceGate, withMigrationLock } from "@/lib/server/migration-lock";
import { runMigrations } from "@/lib/server/database/run-migrations";

/*
 * Pool MySQL du site et porte d'entrée du schéma : `getDatabase` crée le pool,
 * joue les migrations une fois par processus (`database/run-migrations.ts`),
 * puis rend la main. Le schéma lui-même vit sous `lib/server/database/` —
 * `CREATE TABLE` par domaine dans `schema/`, migrations et filets à côté.
 */

/**
 * Paramètres liés d'une requête préparée.
 *
 * `mysql2` typait ses paramètres en `any` jusqu'en 3.23 : un tableau déclaré
 * `unknown[]` — la forme qu'on écrivait partout — passait sans rien dire. Depuis,
 * `execute` n'accepte plus qu'`ExecuteValues`, et les quatorze tableaux qui
 * construisent une requête à rallonge ne satisfaisaient plus la signature.
 *
 * L'alias vit ici plutôt que recopié dans les sept modules concernés : c'est
 * `database.ts` qui possède la couche MySQL, et le jour où le type amont change
 * de nom il n'y aura qu'un endroit à corriger. `import type` étant effacé à la
 * compilation, y recourir ne charge pas ce module.
 */
export type SqlParam = ExecuteValues;
export type SqlParams = SqlParam[];

let pool: Pool | null = null;
const migrationGate = createOnceGate();

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

/**
 * Joue le schéma une fois par processus, et une seule à la fois sur la base.
 *
 * Les deux garanties viennent de `migration-lock` : la porte oublie ses échecs
 * (une migration ratée ne condamne plus le processus jusqu'au redémarrage) et le
 * verrou nommé empêche deux processus d'exécuter les mêmes `ALTER TABLE` en même
 * temps, ce dont MySQL faisait un interblocage.
 */
async function ensureMigrations(db: Pool): Promise<void> {
  await migrationGate.run(() => withMigrationLock(db, () => runMigrations(db)));
}

/**
 * Emprunte une connexion du pool le temps d'une lecture, puis la rend — quoi
 * qu'il arrive.
 *
 * Le pool ne compte que 25 places : un `release()` oublié sur un chemin d'erreur
 * les épuise en silence, et le site se fige sans rien dire. Passer par ce
 * helper plutôt que d'écrire son propre `try` / `finally` supprime la question.
 */
export async function withConnection<T>(
  run: (connection: PoolConnection) => Promise<T>,
): Promise<T> {
  const db = await getDatabase();
  const connection = await db.getConnection();
  try {
    return await run(connection);
  } finally {
    connection.release();
  }
}

export async function getDatabase(): Promise<Pool> {
  pool ??= mysql.createPool({
    host: requireEnv("DB_HOST"),
    user: requireEnv("DB_USER"),
    password: requireEnv("DB_PASSWORD"),
    database: requireEnv("DB_DATABASE"),
    waitForConnections: true,
    connectionLimit: 25,
    connectTimeout: 10000,
    namedPlaceholders: true,
    charset: "utf8mb4",
    dateStrings: true,
  });

  await ensureMigrations(pool);
  scheduleDeletedAccountsReconciliation();
  return pool;
}

/**
 * La garde « une fois par processus » vit sur `globalThis` et non dans une
 * variable de module : `next dev` réévalue ce fichier à chaque rechargement à
 * chaud, et une variable de module relançait la passe — irréversible — à
 * chaque modification du code, sur la base locale que les worktrees partagent.
 */
const reconciliationState = globalThis as typeof globalThis & {
  __bgDeletedAccountsReconciliation?: Promise<void>;
};

/**
 * Applique aux comptes **déjà** supprimés la règle de suppression du jour
 * (`reconcileDeletedAccounts`) — une fois par processus, en tâche de fond.
 *
 * Pas dans les migrations : elles tiennent un verrou que chaque requête
 * attend, et ce rattrapage passe par le service des comptes, qui rappelle
 * `getDatabase` — sous la porte des migrations, il s'attendrait lui-même.
 * L'import est dynamique pour la même raison, à l'échelle des modules :
 * `users-service` importe ce fichier.
 *
 * Un échec est dit et **non** retenté dans ce processus : un rattrapage qui
 * tombe à chaque requête ferait d'une panne un déluge. Le redémarrage suivant
 * le reprendra.
 *
 * Réservé au **serveur du site** (`NEXT_RUNTIME`, posé par Next) : un script
 * (`npm run seed`, `replay:deletions`) ferme son pool en fin de course, sous
 * un rattrapage qui tournerait encore — et le seed réécrit justement les
 * comptes de test que celui-ci parcourt.
 */
function scheduleDeletedAccountsReconciliation(): void {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  reconciliationState.__bgDeletedAccountsReconciliation ??= import("@/lib/server/users-service")
    .then(({ reconcileDeletedAccounts }) => reconcileDeletedAccounts())
    .then(({ erased, renamed, failed }) => {
      if (erased + renamed + failed > 0) {
        console.info(
          `[deleted-accounts] Rattrapage : ${erased} effacé(s), ${renamed} renommé(s), ${failed} reporté(s).`,
        );
      }
    })
    .catch((error: unknown) => {
      console.error(
        "[deleted-accounts] Rattrapage des comptes supprimés impossible :",
        error instanceof Error ? error.message : error,
      );
    });
}

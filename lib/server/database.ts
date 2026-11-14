import "dotenv/config";
import { failureReason } from "@/lib/server/failure-reason";
import mysql, { type ExecuteValues, type Pool, type PoolConnection } from "mysql2/promise";
import { createOnceGate, withMigrationLock } from "@/lib/server/migration-lock";
import { NamedLockUnavailableError, withNamedLock } from "@/lib/server/named-lock";
import { runMigrations } from "@/lib/server/database/run-migrations";
import { releaseWithServerLockWait } from "@/lib/server/tournaments/lock-wait";

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
    // Détruite plutôt que rendue si un `ROLLBACK` y a échoué, délai de verrou
    // remis s'il avait été raccourci (`lock-wait.ts`).
    await releaseWithServerLockWait(connection);
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
    // Sondes TCP dès 30 s de silence (au lieu des deux heures du système) : une connexion
    // à moitié ouverte lève une erreur en une douzaine de minutes au plus, et la requête
    // qui l'attendait rend sa connexion — et sa place dans les bornes du journal du bot
    // (`BOT_LOG_RESOLVE_UNSETTLED_MAX`, `bot-logs.ts`).
    enableKeepAlive: true,
    keepAliveInitialDelay: DB_KEEPALIVE_INITIAL_DELAY_MS,
    namedPlaceholders: true,
    charset: "utf8mb4",
    dateStrings: true,
  });
  if (!englishMessagesPools.has(pool)) {
    englishMessagesPools.add(pool);
    forceEnglishServerMessages(pool);
  }

  await ensureMigrations(pool);
  scheduleDeletedAccountsReconciliation();
  scheduleDueAccountDeletions();
  return pool;
}

/** Silence, en ms, avant la première sonde TCP d'une connexion du pool. */
export const DB_KEEPALIVE_INITIAL_DELAY_MS = 30_000;

/** Pools déjà réglés (un double de test peut être rendu deux fois). */
const englishMessagesPools = new WeakSet<Pool>();

/**
 * Messages d'erreur du serveur **en anglais** (et attente de verrou de
 * métadonnées bornée) sur toute connexion du pool :
 * `fail()` (`lib/server/http.ts`) ne reçoit que `error.message` et reconnaît
 * l'interblocage, le refus d'instantané et le délai de verrou sur le texte
 * anglais du moteur. Un serveur aux `lc_messages` réglés autrement rendait 500
 * au lieu de 409 sur toute route. La commande part avant toute autre sur la
 * connexion neuve (file d'attente de mysql2) ; un échec n'est que signalé.
 *
 * L'évènement `connection` de mysql2 passe la connexion **à rappels** (non
 * promise), malgré son type.
 */
function forceEnglishServerMessages(created: Pool): void {
  if (typeof created.on !== "function") return;
  created.on("connection", (connection) => {
    const core = connection as unknown as { query(sql: string, done: (error: Error | null) => void): unknown };
    core.query("SET SESSION lc_messages = 'en_US'", (error) => {
      if (error) console.warn("[db] lc_messages non réglé sur la connexion", failureReason(error));
    });
    // Attente d'un verrou de **métadonnées** bornée comme celle d'une ligne :
    // un `ALTER TABLE` du démarrage (`recent-schema-changes.ts`) derrière une
    // transaction longue attendait `lock_wait_timeout` (un jour sous MariaDB,
    // un an sous MySQL), et `getDatabase()` avec lui — tout le site figé.
    core.query(`SET SESSION lock_wait_timeout = ${METADATA_LOCK_WAIT_SECONDS}`, (error) => {
      if (error) console.warn("[db] lock_wait_timeout non réglé sur la connexion", failureReason(error));
    });
  });
}

/** Attente maximale d'un verrou de métadonnées, en secondes (celle d'InnoDB pour une ligne). */
export const METADATA_LOCK_WAIT_SECONDS = 50;

/** Une passe par heure au plus, par processus (`scheduleDueAccountDeletions`). */
const DUE_DELETIONS_INTERVAL_MS = 60 * 60 * 1000;

const dueDeletionsState = globalThis as typeof globalThis & { __bgDueDeletionsAt?: number };

/**
 * Rend définitives les suppressions de compte dont les trente jours de
 * réactivation sont écoulés (`finalizeDueAccountDeletions`, E4) — portée par le
 * trafic, au plus une fois par heure et par processus, en tâche de fond, comme
 * la purge des signalements. Même réserve que le rattrapage : serveur du site
 * seulement (`NEXT_RUNTIME`), jamais un script.
 */
function scheduleDueAccountDeletions(now: number = Date.now()): void {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (dueDeletionsState.__bgDueDeletionsAt !== undefined && now - dueDeletionsState.__bgDueDeletionsAt < DUE_DELETIONS_INTERVAL_MS) {
    return;
  }
  dueDeletionsState.__bgDueDeletionsAt = now;
  // D'abord les forfaits restés en attente d'un adversaire (E1) : un match
  // d'aval apparié depuis le dernier passage ne reste pas bloqué contre un
  // compte en suppression jusqu'au prochain redémarrage.
  // Après le rattrapage de démarrage, qui fait la même passe : jamais deux à la fois.
  void Promise.resolve(reconciliationState.__bgDeletedAccountsReconciliation)
    .then(() => runDueAccountDeletionsExclusively())
    .catch((error: unknown) => {
      console.error(
        "[deleted-accounts] Passage horaire impossible :",
        failureReason(error),
      );
    });
}

/** Verrou nommé du passage horaire : un seul processus à la fois fait le travail. */
export const DUE_DELETIONS_LOCK_NAME = "bg_due_account_deletions";

/**
 * Le passage horaire, derrière un verrou nommé (`GET_LOCK`, sans attente) : les
 * processus du site (pm2) le lancent tous à la même heure, et chacun relirait les
 * mêmes candidats et se disputerait les mêmes verrous de comptes et de tournois.
 * Celui qui n'obtient pas le verrou passe son tour — l'heure suivante, un autre
 * aura la main. Chaque étape échoue seule : un forfait reporté n'empêche pas
 * les suppressions définitives.
 */
export async function runDueAccountDeletionsExclusively(): Promise<void> {
  if (!pool) return;
  try {
    await withNamedLock(pool, DUE_DELETIONS_LOCK_NAME, 0, async () => {
      try {
        const { settleDeletedSoloEntries } = await import("@/lib/server/users/deleted-solo-entries");
        await settleDeletedSoloEntries();
      } catch (error) {
        console.error(
          "[deleted-accounts] Forfaits des comptes supprimés reportés :",
          failureReason(error),
        );
      }
      try {
        // Le relevé complet du jour, que le seul démarrage menait (au plus une
        // tentative par jour et par processus ; une lecture sinon).
        const { reconcileStaleFullScan } = await import("@/lib/server/users/deleted-accounts");
        const outcome = await reconcileStaleFullScan();
        if (outcome && outcome.erased + outcome.renamed + outcome.failed > 0) {
          console.info(
            `[deleted-accounts] Relevé complet : ${outcome.erased} effacé(s), ${outcome.renamed} renommé(s), ${outcome.failed} reporté(s).`,
          );
        }
      } catch (error) {
        console.error("[deleted-accounts] Relevé complet reporté :", failureReason(error));
      }
      try {
        const { finalizeDueAccountDeletions } = await import("@/lib/server/users/deleted-accounts");
        const { finalized, failed } = await finalizeDueAccountDeletions();
        if (finalized + failed > 0) {
          console.info(`[deleted-accounts] Suppressions définitives : ${finalized} faite(s), ${failed} reportée(s).`);
        }
      } catch (error) {
        console.error(
          "[deleted-accounts] Suppressions définitives impossibles :",
          failureReason(error),
        );
      }
    });
  } catch (error) {
    // Un autre processus tient le passage : rien à faire de ce côté-ci.
    if (error instanceof NamedLockUnavailableError) return;
    throw error;
  }
}

/**
 * Le rattrapage de démarrage, derrière le **même** verrou nommé que le passage
 * horaire : les processus du site démarrent ensemble (déploiement), et chacun
 * referait le même balayage en se disputant les mêmes verrous de comptes et de
 * tournois. Celui qui n'obtient pas le verrou ne fait rien — un autre processus
 * tient le rattrapage (ou le passage horaire, qui rejoue la même passe des
 * entrées solo ; le reste du rattrapage ne sert qu'après un changement de
 * règle et attend alors le démarrage suivant).
 */
async function reconcileDeletedAccountsExclusively(
  reconcile: () => Promise<{ erased: number; renamed: number; failed: number }>,
): Promise<{ erased: number; renamed: number; failed: number }> {
  if (!pool) return { erased: 0, renamed: 0, failed: 0 };
  try {
    return await withNamedLock(pool, DUE_DELETIONS_LOCK_NAME, 0, () => reconcile());
  } catch (error) {
    if (error instanceof NamedLockUnavailableError) {
      console.info("[deleted-accounts] Rattrapage de démarrage laissé à un autre processus (verrou tenu).");
      return { erased: 0, renamed: 0, failed: 0 };
    }
    throw error;
  }
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
 * `users/deleted-accounts` importe ce fichier.
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
  reconciliationState.__bgDeletedAccountsReconciliation ??= import("@/lib/server/users/deleted-accounts")
    .then(({ reconcileDeletedAccounts }) => reconcileDeletedAccountsExclusively(reconcileDeletedAccounts))
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
        failureReason(error),
      );
    });
}

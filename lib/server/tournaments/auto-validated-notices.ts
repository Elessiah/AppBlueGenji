/**
 * Avis « score validé automatiquement » (`docs/features/SCORE_DISPUTE_LOCK.md`),
 * notés pendant la transaction qui valide d'office une manche
 * (`resolveExpiredScoreReports`) et envoyés **après son commit** — même cycle
 * de vie que la file du journal : partis avec `flushBotLogs`, jetés avec
 * `discardBotLogs` si la transaction échoue. Rien n'est annoncé qui ne soit
 * écrit.
 */
import type { PoolConnection } from "mysql2/promise";
import { notifyScoreAutoValidated } from "./player-pushes";

const pending = new WeakMap<PoolConnection, Set<number>>();

/** Note qu'une manche vient d'être validée d'office dans la transaction en cours. */
export function queueAutoValidatedNotice(connection: PoolConnection, matchId: number): void {
  const queued = pending.get(connection);
  if (!queued) {
    pending.set(connection, new Set([matchId]));
    return;
  }
  queued.add(matchId);
}

/** La transaction n'a pas abouti : rien ne part. */
export function discardAutoValidatedNotices(connection: PoolConnection): void {
  pending.delete(connection);
}

/**
 * File d'envoi **unique au processus** : chaque flush s'y enchaîne. Un balayage
 * commite tournoi par tournoi (`syncVisibleTournaments`) ; une chaîne par flush
 * referait, après un redémarrage qui valide des rondes dans plusieurs tournois,
 * la rafale parallèle sur le pool que la file évite.
 */
let sending: Promise<void> = Promise.resolve();

/**
 * Envoie les avis de la transaction qui vient d'aboutir, sans attendre. Ne lève
 * jamais. Les avis partent **l'un après l'autre**, à la suite de ceux des
 * transactions précédentes : une ronde entière validée d'un coup, ou plusieurs
 * tournois dans le même balayage, n'occupent qu'une connexion du pool à la fois.
 */
export function flushAutoValidatedNotices(connection: PoolConnection): void {
  const queued = pending.get(connection);
  pending.delete(connection);
  if (!queued) return;
  const matchIds = [...queued];
  sending = sending.then(() => sendInSequence(matchIds));
}

async function sendInSequence(matchIds: readonly number[]): Promise<void> {
  for (const matchId of matchIds) {
    await notifyScoreAutoValidated(matchId).catch(() => undefined);
  }
}

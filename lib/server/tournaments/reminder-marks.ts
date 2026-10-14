/**
 * Marques de rappel d'une manche (`bg_match_reminders` : observation, palier,
 * horaire reçu — `./match-reminders`).
 *
 * Une seule règle, appliquée partout où l'affiche d'une manche change ou
 * disparaît (correction d'un score amont, retour en arrière, arbre réécrit) :
 * ses marques appartenaient à l'ancienne affiche. Les nouvelles engagées n'ont
 * reçu aucun horaire et doivent recevoir l'annonce.
 */
import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getDatabase, withConnection } from "@/lib/server/database";
import { ignoreMissingTable, isMissingTableError } from "@/lib/server/mysql-errors";
import { chunkIds, sqlPlaceholders } from "@/lib/server/sql-placeholders";
import { MATCH_STAFF_KEY } from "@/lib/shared/discord-notifications";
import { retryOnDeadlock } from "./deadlock-retry";

/**
 * Un horaire reçu vaut encore tant qu'il est devant, ou passé depuis moins de
 * 12 h (un match en retard) : il se cite, se retire, et son retrait se dit.
 */
export const HELD_TIME_GRACE_MS = 12 * 60 * 60 * 1000;

/**
 * Réserve une marque (observation, palier, horaire reçu, citation au
 * programme d'arbitrage) pour une manche —
 * **pour l'horaire lu** : la réservation
 * échoue si l'horaire a changé depuis la lecture (un arbitre l'a déplacé entre
 * la lecture du balayage et son envoi). Sans cette condition, le balayage
 * enverrait l'ancien horaire et prendrait le palier que l'annonce du nouveau
 * attend — qui se tairait. L'`INSERT … SELECT` lit la ligne du match sous
 * verrou partagé : une programmation en cours est attendue, puis relue.
 *
 * @returns `true` si la réservation est acquise (c'est à nous d'envoyer),
 *          `false` si une autre requête l'a prise entre-temps, ou si
 *          l'horaire n'est plus celui-là.
 */
export async function claimDatedMark(
  match: { id: number; start_at: string | Date; team1_id: number; team2_id: number },
  offsetKey: string,
): Promise<boolean> {
  const db = await getDatabase();
  const matchId = Number(match.id);
  // La ligne retient l'horaire pour lequel elle est prise : seul l'envoi de cet
  // horaire peut la rendre (`releaseClaims`). Les engagées aussi sont
  // vérifiées : une affiche changée a vu ses marques effacées, et ses nouvelles
  // engagées attendent leur annonce.
  const [result] = await db.execute(
    `INSERT IGNORE INTO bg_match_reminders (match_id, offset_key, start_at)
       SELECT ?, ?, start_at FROM bg_matches
        WHERE id = ? AND start_at = ? AND team1_id = ? AND team2_id = ?`,
    [matchId, offsetKey, matchId, match.start_at, Number(match.team1_id), Number(match.team2_id)],
  );
  return (result as { affectedRows?: number }).affectedRows === 1;
}

/**
 * Rend des marques réservées (observation, palier) — **seulement celles prises
 * pour cet horaire** (`start_at <=> ?` : chaque réservation date la sienne,
 * `setMatchStartAt` aussi). Un ancien envoi en échec n'efface ainsi jamais les
 * marques d'un changement plus récent. Seul chemin de rendu : un appelant qui
 * oublierait la condition rouvrirait le doublon. Ne lève jamais.
 */
export async function releaseDatedMarks(
  matchId: number,
  keys: readonly string[],
  startAt: string | Date,
): Promise<void> {
  if (keys.length === 0) return;
  try {
    const db = await getDatabase();
    await db.execute(
      `DELETE FROM bg_match_reminders
        WHERE match_id = ? AND offset_key IN (${sqlPlaceholders(keys.length)}) AND start_at <=> ?`,
      [matchId, ...keys, new Date(startAt)],
    );
  } catch (error) {
    // La marque attendra le changement d'horaire suivant ; pm2 le dit.
    if (!isMissingTableError(error)) console.error("[match-reminders] marque non rendue", error);
  }
}

/**
 * Réservation de la marque des arbitres pour un envoi : ce qu'elle tenait
 * avant (à rendre si l'envoi n'atteint personne), ou `held` — elle tenait
 * déjà cet horaire, preuve d'un envoi précédent qui ne se rend pas.
 */
export type StaffReservation =
  | { kind: "held" }
  | { kind: "reserved"; id: number; startAt: string; previous: Date | string | null }
  /** Marque illisible : l'envoi part, rien à rendre. */
  | { kind: "unmarked" };

type StaffRow = RowDataPacket & { id: number; start_at: Date | string | null };

/**
 * Retient l'horaire poussé aux arbitres ({@link MATCH_STAFF_KEY}) — **avant**
 * l'envoi, pour qu'un retrait qui suivrait de près le trouve, et seulement
 * s'il est encore celui de la manche (un changement plus récent l'emporte).
 * Rendue par {@link releaseStaffPush} si l'envoi n'atteint personne — à ce
 * qu'elle tenait avant, jamais quand elle tenait déjà cet horaire (la preuve
 * d'un envoi précédent qui, lui, a atteint les arbitres).
 *
 * Lecture et réservation dans **une** transaction, sous verrous, dans l'ordre
 * du moteur (la manche, puis sa marque) : une réservation ou un rendu
 * concurrents attendent, et la réservation retient la ligne et la valeur
 * qu'elle a réellement remplacées.
 *
 * @returns `null` : la manche ne tient plus cet horaire (changé ou retiré
 *          depuis) — rien à pousser, le geste plus récent a ses propres avis.
 */
export async function markStaffPushed(matchId: number, startAt: string): Promise<StaffReservation | null> {
  try {
    // Rejouée sur interblocage : deux réservations dont les marques absentes
    // partagent un intervalle d'index s'attendent l'une l'autre.
    return await retryOnDeadlock(() =>
      withConnection(async (connection) => {
        await connection.beginTransaction();
        try {
          const reservation = await reserveStaffMark(connection, matchId, startAt);
          await connection.commit();
          return reservation;
        } catch (error) {
          await connection.rollback().catch(() => undefined);
          throw error;
        }
      }),
    );
  } catch (error) {
    // Table absente ou marque illisible : on pousse quand même (sans marque,
    // le retrait ne sera simplement pas poussé).
    if (!isMissingTableError(error)) console.error("[match-schedule] horaire poussé aux arbitres non retenu", error);
    return { kind: "unmarked" };
  }
}

async function reserveStaffMark(
  connection: PoolConnection,
  matchId: number,
  startAt: string,
): Promise<StaffReservation | null> {
  const time = new Date(startAt);
  // Une table par lecture verrouillante (MariaDB).
  const [matches] = await connection.execute<(RowDataPacket & { start_at: Date | string | null })[]>(
    `SELECT start_at FROM bg_matches WHERE id = ? LIMIT 1 LOCK IN SHARE MODE`,
    [matchId],
  );
  const current = matches[0]?.start_at ?? null;
  if (current === null || new Date(current).getTime() !== time.getTime()) return null;
  const [rows] = await connection.execute<StaffRow[]>(
    `SELECT id, start_at FROM bg_match_reminders WHERE match_id = ? AND offset_key = ? LIMIT 1 FOR UPDATE`,
    [matchId, MATCH_STAFF_KEY],
  );
  const before = rows[0];
  if (before && before.start_at !== null && new Date(before.start_at).getTime() === time.getTime()) {
    return { kind: "held" };
  }
  if (before) {
    await connection.execute(`UPDATE bg_match_reminders SET start_at = ? WHERE id = ?`, [time, before.id]);
    return { kind: "reserved", id: Number(before.id), startAt, previous: before.start_at };
  }
  const [result] = await connection.execute<ResultSetHeader>(
    `INSERT INTO bg_match_reminders (match_id, offset_key, start_at) VALUES (?, ?, ?)`,
    [matchId, MATCH_STAFF_KEY, time],
  );
  return { kind: "reserved", id: Number(result.insertId), startAt, previous: null };
}

/**
 * Rend la marque réservée par {@link markStaffPushed} : l'envoi n'a atteint
 * aucun appareil. Elle retrouve ce qu'elle tenait (ou disparaît), sur sa
 * ligne et seulement si elle tient encore l'horaire de cet envoi.
 */
export async function releaseStaffPush(reservation: StaffReservation): Promise<void> {
  if (reservation.kind !== "reserved") return;
  const { id, startAt, previous } = reservation;
  if (previous === null) {
    await writeStaffMark(`DELETE FROM bg_match_reminders WHERE id = ? AND start_at <=> ?`, [id, new Date(startAt)]);
  } else {
    await writeStaffMark(`UPDATE bg_match_reminders SET start_at = ? WHERE id = ? AND start_at <=> ?`, [
      new Date(previous),
      id,
      new Date(startAt),
    ]);
  }
}

/**
 * Oublie l'horaire poussé aux arbitres, une fois son retrait poussé — sauf si
 * la manche l'a retrouvé entre-temps (reposé par un autre arbitre pendant
 * l'envoi : sa marque vaut pour la nouvelle annonce). Au meilleur effort.
 */
export async function forgetStaffPush(matchId: number, startAt: string): Promise<void> {
  await writeStaffMark(
    `DELETE FROM bg_match_reminders
      WHERE match_id = ? AND offset_key = ? AND start_at <=> ?
        AND NOT EXISTS (SELECT 1 FROM bg_matches m WHERE m.id = ? AND m.start_at <=> ?)`,
    [matchId, MATCH_STAFF_KEY, new Date(startAt), matchId, new Date(startAt)],
  );
}

async function writeStaffMark(sql: string, params: (number | string | Date)[]): Promise<void> {
  try {
    const db = await getDatabase();
    await db.execute(sql, params);
  } catch (error) {
    if (!isMissingTableError(error)) console.error("[match-schedule] horaire poussé aux arbitres non oublié", error);
  }
}

/**
 * Efface les marques de rappel des manches données — pas celle de l'horaire
 * poussé aux arbitres ({@link MATCH_STAFF_KEY}) : une affiche changée ne change
 * pas l'horaire qu'ils ont reçu, et son retrait doit encore leur être poussé.
 *
 * Sous `ignoreMissingTable` : la création de la table est avalée par un
 * `catch` dans `database/schema/`, et une base à qui elle manque n'a aucune
 * marque à effacer — ce n'est pas une raison de faire échouer le geste.
 */
export async function forgetMatchReminders(connection: PoolConnection, matchIds: readonly number[]): Promise<void> {
  for (const ids of chunkIds(matchIds)) {
    await ignoreMissingTable(
      connection.execute(
        `DELETE FROM bg_match_reminders WHERE match_id IN (${sqlPlaceholders(ids.length)}) AND offset_key <> ?`,
        [...ids, MATCH_STAFF_KEY],
      ),
    );
  }
}

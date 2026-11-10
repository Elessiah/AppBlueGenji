/**
 * Marques de rappel d'une manche (`bg_match_reminders` : observation, palier,
 * horaire reçu — `./match-reminders`).
 *
 * Une seule règle, appliquée partout où l'affiche d'une manche change ou
 * disparaît (correction d'un score amont, retour en arrière, arbre réécrit) :
 * ses marques appartenaient à l'ancienne affiche. Les nouvelles engagées n'ont
 * reçu aucun horaire et doivent recevoir l'annonce.
 */
import { randomInt } from "node:crypto";
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
  // Rejouée sur interblocage : une instruction seule, défaite entière quand
  // elle est la victime (son `INSERT … SELECT` tient le verrou AUTO-INC de la
  // table, et attend la manche ou l'intervalle qu'une programmation tient).
  const [result] = await retryOnDeadlock(() =>
    db.execute(
      `INSERT IGNORE INTO bg_match_reminders (match_id, offset_key, start_at)
       SELECT ?, ?, start_at FROM bg_matches
        WHERE id = ? AND start_at = ? AND team1_id = ? AND team2_id = ?`,
      [matchId, offsetKey, matchId, match.start_at, Number(match.team1_id), Number(match.team2_id)],
    ),
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
 * **Une marque absente s'insère sans avoir été lue sous verrou**
 * (`reserveStaffMark` : lecture simple, insertion, et lecture verrouillante
 * seulement d'une marque présente) : lire sous verrou une marque absente verrouille l'intervalle de
 * l'index, et l'insertion qui suivrait attendrait le verrou AUTO-INC de la
 * table — que tient, jusqu'à la fin de son instruction, l'`INSERT … SELECT`
 * d'une réservation des joueurs ({@link claimDatedMark}, pose de `TOLD`)
 * partie **en même temps pour la même manche**, elle-même arrêtée par cet
 * intervalle. Interblocage, rendu par MariaDB en `ER_AUTOINC_READ_FAILED` :
 * la marque n'était pas retenue, et le retrait de l'horaire ne se poussait
 * plus aux arbitres.
 *
 * @returns `null` : la manche ne tient plus cet horaire (changé ou retiré
 *          depuis) — rien à pousser, le geste plus récent a ses propres avis.
 */
export async function markStaffPushed(matchId: number, startAt: string): Promise<StaffReservation | null> {
  try {
    for (let attempt = 1; attempt <= STAFF_MARK_ATTEMPTS; attempt += 1) {
      // Rejouée sur interblocage (`ER_AUTOINC_READ_FAILED` compris) : la
      // réservation tient la manche en lecture pendant qu'elle insère.
      const reservation = await retryOnDeadlock(() =>
        withConnection(async (connection) => {
          await connection.beginTransaction();
          try {
            const reserved = await reserveStaffMark(connection, matchId, startAt);
            // Marque disparue ou apparue pendant la réservation : la
            // transaction est défaite (elle tient un verrou d'intervalle, sous
            // lequel on n'insère pas) et la réservation reprise à neuf.
            if (reserved === MARK_MOVED) await connection.rollback();
            else await connection.commit();
            return reserved;
          } catch (error) {
            await connection.rollback().catch(() => undefined);
            throw error;
          }
        }),
      );
      if (reservation !== MARK_MOVED) return reservation;
      // Attente courte et aléatoire avant de reprendre : deux réservations
      // qui se sont croisées ne repartent pas du même pas.
      if (attempt < STAFF_MARK_ATTEMPTS) await new Promise((resolve) => setTimeout(resolve, randomInt(20, 81)));
    }
    throw new Error("STAFF_MARK_NOT_RESERVED");
  } catch (error) {
    // Table absente ou marque illisible : on pousse quand même (sans marque,
    // le retrait ne sera simplement pas poussé).
    if (!isMissingTableError(error)) console.error("[match-schedule] horaire poussé aux arbitres non retenu", error);
    return { kind: "unmarked" };
  }
}

/** Reprises d'une réservation dont la marque a bougé pendant qu'on la prenait. */
const STAFF_MARK_ATTEMPTS = 2;

/** La marque a disparu (ou paru) entre sa lecture simple et son verrou. */
const MARK_MOVED = "moved";

async function reserveStaffMark(
  connection: PoolConnection,
  matchId: number,
  startAt: string,
): Promise<StaffReservation | null | typeof MARK_MOVED> {
  const time = new Date(startAt);
  // Une table par lecture verrouillante (MariaDB).
  const [matches] = await connection.execute<(RowDataPacket & { start_at: Date | string | null })[]>(
    `SELECT start_at FROM bg_matches WHERE id = ? LIMIT 1 LOCK IN SHARE MODE`,
    [matchId],
  );
  const current = matches[0]?.start_at ?? null;
  if (current === null || new Date(current).getTime() !== time.getTime()) return null;
  // Lecture **simple** d'abord : elle ne verrouille rien, et dit seulement
  // quel chemin prendre — chacun revérifie sous verrou.
  const [seen] = await connection.execute<(RowDataPacket & { id: number })[]>(
    `SELECT id FROM bg_match_reminders WHERE match_id = ? AND offset_key = ? LIMIT 1`,
    [matchId, MATCH_STAFF_KEY],
  );
  if (seen.length === 0) {
    // Marque absente : l'insertion, sans aucun verrou d'intervalle pris avant
    // elle (voir `markStaffPushed`). `IGNORE` : une marque parue entre-temps
    // n'est pas une erreur — la réservation reprend, et la lira.
    const [inserted] = await connection.execute<ResultSetHeader>(
      `INSERT IGNORE INTO bg_match_reminders (match_id, offset_key, start_at) VALUES (?, ?, ?)`,
      [matchId, MATCH_STAFF_KEY, time],
    );
    if (inserted.affectedRows !== 1) return MARK_MOVED;
    return { kind: "reserved", id: Number(inserted.insertId), startAt, previous: null };
  }
  // Marque présente : lue sous verrou d'écriture (sa ligne, pas un intervalle ;
  // ni identifiant consommé ni verrou AUTO-INC sur ce chemin, le plus courant).
  const [rows] = await connection.execute<StaffRow[]>(
    `SELECT id, start_at FROM bg_match_reminders WHERE match_id = ? AND offset_key = ? LIMIT 1 FOR UPDATE`,
    [matchId, MATCH_STAFF_KEY],
  );
  const before = rows[0];
  // Disparue depuis la lecture simple (retrait poussé entre-temps) : ce verrou
  // tient maintenant l'intervalle — on n'insère pas dessous, on reprend.
  if (!before) return MARK_MOVED;
  if (before.start_at !== null && new Date(before.start_at).getTime() === time.getTime()) {
    return { kind: "held" };
  }
  await connection.execute(`UPDATE bg_match_reminders SET start_at = ? WHERE id = ?`, [time, before.id]);
  return { kind: "reserved", id: Number(before.id), startAt, previous: before.start_at };
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

/**
 * Avis aux engagées **retirées** d'une manche dont elles tenaient l'horaire,
 * quand les résultats changent : correction de score (`./target-slot.ts`
 * `pushTeamToTarget`, `./bracket-cascade.ts`), retour en arrière
 * (`./rollback.ts`), ronde réappariée ou arbre final réécrit (Ronde suisse,
 * Survie, BlueGenji Survie), plateau périmé refait. L'horaire qu'elles avaient
 * reçu ne les concerne plus.
 *
 * L'horaire tenu se lit dans la transaction du changement, **avant** que les
 * marques de la manche ne soient effacées (`forgetMatchReminders`) ou la manche
 * supprimée, par une lecture verrouillante — l'état le plus récent, que
 * l'effacement verrouille de toute façon. Ce que l'avis dit de la manche
 * (tournoi, manche, adversaire) est relevé au même moment : une manche
 * supprimée n'est plus lisible après le commit. L'avis part après le commit,
 * comme les lignes du journal (`flushBotLogs`), et se jette avec elles si la
 * transaction échoue (`discardBotLogs`) : même contrat de cycle de vie que la
 * file du journal.
 *
 * Rien ne part si les joueurs n'avaient reçu aucun horaire (pas de marque
 * `TOLD`, ou plus d'horaire après un retrait remis), ni pour un horaire passé
 * depuis plus de 12 h.
 */
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { isMissingTableError } from "@/lib/server/mysql-errors";
import { MATCH_TOLD_KEY } from "@/lib/shared/discord-notifications";
import { announceEntrantsWithdrawn, type DepartedEntrant, type WithdrawnMatch } from "./match-reminders";
import { HELD_TIME_GRACE_MS } from "./reminder-marks";
import { isSwissRound, swissRoundSql } from "./swiss-round-sql";

/**
 * Avis retenus au plus par transaction : une ronde suisse réappariée en entier
 * en compte deux par manche. Le plafond ne borne que la mémoire d'une
 * transaction hors norme.
 */
const MAX_PENDING_NOTICES = 512;

/** Avis en attente, par connexion. */
const pending = new WeakMap<PoolConnection, DepartedEntrant[]>();

type HeldRow = RowDataPacket & { match_id: number; start_at: Date | string | null };

type ContextRow = RowDataPacket & {
  id: number;
  tournament_id: number;
  tournament_name: string;
  participant_type: string;
  bracket: string;
  round_number: number;
  swiss_round: number;
};

type PosterRow = RowDataPacket & { id: number; team1_id: number | null; team2_id: number | null };

/**
 * Une engagée qui quitte une manche, et l'adversaire qu'elle y avait — celui
 * de l'horaire reçu, relevé avant le changement (`null` : place vide, ou
 * inconnu).
 */
export type Departure = { matchId: number; teamId: number; opponentId: number | null };

/** Les deux places d'une manche. */
export type Poster = { team1Id: number | null; team2Id: number | null };

/**
 * Engagées qui quittent leurs manches entre deux états du plateau : présentes
 * avant, absentes après (dans l'une ou l'autre place). L'adversaire est
 * l'occupant de l'autre place **avant**.
 */
export function departuresBetween(
  before: ReadonlyMap<number, Poster>,
  after: ReadonlyMap<number, Poster>,
): Departure[] {
  const departures: Departure[] = [];
  for (const [matchId, previous] of before) {
    const next = after.get(matchId);
    const staying = new Set([next?.team1Id, next?.team2Id].filter((id): id is number => id != null));
    const sides: [number | null, number | null][] = [
      [previous.team1Id, previous.team2Id],
      [previous.team2Id, previous.team1Id],
    ];
    for (const [teamId, opponentId] of sides) {
      if (teamId !== null && !staying.has(teamId)) departures.push({ matchId, teamId, opponentId });
    }
  }
  return departures;
}

/**
 * Note que des engagées quittent leurs manches : celles dont les joueurs
 * tiennent un horaire encore valable recevront un avis après le commit. Une
 * lecture verrouillante des marques pour toutes, puis — seulement s'il y a un
 * avis à faire — une lecture de ce que l'avis dit des manches. À appeler
 * **avant** l'effacement des marques et la suppression des manches.
 */
export async function noteDepartedEntrants(
  connection: PoolConnection,
  departures: readonly Departure[],
): Promise<void> {
  if (departures.length === 0) return;
  const matchIds = [...new Set(departures.map((departure) => departure.matchId))];
  let rows: HeldRow[];
  try {
    [rows] = await connection.execute<HeldRow[]>(
      `SELECT match_id, start_at FROM bg_match_reminders
        WHERE match_id IN (${matchIds.map(() => "?").join(", ")}) AND offset_key = ?
        FOR UPDATE`,
      [...matchIds, MATCH_TOLD_KEY],
    );
  } catch (error) {
    if (isMissingTableError(error)) return;
    throw error;
  }
  const held = stillValidTimes(rows);
  const noticed = departures.filter((departure) => held.has(departure.matchId));
  if (noticed.length === 0) return;

  const matches = await loadWithdrawnMatches(connection, [...new Set(noticed.map((departure) => departure.matchId))]);
  const queue = pending.get(connection) ?? [];
  let dropped = 0;
  for (const departure of noticed) {
    const match = matches.get(departure.matchId);
    const heldStartAt = held.get(departure.matchId);
    if (!match || heldStartAt === undefined) continue;
    if (queue.length >= MAX_PENDING_NOTICES) {
      dropped += 1;
      continue;
    }
    queue.push({
      matchId: departure.matchId,
      teamId: departure.teamId,
      opponentId: departure.opponentId ?? fellowDeparture(noticed, departure),
      heldStartAt,
      match,
    });
  }
  if (queue.length > 0) pending.set(connection, queue);
  // Au-delà du plafond, ces joueurs ne seront pas prévenus : pm2 le dit.
  if (dropped > 0) console.warn(`[notify] ${dropped} avis de match retiré au-delà du plafond, non envoyés`);
}

/** Horaires tenus encore valables (à venir, ou passés depuis moins de 12 h), par manche. */
function stillValidTimes(rows: readonly HeldRow[]): Map<number, Date | string> {
  const since = Date.now() - HELD_TIME_GRACE_MS;
  const held = new Map<number, Date | string>();
  for (const row of rows) {
    if (row.start_at !== null && new Date(row.start_at).getTime() > since) held.set(Number(row.match_id), row.start_at);
  }
  return held;
}

/**
 * Les deux engagées d'une manche sortent l'une après l'autre (cascade) : la
 * seconde voit déjà vide la place de la première. Son adversaire est alors la
 * première sortante.
 */
function fellowDeparture(departures: readonly Departure[], departure: Departure): number | null {
  const fellow = departures.find(
    (other) => other.matchId === departure.matchId && other.teamId !== departure.teamId,
  );
  return fellow?.teamId ?? null;
}

/** Ce que l'avis dit des manches (tournoi, manche), lu avant leur éventuelle suppression. */
async function loadWithdrawnMatches(
  connection: PoolConnection,
  matchIds: readonly number[],
): Promise<Map<number, WithdrawnMatch>> {
  const [rows] = await connection.execute<ContextRow[]>(
    `SELECT m.id, m.tournament_id, m.bracket, m.round_number,
            t.name AS tournament_name, t.participant_type, ${swissRoundSql("m", "t")}
       FROM bg_matches m
       JOIN bg_tournaments t ON t.id = m.tournament_id
      WHERE m.id IN (${matchIds.map(() => "?").join(", ")})`,
    [...matchIds],
  );
  return new Map(
    rows.map((row) => [
      Number(row.id),
      {
        tournamentId: Number(row.tournament_id),
        tournamentName: String(row.tournament_name),
        solo: row.participant_type === "SOLO",
        bracket: String(row.bracket),
        roundNumber: Number(row.round_number),
        swiss: isSwissRound(row),
      },
    ]),
  );
}

/**
 * Note les engagées des manches **sur le point d'être supprimées** dont les
 * joueurs tiennent un horaire. À appeler juste avant le `DELETE`, avec le même
 * filtre.
 *
 * @param filterSql Filtre **constant** sur `bg_matches` (colonnes sans
 *        préfixe, valeurs en `?`) — jamais une valeur saisie.
 * @param params Les valeurs du filtre.
 */
export async function noteDeletedMatches(
  connection: PoolConnection,
  filterSql: string,
  params: readonly (string | number)[],
): Promise<void> {
  let rows: PosterRow[];
  try {
    [rows] = await connection.execute<PosterRow[]>(
      `SELECT m.id, m.team1_id, m.team2_id FROM bg_matches m
        WHERE ${filterSql}
          AND EXISTS (SELECT 1 FROM bg_match_reminders r WHERE r.match_id = m.id AND r.offset_key = ?)`,
      [...params, MATCH_TOLD_KEY],
    );
  } catch (error) {
    if (isMissingTableError(error)) return;
    throw error;
  }
  if (rows.length === 0) return;
  const before = new Map<number, Poster>(
    rows.map((row) => [
      Number(row.id),
      {
        team1Id: row.team1_id === null ? null : Number(row.team1_id),
        team2Id: row.team2_id === null ? null : Number(row.team2_id),
      },
    ]),
  );
  await noteDepartedEntrants(connection, departuresBetween(before, new Map()));
}

/** Jette les avis notés : le changement n'a pas abouti. */
export function discardDepartedNotices(connection: PoolConnection): void {
  pending.delete(connection);
}

/**
 * Envoie les avis notés par la transaction qui vient d'aboutir, **sans
 * attendre** (comme `flushBotLogs`). Ne lève jamais.
 */
export function flushDepartedNotices(connection: PoolConnection): void {
  const notices = pending.get(connection) ?? [];
  pending.delete(connection);
  if (notices.length === 0) return;
  void announceEntrantsWithdrawn(notices).catch((error: unknown) => {
    if (!isMissingTableError(error)) console.error("[notify] avis de match retiré non envoyé", error);
  });
}

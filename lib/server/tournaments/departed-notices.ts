/**
 * Avis aux engagées **retirées** d'une manche dont elles tenaient l'horaire,
 * quand le tournoi change sous elles : correction de score (`./target-slot.ts`
 * `pushTeamToTarget`, `./bracket-cascade.ts`), retour en arrière
 * (`./rollback.ts`), ronde réappariée ou arbre final réécrit (Ronde suisse,
 * Survie, BlueGenji Survie), plateau périmé refait. L'horaire qu'elles avaient
 * reçu ne les concerne plus.
 *
 * L'horaire tenu se lit dans la transaction du changement, **avant** que les
 * marques de la manche ne soient effacées (`forgetMatchReminders`) ou la manche
 * supprimée, par une lecture verrouillante — l'état le plus récent, que
 * l'effacement verrouille de toute façon. Ce que l'avis dit de la manche
 * (tournoi, phase, manche) est relevé au même moment : une manche supprimée
 * n'est plus lisible après le commit. L'avis part après le commit, comme les
 * lignes du journal (`flushBotLogs`), et se jette avec elles si la transaction
 * échoue (`discardBotLogs`) : même contrat de cycle de vie que la file du
 * journal. Ce qu'il dit se décide après le commit (`announceEntrantsWithdrawn`)
 * : une engagée reposée contre le même adversaire dans la même manche n'a
 * perdu que son horaire.
 *
 * Seules les engagées de **l'affiche qui a reçu l'horaire** sont prévenues
 * (les « détentrices », relevées à la première sortie notée sur la manche),
 * avec pour adversaire l'autre détentrice : une engagée posée puis retirée
 * dans la même transaction n'avait rien reçu.
 *
 * Rien ne part si les joueurs n'avaient reçu aucun horaire (pas de marque
 * `TOLD`, ou plus d'horaire après un retrait remis), ni pour un horaire passé
 * depuis plus de 12 h.
 */
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { isMissingTableError } from "@/lib/server/mysql-errors";
import { isPlayedMatchStatus } from "@/lib/shared/match-schedule";
import { chunkIds, sqlPlaceholders } from "@/lib/server/sql-placeholders";
import { MATCH_STAFF_KEY, MATCH_TOLD_KEY } from "@/lib/shared/discord-notifications";
import { announceEntrantsWithdrawn, type DepartedEntrant, type WithdrawnMatch } from "./match-reminders";
import { toPoster, type Poster, type PosterRow } from "./match-poster";
import { HELD_TIME_GRACE_MS } from "./reminder-marks";
import { announceDeletedMatchesToStaff } from "./schedule-notices";
import { isSwissRound, swissRoundSql } from "./swiss-round-sql";

export type { Poster } from "./match-poster";

/**
 * Avis retenus au plus par transaction : une ronde suisse réappariée en entier
 * en compte deux par manche. Le plafond ne borne que la mémoire d'une
 * transaction hors norme.
 */
const MAX_PENDING_NOTICES = 512;

/**
 * Ce que la transaction en cours a relevé, sur sa connexion. **Un seul objet**,
 * jeté d'un coup à la fin de la transaction (`flushDepartedNotices`,
 * `discardDepartedNotices`) : rien ne passe d'une transaction à la suivante
 * sur une connexion réutilisée.
 */
type TransactionState = {
  /** Avis en attente. */
  pending: DepartedEntrant[];
  /**
   * Manches dont un appelant (`./rollback.ts`) a relevé l'horaire tenu et
   * réglera lui-même les sorties (`holdDepartures` / `settleDepartures`) : une
   * pose intermédiaire de la même transaction ne les note pas.
   */
  settledLater: Set<number>;
  /**
   * Horaires tenus déjà lus, par manche (`null` : aucun). Une seconde sortie
   * sur la même manche (deux remplacements, ou une exemption puis une
   * correction) retrouve l'horaire que la première a lu, alors que ses
   * marques ont été effacées entre-temps. Le moteur n'écrit jamais `TOLD`.
   */
  heldRead: Map<number, HeldTime | null>;
  /** Les engagées qui ont reçu l'horaire de chaque manche ({@link holdersOf}). */
  heldBy: Map<number, ReadonlySet<number>>;
  /** Horaires poussés aux arbitres des manches supprimées : leur retrait leur sera poussé. */
  staffRemovals: DeletedStaffTime[];
};

/**
 * Une manche supprimée dont l'horaire avait été poussé aux arbitres (marque
 * `STAFF`) : « Horaire du match retiré » le remplacera sur leurs appareils.
 */
export type DeletedStaffTime = {
  matchId: number;
  startAt: Date | string;
  match: WithdrawnMatch;
  team1Id: number | null;
  team2Id: number | null;
};

const states = new WeakMap<PoolConnection, TransactionState>();

function stateOf(connection: PoolConnection): TransactionState {
  let state = states.get(connection);
  if (!state) {
    state = { pending: [], settledLater: new Set(), heldRead: new Map(), heldBy: new Map(), staffRemovals: [] };
    states.set(connection, state);
  }
  return state;
}

type HeldRow = RowDataPacket & { match_id: number; start_at: Date | string | null };

type ContextRow = RowDataPacket & {
  id: number;
  tournament_id: number;
  phase_id: number;
  tournament_name: string;
  participant_type: string;
  referee_scheduling: number | null;
  bracket: string;
  round_number: number;
  swiss_round: number;
};

/** Horaire tenu d'une manche, et ce que l'avis en dira. */
type HeldTime = { heldStartAt: Date | string; match: WithdrawnMatch };

/** Horaires tenus relevés par {@link holdDepartures}. */
export type HeldTimes = { matchIds: readonly number[]; held: ReadonlyMap<number, HeldTime> };

/**
 * Une engagée qui quitte une manche, et l'adversaire qu'elle y avait, relevé
 * avant le changement (`null` : place vide, ou inconnu).
 */
export type Departure = { matchId: number; teamId: number; opponentId: number | null };

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
  const owned = states.get(connection)?.settledLater;
  const noted = owned ? departures.filter((departure) => !owned.has(departure.matchId)) : departures;
  if (noted.length === 0) return;
  const held = await readHeldTimes(connection, [...new Set(noted.map((departure) => departure.matchId))]);
  enqueue(connection, held, noted);
}

/**
 * Relève, avant un geste qui va défaire puis reposer des manches, l'horaire
 * que leurs joueurs tiennent — les poses intermédiaires de la transaction
 * (exemption tranchée pendant la réconciliation) ne les notent plus : seul
 * l'état d'arrivée compte ({@link settleDepartures}).
 */
export async function holdDepartures(connection: PoolConnection, matchIds: readonly number[]): Promise<HeldTimes> {
  const held = matchIds.length > 0 ? await readHeldTimes(connection, matchIds) : new Map<number, HeldTime>();
  const { settledLater } = stateOf(connection);
  for (const id of matchIds) settledLater.add(id);
  return { matchIds, held };
}

/**
 * Les manches données, moins celles dont un appelant réglera lui-même les
 * sorties ({@link holdDepartures}) : leurs marques ne s'effacent pas sur une
 * pose intermédiaire — l'appelant les effacera si l'affiche d'arrivée a changé.
 */
export function withoutSettledLater(connection: PoolConnection, matchIds: readonly number[]): number[] {
  const owned = states.get(connection)?.settledLater;
  return owned ? matchIds.filter((id) => !owned.has(id)) : [...matchIds];
}

/** Note les sorties constatées à l'arrivée, sur les horaires relevés par {@link holdDepartures}. */
export function settleDepartures(connection: PoolConnection, times: HeldTimes, departures: readonly Departure[]): void {
  const owned = states.get(connection)?.settledLater;
  for (const id of times.matchIds) owned?.delete(id);
  enqueue(connection, times.held, departures);
}

/**
 * Horaires tenus encore valables des manches données, avec leur contexte. Une
 * manche déjà lue dans la transaction n'est pas relue (`TransactionState.heldRead`).
 */
async function readHeldTimes(connection: PoolConnection, matchIds: readonly number[]): Promise<Map<number, HeldTime>> {
  const known = stateOf(connection).heldRead;
  const unread = matchIds.filter((id) => !known.has(id));
  if (unread.length > 0) {
    const fetched = await fetchHeldTimes(connection, unread);
    // Table absente : rien n'a jamais été reçu.
    if (fetched === null) return new Map();
    for (const id of unread) known.set(id, fetched.get(id) ?? null);
  }
  const held = new Map<number, HeldTime>();
  for (const id of matchIds) {
    const time = known.get(id);
    if (time) held.set(id, time);
  }
  return held;
}

/**
 * Lecture verrouillante des marques `TOLD` (par paquets), puis du contexte des
 * seules manches à prévenir. `null` : table absente.
 */
async function fetchHeldTimes(connection: PoolConnection, matchIds: readonly number[]): Promise<Map<number, HeldTime> | null> {
  const rows: HeldRow[] = [];
  try {
    for (const ids of chunkIds(matchIds)) {
      const [chunkRows] = await connection.execute<HeldRow[]>(
        `SELECT match_id, start_at FROM bg_match_reminders
          WHERE match_id IN (${sqlPlaceholders(ids.length)}) AND offset_key = ?
          FOR UPDATE`,
        [...ids, MATCH_TOLD_KEY],
      );
      rows.push(...chunkRows);
    }
  } catch (error) {
    if (isMissingTableError(error)) return null;
    throw error;
  }
  const times = stillValidTimes(rows);
  const held = new Map<number, HeldTime>();
  if (times.size === 0) return held;
  const matches = await loadWithdrawnMatches(connection, [...times.keys()]);
  for (const [id, heldStartAt] of times) {
    const match = matches.get(id);
    if (match) held.set(id, { heldStartAt, match });
  }
  return held;
}

/**
 * Met en file les avis des sorties dont la manche a un horaire tenu : une
 * fois par engagée et par manche, et seulement pour les détentrices de
 * l'horaire ({@link holdersOf}).
 */
function enqueue(connection: PoolConnection, held: ReadonlyMap<number, HeldTime>, departures: readonly Departure[]): void {
  const byMatch = groupByHeldMatch(held, departures);
  if (byMatch.size === 0) return;
  const state = stateOf(connection);
  const queue = state.pending;
  const queued = new Set(queue.map((entry) => `${entry.matchId}:${entry.teamId}`));
  let dropped = 0;
  for (const [matchId, group] of byMatch) {
    const time = held.get(matchId) as HeldTime;
    const holders = holdersOf(state, matchId, group);
    for (const departure of group) {
      const key = `${matchId}:${departure.teamId}`;
      if (queued.has(key) || !holders.has(departure.teamId)) continue;
      if (queue.length >= MAX_PENDING_NOTICES) {
        dropped += 1;
        continue;
      }
      queued.add(key);
      queue.push({
        matchId,
        teamId: departure.teamId,
        opponentId: [...holders].find((id) => id !== departure.teamId) ?? null,
        heldStartAt: time.heldStartAt,
        match: time.match,
      });
    }
  }
  // Au-delà du plafond, ces joueurs ne seront pas prévenus : pm2 le dit.
  if (dropped > 0) console.warn(`[notify] ${dropped} avis de match retiré au-delà du plafond, non envoyés`);
}

/** Les sorties des manches dont un horaire est tenu, regroupées par manche (un seul passage). */
function groupByHeldMatch(held: ReadonlyMap<number, HeldTime>, departures: readonly Departure[]): Map<number, Departure[]> {
  const byMatch = new Map<number, Departure[]>();
  for (const departure of departures) {
    if (!held.has(departure.matchId)) continue;
    const group = byMatch.get(departure.matchId);
    if (group) group.push(departure);
    else byMatch.set(departure.matchId, [departure]);
  }
  return byMatch;
}

/**
 * Les engagées qui ont reçu l'horaire d'une manche : l'affiche d'avant la
 * **première** sortie notée sur elle dans la transaction — chaque sortante et
 * l'adversaire qu'elle avait (deux sortantes de la même manche se donnent
 * l'une l'autre). Fixées une fois pour la transaction : une engagée posée puis
 * retirée ensuite n'en fait pas partie.
 */
function holdersOf(state: TransactionState, matchId: number, group: readonly Departure[]): ReadonlySet<number> {
  const fixed = state.heldBy.get(matchId);
  if (fixed) return fixed;
  const holders = new Set<number>();
  for (const departure of group) {
    holders.add(departure.teamId);
    if (departure.opponentId !== null) holders.add(departure.opponentId);
  }
  state.heldBy.set(matchId, holders);
  return holders;
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

/** Ce que l'avis dit des manches (tournoi, phase, manche), lu avant leur éventuelle suppression. */
async function loadWithdrawnMatches(
  connection: PoolConnection,
  matchIds: readonly number[],
): Promise<Map<number, WithdrawnMatch>> {
  const rows: ContextRow[] = [];
  for (const ids of chunkIds(matchIds)) {
    const [chunkRows] = await connection.execute<ContextRow[]>(
      `SELECT m.id, m.tournament_id, m.phase_id, m.bracket, m.round_number,
              t.name AS tournament_name, t.participant_type, t.referee_scheduling,
              ${swissRoundSql("m", "t")}
         FROM bg_matches m
         JOIN bg_tournaments t ON t.id = m.tournament_id
        WHERE m.id IN (${sqlPlaceholders(ids.length)})`,
      ids,
    );
    rows.push(...chunkRows);
  }
  return new Map(
    rows.map((row) => [
      Number(row.id),
      {
        tournamentId: Number(row.tournament_id),
        tournamentName: String(row.tournament_name),
        phaseId: Number(row.phase_id ?? 0),
        solo: row.participant_type === "SOLO",
        refereeScheduling: Number(row.referee_scheduling ?? 0) === 1,
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
 * filtre (un test balaie les sources pour qu'aucune suppression du moteur n'y
 * échappe).
 *
 * Les manches visées se lisent **sous verrou** (une seule table, leurs seules
 * places — le `DELETE` qui suit les verrouille de toute façon), puis leurs
 * marques `TOLD` sous verrou : une marque posée par un envoi concurrent après
 * l'image de la transaction n'échappe pas, et un envoi qui n'a pas encore posé
 * la sienne attend la suppression, puis ne trouve plus la manche (réservation
 * conditionnée, rien n'est envoyé). Le contexte n'est lu que pour les manches
 * dont un horaire est tenu.
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
  const [rows] = await connection.execute<DoomedRow[]>(
    `SELECT id, team1_id, team2_id, status, start_at FROM bg_matches WHERE ${filterSql} FOR UPDATE`,
    [...params],
  );
  if (rows.length === 0) return;
  const before = new Map<number, Poster>(rows.map((row) => [Number(row.id), toPoster(row)]));
  // Une seule règle : `noteDepartedEntrants` écarte les manches qu'un retour
  // en arrière règle lui-même, lit les horaires tenus et ne garde que ceux-là.
  await noteDepartedEntrants(connection, departuresBetween(before, new Map()));
  await noteStaffRemovals(connection, rows);
}

/** Une manche sur le point d'être supprimée : ses places, son état, son horaire. */
type DoomedRow = PosterRow & { status: string; start_at: Date | string | null };

/**
 * Les arbitres avaient reçu « Match programmé » pour une manche supprimée
 * (marque `STAFF`, encore valable) : son retrait leur sera poussé après le
 * commit — la marque part avec la manche. Mêmes conditions qu'un retrait par
 * l'arbitre : la manche n'est pas jouée, et tient encore l'horaire poussé
 * (un horaire déjà retiré, ou jamais remplacé chez eux, ne se retire pas deux
 * fois).
 */
async function noteStaffRemovals(connection: PoolConnection, rows: readonly DoomedRow[]): Promise<void> {
  const open = rows.filter((row) => row.start_at !== null && !isPlayedMatchStatus(String(row.status)));
  if (open.length === 0) return;
  const staffRows: HeldRow[] = [];
  try {
    for (const ids of chunkIds(open.map((row) => Number(row.id)))) {
      const [chunkRows] = await connection.execute<HeldRow[]>(
        `SELECT match_id, start_at FROM bg_match_reminders
          WHERE match_id IN (${sqlPlaceholders(ids.length)}) AND offset_key = ?
          FOR UPDATE`,
        [...ids, MATCH_STAFF_KEY],
      );
      staffRows.push(...chunkRows);
    }
  } catch (error) {
    if (isMissingTableError(error)) return;
    throw error;
  }
  const startOf = new Map(open.map((row) => [Number(row.id), new Date(row.start_at as Date | string).getTime()]));
  const times = stillValidTimes(staffRows);
  for (const [matchId, startAt] of times) {
    if (new Date(startAt).getTime() !== startOf.get(matchId)) times.delete(matchId);
  }
  if (times.size === 0) return;
  const matches = await loadWithdrawnMatches(connection, [...times.keys()]);
  const posters = new Map(open.map((row) => [Number(row.id), toPoster(row)]));
  const { staffRemovals } = stateOf(connection);
  for (const [matchId, startAt] of times) {
    const match = matches.get(matchId);
    const poster = posters.get(matchId);
    if (match && poster) staffRemovals.push({ matchId, startAt, match, ...poster });
  }
}

/** Jette les avis notés : le changement n'a pas abouti. */
export function discardDepartedNotices(connection: PoolConnection): void {
  states.delete(connection);
}

/**
 * Envoie les avis notés par la transaction qui vient d'aboutir, **sans
 * attendre** (comme `flushBotLogs`). Ne lève jamais.
 */
export function flushDepartedNotices(connection: PoolConnection): void {
  const state = states.get(connection);
  states.delete(connection);
  const notices = state?.pending ?? [];
  const removals = state?.staffRemovals ?? [];
  if (removals.length > 0) {
    void announceDeletedMatchesToStaff(removals).catch((error: unknown) => {
      if (!isMissingTableError(error)) console.error("[notify] retrait aux arbitres non envoyé", error);
    });
  }
  if (notices.length === 0) return;
  void announceEntrantsWithdrawn(notices).catch((error: unknown) => {
    if (!isMissingTableError(error)) console.error("[notify] avis de match retiré non envoyé", error);
  });
}

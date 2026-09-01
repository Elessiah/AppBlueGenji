/**
 * Lancement anticipé d'un tournoi : abréger ses étapes d'avant-course
 * (masqué, annoncé, inscriptions, clôture), puis le démarrer.
 *
 * Le module n'invente aucun coup d'envoi. Il ramène les quatre jalons au plus
 * tôt (`lib/shared/tournament-launch.ts`, pur et partagé avec l'interface) puis
 * laisse `syncTournamentState` faire ce qu'il aurait fait à l'heure annoncée :
 * clôture d'un plateau désert, initialisation du format, génération de la
 * première manche, réconciliation. **Aucun format n'a donc à connaître le
 * lancement anticipé**, et un format ajouté demain en héritera sans une ligne
 * ici — c'est tout l'intérêt de passer par les dates plutôt que d'écrire
 * `state = 'RUNNING'` à la main, ce qu'une simple synchronisation viendrait de
 * toute façon défaire.
 *
 * Tout tient dans une transaction, y compris la synchronisation : si
 * l'initialisation du format échoue, les dates abrégées sont annulées avec elle
 * et le tournoi reste aux inscriptions. Le contraire laisserait un tournoi
 * marqué « en cours » sans plateau ni classement.
 */
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import { toIso } from "@/lib/server/serialization";
import {
  launchBlockReason,
  shortenScheduleForLaunch,
  type LaunchableTournament,
} from "@/lib/shared/tournament-launch";
import type { TournamentState } from "@/lib/shared/types";
import { discardBotLogs, flushBotLogs } from "./bot-logs";
import { publishUpdatedEvent } from "./notifications";
import { syncTournamentState } from "./state";
import { validateDateOrder } from "./validation";

/** Ce que le lancement a produit, pour le message rendu à l'organisateur. */
export type LaunchedTournament = {
  id: number;
  name: string;
  /**
   * État **après** synchronisation. `RUNNING` dans le cas nominal, `FINISHED`
   * si le plateau comptait moins de deux engagées : le tournoi est alors clos
   * sur-le-champ (`docs/features/UNDERFILLED_TOURNAMENTS.md`), et l'interface
   * doit le dire au lieu d'annoncer un tournoi en cours.
   */
  state: TournamentState;
  /** Effectif au moment du lancement — celui qui joue, et pas un de plus. */
  entrantCount: number;
};

interface LaunchRow extends RowDataPacket {
  id: number;
  name: string;
  state: TournamentState;
  start_visibility_at: Date;
  registration_open_at: Date;
  registration_close_at: Date;
  start_at: Date;
}

/**
 * Ligne verrouillée pour la durée de la transaction.
 *
 * `FOR UPDATE` et non une simple lecture : la fenêtre de lancement se décide
 * sur les dates, or deux membres du staff peuvent cliquer en même temps, et
 * l'un d'eux doit lire les jalons déjà abrégés par l'autre pour se voir refuser
 * un second départ (`TOURNAMENT_ALREADY_STARTED`).
 */
async function loadLaunchRow(
  connection: PoolConnection,
  tournamentId: number,
): Promise<LaunchRow | null> {
  const [rows] = await connection.execute<LaunchRow[]>(
    `SELECT id, name, state,
            start_visibility_at, registration_open_at, registration_close_at, start_at
     FROM bg_tournaments
     WHERE id = ?
     LIMIT 1
     FOR UPDATE`,
    [tournamentId],
  );

  return rows.length === 0 ? null : rows[0];
}

async function countEntrants(
  connection: PoolConnection,
  tournamentId: number,
): Promise<number> {
  const [rows] = await connection.execute<(RowDataPacket & { c: number })[]>(
    `SELECT COUNT(*) AS c FROM bg_tournament_registrations WHERE tournament_id = ?`,
    [tournamentId],
  );
  return Number(rows[0]?.c ?? 0);
}

/**
 * Abrège les étapes d'avant-course du tournoi et le démarre immédiatement.
 *
 * @throws `TOURNAMENT_NOT_FOUND` — identifiant inconnu.
 * @throws le code de `LaunchBlockReason` — la fenêtre de lancement est fermée.
 * @throws `INVALID_DATE_ORDER` — filet : les jalons abrégés se suivent par
 *   construction, mais rien n'écrit de dates incohérentes dans `bg_tournaments`
 *   sans passer par ce contrôle, et ce n'est pas ici que l'exception commencera.
 */
export async function launchTournamentNow(tournamentId: number): Promise<LaunchedTournament> {
  const db = await getDatabase();
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    const row = await loadLaunchRow(connection, tournamentId);
    if (!row) throw new Error("TOURNAMENT_NOT_FOUND");

    const current: LaunchableTournament = {
      state: row.state,
      startVisibilityAt: toIso(row.start_visibility_at)!,
      registrationOpenAt: toIso(row.registration_open_at)!,
      registrationCloseAt: toIso(row.registration_close_at)!,
      startAt: toIso(row.start_at)!,
    };

    // La règle est rejouée ici, sous verrou : l'interface a pu armer son bouton
    // sur un tournoi qui, depuis, a démarré tout seul.
    const blocked = launchBlockReason(current);
    if (blocked) throw new Error(blocked);

    const entrantCount = await countEntrants(connection, tournamentId);

    const shortened = shortenScheduleForLaunch(current);
    const dateError = validateDateOrder(shortened);
    if (dateError) throw new Error(dateError);

    await connection.execute(
      `UPDATE bg_tournaments
       SET start_visibility_at = ?, registration_open_at = ?,
           registration_close_at = ?, start_at = ?
       WHERE id = ?`,
      [
        new Date(shortened.startVisibilityAt),
        new Date(shortened.registrationOpenAt),
        new Date(shortened.registrationCloseAt),
        new Date(shortened.startAt),
        tournamentId,
      ],
    );

    // Le coup d'envoi lui-même. La synchronisation relit la ligne dans cette
    // même transaction, y voit les jalons abrégés, et déroule son chemin
    // ordinaire — journal Discord (`tournament_started`) compris : le lancement
    // anticipé n'a pas d'entrée à lui, c'est le même fait accompli.
    const { row: synced } = await syncTournamentState(connection, tournamentId);

    await connection.commit();
    // Après le commit seulement : la synchronisation a pu réserver une ligne de
    // journal (départ, ou clôture faute d'adversaires) qu'un `rollback` aurait
    // dû jeter.
    flushBotLogs(connection);

    publishUpdatedEvent(tournamentId);

    return {
      id: Number(row.id),
      name: row.name,
      // `synced` ne peut être `null` que si le tournoi a disparu entre-temps,
      // ce que le verrou de ligne interdit. On se rabat malgré tout sur
      // l'état calculé plutôt que de risquer un accès sur `null`.
      state: synced?.state ?? "RUNNING",
      entrantCount,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    discardBotLogs(connection);
    connection.release();
  }
}

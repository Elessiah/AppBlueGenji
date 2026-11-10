/**
 * Rediffusion d'un match : écriture du lien YouTube.
 *
 * La règle vit dans le module pur `lib/shared/match-replay.ts` ; ce fichier ne
 * fait que l'appliquer à la base et publier l'événement qui réveille les pages
 * ouvertes — le lien voyage ensuite dans l'instantané du flux SSE, comme le
 * reste du plateau.
 *
 * Réservé à la permission `live` (admin, arbitre, caster) : c'est la suite
 * naturelle du cast, que pose déjà ce même public. Un porteur de la seule
 * `live` n'y touche que sur **son** cast ; le staff `tournaments` (dont
 * l'arbitre désigné) sur tout match (décision du 2026-11-09).
 */
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { canHaveReplay, normalizeReplayUrl } from "@/lib/shared/match-replay";
import { castBeforeLaunch } from "@/lib/shared/match-launch";
import type { MatchStatus, TournamentGame } from "@/lib/shared/types";
import { nullableId } from "@/lib/shared/nullable-id";
import { loadShownCasterIds } from "./cast-eligibility";
import { retryOnDeadlock } from "./deadlock-retry";
import { publishMatchUpdatedEvent } from "./notifications";
import { inTransaction } from "./transaction";

type MatchReplayRow = RowDataPacket & {
  id: number;
  tournament_id: number;
  status: MatchStatus;
  team1_id: number | null;
  team2_id: number | null;
  forfeit_team_id: number | null;
  double_forfeit: number | null;
  launched_at: Date | null;
  launch_pairing: string | null;
};

/**
 * Le lecteur caste-t-il ce match **et y est-il montré** ? Avant le lancement
 * (match rouvert), un caster tu (`loadShownCasterIds` : condition du cast
 * perdue) ne règle plus la rediff, pas même pour l'effacer.
 */
async function castsShownOn(connection: PoolConnection, row: MatchReplayRow, userId: number): Promise<boolean> {
  const beforeLaunch = castBeforeLaunch(row);
  // Le jeu ne sert qu'à la condition du cast, jugée avant le lancement
  // seulement : un match joué ou lancé ne le relit pas. Il n'entre pas dans la
  // lecture verrouillée du match (sous-requête) : sous MariaDB, un `FOR UPDATE`
  // ne doit lire qu'une table.
  const game = beforeLaunch ? await tournamentGame(connection, Number(row.tournament_id)) : "OW";
  const shown = await loadShownCasterIds(connection, Number(row.id), [userId], game, beforeLaunch);
  return shown.has(userId);
}

/** Le jeu du tournoi (`OW` par défaut). */
async function tournamentGame(connection: PoolConnection, tournamentId: number): Promise<TournamentGame> {
  const [games] = await connection.execute<(RowDataPacket & { game: TournamentGame })[]>(
    `SELECT game FROM bg_tournaments WHERE id = ?`,
    [tournamentId],
  );
  return games[0]?.game ?? "OW";
}

/** La ligne lue décrit-elle une rencontre réellement disputée ? (`canHaveReplay`) */
function isReplayableRow(row: MatchReplayRow): boolean {
  return canHaveReplay({
    status: row.status,
    team1Id: nullableId(row.team1_id),
    team2Id: nullableId(row.team2_id),
    forfeitTeamId: nullableId(row.forfeit_team_id),
    doubleForfeit: Number(row.double_forfeit ?? 0) === 1,
  });
}

/**
 * Pose (ou efface) le lien de rediff d'un match.
 *
 * `null` ou chaîne vide valent effacement, et l'effacement est **toujours**
 * permis — y compris sur un match rouvert par un retour en arrière : retirer un
 * lien posé par erreur ne doit dépendre d'aucun état. Poser un lien exige en
 * revanche une rencontre réellement disputée (`canHaveReplay`), sans quoi le
 * bandeau annoncerait la rediff d'un match qui n'a pas eu lieu.
 *
 * @returns le lien normalisé (`null` s'il a été effacé), et `changed` : le
 *   lien a changé — effacer un lien jamais posé, ou reposer le même, ne change
 *   rien, et le journal du staff ne le note pas.
 * `actor.manages` : permission `tournaments` — tout match ; sans elle, l'acteur
 * doit caster ce match (`NOT_MATCH_CASTER`).
 *
 * @throws `INVALID_REPLAY_URL` | `MATCH_NOT_FOUND` | `MATCH_NOT_REPLAYABLE` |
 *   `NOT_MATCH_CASTER`
 */
export async function setMatchReplayUrl(
  matchId: number,
  rawUrl: string | null,
  actor: { userId: number; manages: boolean },
): Promise<{ replayUrl: string | null; changed: boolean }> {
  const blank = rawUrl === null || rawUrl.trim() === "";
  const replayUrl = blank ? null : normalizeReplayUrl(rawUrl);
  if (!blank && replayUrl === null) throw new Error("INVALID_REPLAY_URL");

  // Le match se verrouille d'abord (seul, sans jointure : MariaDB) : le retrait
  // d'un caster (`releaseMatchCast`) prend le même verrou, et ne peut plus
  // passer entre la vérification du cast et l'écriture du lien.
  const { row, result } = await retryOnDeadlock(() =>
    inTransaction(async (connection) => {
      const [rows] = await connection.execute<MatchReplayRow[]>(
        `SELECT id, tournament_id, status, team1_id, team2_id, forfeit_team_id, double_forfeit,
                launched_at, launch_pairing
           FROM bg_matches WHERE id = ? FOR UPDATE`,
        [matchId],
      );
      if (rows.length === 0) throw new Error("MATCH_NOT_FOUND");
      const locked = rows[0];
      if (!actor.manages && !(await castsShownOn(connection, locked, actor.userId))) {
        throw new Error("NOT_MATCH_CASTER");
      }
      if (replayUrl !== null && !isReplayableRow(locked)) throw new Error("MATCH_NOT_REPLAYABLE");
      // L'effacement n'a aucune condition d'état ; la pose, lue sous le verrou,
      // ne peut plus voir le match rouvert entre la lecture et l'écriture.
      const [written] = await connection.execute(
        replayUrl === null
          ? `UPDATE bg_matches SET replay_url = NULL WHERE id = ?`
          : `UPDATE bg_matches SET replay_url = ? WHERE id = ? AND status = 'COMPLETED'`,
        replayUrl === null ? [matchId] : [replayUrl, matchId],
      );
      if (replayUrl !== null && Number((written as { affectedRows?: number }).affectedRows ?? 0) === 0) {
        throw new Error("MATCH_NOT_REPLAYABLE");
      }
      return { row: locked, result: written };
    }),
  );

  // « Changé » se lit dans la réponse de l'écriture (`changedRows`), pas dans la
  // lecture d'avant : deux effacements simultanés n'en comptent qu'un, et un lien
  // identique à celui en base ne change rien.
  const changed = Number((result as { changedRows?: number }).changedRows ?? 0) > 0;
  if (changed) publishMatchUpdatedEvent(Number(row.tournament_id));
  return { replayUrl, changed };
}

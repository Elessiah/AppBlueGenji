/**
 * Tirage au sort de l'ordre de départ (`docs/features/RANDOM_SEEDING.md`).
 * Règles pures : `lib/shared/random-seeding.ts`.
 */
import { randomInt } from "node:crypto";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { isRandomDrawDue, randomDrawInputOf, shuffleOrder } from "@/lib/shared/random-seeding";
import type { TournamentState } from "@/lib/shared/types";

type DrawRow = RowDataPacket & {
  state: TournamentState;
  random_seeding: number | null;
  random_seeding_drawn_at: Date | string | null;
  registration_close_at: Date | string;
};

/**
 * Tire au sort l'ordre de départ si le tirage est dû (`isRandomDrawDue`), sur
 * la connexion et dans la transaction de l'appelant.
 *
 * Tout se relit **en lecture verrouillante** — le tournoi d'abord, puis les
 * inscriptions : une lecture `FOR UPDATE` voit le dernier état validé même
 * après une lecture ordinaire de la transaction (piège `REPEATABLE READ`), et
 * deux entretiens concurrents ne tirent donc jamais deux fois. Un plateau déjà
 * présent (aucun ne naît avant le coup d'envoi) arrête tout : on ne réécrit
 * jamais l'ordre d'un tirage joué.
 *
 * L'ordre tiré s'écrit dans `seed` (1 à N) et passe le tournoi en ordre manuel
 * (`manual_seeding = 1`) : tous les moteurs le lisent alors tel quel, formats à
 * classement compris. `random_seeding_drawn_at` date le tirage (heure du
 * processus, comme la clôture qu'il suit).
 *
 * @param pick tirage uniforme de `[0, n)` ; `crypto.randomInt` par défaut.
 * @returns `true` si un tirage a été écrit.
 */
export async function drawRandomSeedingIfDue(
  connection: PoolConnection,
  tournamentId: number,
  now: Date = new Date(),
  pick: (maxExclusive: number) => number = randomInt,
): Promise<boolean> {
  const [rows] = await connection.execute<DrawRow[]>(
    `SELECT state, random_seeding, random_seeding_drawn_at, registration_close_at
     FROM bg_tournaments WHERE id = ? LIMIT 1 FOR UPDATE`,
    [tournamentId],
  );
  const row = rows[0];
  if (!row) return false;
  if (!isRandomDrawDue(randomDrawInputOf(row), now.getTime())) return false;

  const [matches] = await connection.execute<RowDataPacket[]>(
    `SELECT id FROM bg_matches WHERE tournament_id = ? LIMIT 1`,
    [tournamentId],
  );
  if (matches.length > 0) return false;

  const [registrations] = await connection.execute<(RowDataPacket & { team_id: number })[]>(
    `SELECT team_id FROM bg_tournament_registrations
     WHERE tournament_id = ?
     ORDER BY COALESCE(seed, 1000000), registered_at ASC
     FOR UPDATE`,
    [tournamentId],
  );
  const drawn = shuffleOrder(
    registrations.map((registration) => Number(registration.team_id)),
    pick,
  );
  await writeSeedOrder(connection, tournamentId, drawn);
  await connection.execute(
    `UPDATE bg_tournaments SET manual_seeding = 1, random_seeding_drawn_at = ? WHERE id = ?`,
    [now, tournamentId],
  );
  return true;
}

/**
 * Écrit l'ordre `teamIds` dans `seed` (1 à N) en **une** instruction
 * (`CASE team_id`) : le tirage et son extinction ne paient pas un aller-retour
 * par engagée sous le verrou du tournoi. Rien à écrire sur une liste vide.
 */
export async function writeSeedOrder(
  connection: PoolConnection,
  tournamentId: number,
  teamIds: readonly number[],
): Promise<void> {
  if (teamIds.length === 0) return;
  const cases = teamIds.map(() => "WHEN ? THEN ?").join(" ");
  const placeholders = teamIds.map(() => "?").join(", ");
  await connection.execute(
    `UPDATE bg_tournament_registrations SET seed = CASE team_id ${cases} END
     WHERE tournament_id = ? AND team_id IN (${placeholders})`,
    [...teamIds.flatMap((teamId, index) => [teamId, index + 1]), tournamentId, ...teamIds],
  );
}

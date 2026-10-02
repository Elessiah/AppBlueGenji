/**
 * BlueGenji Survie — phase qualificative (`docs/features/BG_SURVIE_MODE.md`) :
 *
 * - `initializeEnduranceTournament` — sème le classement depuis le classement
 *   du site (ou l'ordre fixé à la main par le staff) et pose le barème ;
 * - `generateEnduranceRound` — apparie et crée les matchs de la manche suivante.
 */

import type { PoolConnection } from "mysql2/promise";
import { loadEntrantsBySiteRanking } from "@/lib/server/ranking-service";
import { qualificationComplete, roundLimitReached } from "@/lib/shared/bg-survie/qualification";
import {
  planEnduranceRound,
  rankActiveTeams,
  type EnduranceStanding,
} from "@/lib/shared/bg-survie/standings";
import { createMatch, loadRegisteredTeamIds } from "../repository";
import { loadEnduranceStandings, persistStandings } from "./standings-store";
import { configOf, loadTournament } from "./tournament-row";

/** Manches de la phase qualificative : bracket UPPER, phase_id 0. */
const QUALIFICATION_BRACKET = "UPPER" as const;

/**
 * Sème le classement initial.
 *
 * Même règle que la Survie et la Ronde suisse : le **classement du site**
 * (`loadEntrantsBySiteRanking`, la cote Elo), sauf si le staff a fixé l'ordre à
 * la main (`manual_seeding`, `docs/features/SEEDING_ORDER.md`) — l'ordre des
 * inscriptions prime alors. `seedingSource` (`lib/shared/seeding.ts`) dit la
 * même chose à l'interface et à l'aperçu du plateau.
 */
export async function initializeEnduranceTournament(
  tournamentId: number,
  conn: PoolConnection,
): Promise<void> {
  const tournament = await loadTournament(conn, tournamentId);
  if (tournament?.format !== "BG_SURVIE") return;

  const config = configOf(tournament);

  // Ordre saisi par le staff, sinon classement du site par le chargeur unique :
  // mêmes matchs comptés et même ordre que l'annuaire et l'aperçu du plateau.
  const teamIds =
    Number(tournament.manual_seeding ?? 0) === 1
      ? await loadRegisteredTeamIds(conn, tournamentId)
      : (await loadEntrantsBySiteRanking(conn, tournamentId)).map((entrant) => entrant.teamId);

  const standings: EnduranceStanding[] = teamIds.map((teamId, index) => ({
    teamId,
    seed: index + 1,
    points: config.startPoints,
    wins: 0,
    losses: 0,
    draws: 0,
    status: "ACTIVE",
    eliminatedRound: null,
    rank: index + 1,
    previousRank: index + 1,
  }));

  await persistStandings(conn, tournamentId, standings);

  // Fige le barème effectif : les valeurs par défaut deviennent explicites,
  // pour que l'affichage et un futur changement de défaut ne modifient pas un
  // tournoi déjà lancé.
  await conn.execute(
    `UPDATE bg_tournaments
     SET endurance_start_points = ?, endurance_win_delta = ?, endurance_loss_delta = ?,
         endurance_playoff_size = ?, endurance_max_rounds = ?,
         endurance_current_round = 0, endurance_playoffs_started = 0,
         bracket_size = ?
     WHERE id = ?`,
    [
      config.startPoints,
      config.winDelta,
      config.lossDelta,
      config.playoffSize,
      config.maxRounds,
      standings.length,
      tournamentId,
    ],
  );
}

/**
 * Crée les matchs de la manche suivante de la phase qualificative.
 *
 * Ne fait rien si la phase est terminée (effectif retombé à la cible), si les
 * play-offs ont commencé, ou s'il reste moins de deux équipes.
 */
export async function generateEnduranceRound(
  tournamentId: number,
  conn: PoolConnection,
): Promise<void> {
  const tournament = await loadTournament(conn, tournamentId);
  if (tournament?.format !== "BG_SURVIE") return;
  if (Number(tournament.endurance_playoffs_started) === 1) return;

  const config = configOf(tournament);
  const standings = await loadEnduranceStandings(conn, tournamentId);
  const active = rankActiveTeams(standings);

  if (active.length < 2 || qualificationComplete(active.length, config)) return;

  const nextRound = Number(tournament.endurance_current_round) + 1;

  // Plafond de manches : on n'en pose jamais une de plus. Le rejeu a déjà
  // tranché qui est qualifié à la dernière manche — c'est `reconcileEndurance`
  // qui enchaîne sur les play-offs, ici il n'y a plus rien à apparier.
  if (roundLimitReached(config, nextRound - 1)) return;
  const pairings = planEnduranceRound(standings);

  let matchNumber = 1;
  for (const pairing of pairings) {
    // Effectif impair : la dernière ne joue pas et son capital reste intact —
    // aucun match n'est donc créé pour elle (pas de victoire d'office ici).
    if (pairing.teamBId === null) continue;

    const matchId = await createMatch(
      conn,
      tournamentId,
      QUALIFICATION_BRACKET,
      nextRound,
      matchNumber,
      0,
    );
    await conn.execute(
      `UPDATE bg_matches SET team1_id = ?, team2_id = ?, status = 'READY', is_bye = 0 WHERE id = ?`,
      [pairing.teamAId, pairing.teamBId, matchId],
    );
    matchNumber += 1;
  }

  await conn.execute(`UPDATE bg_tournaments SET endurance_current_round = ? WHERE id = ?`, [
    nextRound,
    tournamentId,
  ]);
}

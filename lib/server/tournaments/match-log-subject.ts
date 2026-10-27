/**
 * Le match tel qu'une ligne du journal du staff le désigne : tournoi, manche,
 * engagés (`LogEntrant`, qui écrit « un joueur » en tournoi individuel).
 * Partagé par les avis de cast (`./cast-notices`) et les gestes du staff
 * (`./staff-action-logs`).
 */
import type { RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import type { BotLogTournament } from "@/lib/shared/bot-logs";
import type { LogEntrant } from "@/lib/shared/log-privacy";
import { toParticipantType, type ParticipantType } from "@/lib/shared/participants";
import { isSwissRound, swissRoundSql } from "./swiss-round-sql";

export type MatchLogRow = RowDataPacket & {
  id: number;
  bracket: string;
  round_number: number;
  swiss_round: number | null;
  team1_name: string | null;
  team2_name: string | null;
  tournament_id: number;
  tournament_name: string;
  participant_type: string | null;
};

/** Le match `matchId`, ou `null` s'il n'existe plus. */
export async function loadMatchLogRow(matchId: number): Promise<MatchLogRow | null> {
  const db = await getDatabase();
  const [rows] = await db.execute<MatchLogRow[]>(
    `SELECT m.id, m.bracket, m.round_number, ${swissRoundSql("m", "tr")},
            t1.name AS team1_name, t2.name AS team2_name,
            tr.id AS tournament_id, tr.name AS tournament_name, tr.participant_type
       FROM bg_matches m
       JOIN bg_tournaments tr ON tr.id = m.tournament_id
       LEFT JOIN bg_teams t1 ON t1.id = m.team1_id
       LEFT JOIN bg_teams t2 ON t2.id = m.team2_id
      WHERE m.id = ?
      LIMIT 1`,
    [matchId],
  );
  return rows[0] ?? null;
}

/** Ce qu'une ligne du journal lit d'un match. */
export interface MatchLogSubject {
  tournament: BotLogTournament;
  matchId: number;
  bracket: string;
  roundNumber: number;
  swiss: boolean;
  team1: LogEntrant | null;
  team2: LogEntrant | null;
  participantType: ParticipantType;
}

export function matchLogSubject(row: MatchLogRow): MatchLogSubject {
  const participantType = toParticipantType(row.participant_type);
  const entrant = (name: string | null): LogEntrant | null => (name === null ? null : { name, participantType });
  return {
    tournament: { id: Number(row.tournament_id), name: row.tournament_name },
    matchId: Number(row.id),
    bracket: String(row.bracket),
    roundNumber: Number(row.round_number),
    swiss: isSwissRound(row),
    team1: entrant(row.team1_name),
    team2: entrant(row.team2_name),
    participantType,
  };
}

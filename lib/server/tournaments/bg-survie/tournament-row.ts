/**
 * BlueGenji Survie — lecture de la ligne du tournoi et des réglages qu'elle
 * porte : barème d'endurance et format de la phase qualificative (`docs/features/BG_SURVIE_MODE.md`).
 *
 * La logique du mode est pure (`lib/shared/bg-survie/`) ; les modules de ce
 * dossier ne font que lire et écrire la base.
 */

import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { resolveEnduranceConfig, type EnduranceConfig } from "@/lib/shared/bg-survie/config";
import { parseMatchFormat, type MatchFormat } from "@/lib/shared/match-format";

type TournamentEnduranceRow = RowDataPacket & {
  format: string;
  state: string;
  match_format_type: string | null;
  match_format_value: number | null;
  match_format_max_maps: number | null;
  match_format_draws: number;
  endurance_start_points: number | null;
  endurance_win_delta: number | null;
  endurance_loss_delta: number | null;
  endurance_playoff_size: number | null;
  endurance_max_rounds: number | null;
  endurance_current_round: number;
  endurance_playoffs_started: number;
  has_third_place_match: number;
  manual_seeding: number;
};

/**
 * Lit la ligne du tournoi.
 *
 * `forUpdate` la **verrouille** — à réserver aux écritures dont une garde
 * dépend de l'état lu (abandon, pénalités). Une lecture ordinaire sert
 * l'instantané de la transaction, qui peut dater d'avant la clôture du tournoi
 * par une transaction voisine ; une lecture verrouillante rend, elle, la
 * dernière version validée et fait attendre l'écrivain concurrent. C'est ce que
 * font déjà `forfeitSurvivalTeam` et `forfeitSwissTeam`.
 */
export async function loadTournament(
  conn: PoolConnection,
  tournamentId: number,
  forUpdate = false,
): Promise<TournamentEnduranceRow | null> {
  const [rows] = await conn.execute<TournamentEnduranceRow[]>(
    `SELECT format, state, match_format_type, match_format_value,
            match_format_max_maps, match_format_draws,
            endurance_start_points, endurance_win_delta, endurance_loss_delta,
            endurance_playoff_size, endurance_max_rounds, endurance_current_round,
            endurance_playoffs_started, has_third_place_match, manual_seeding
     FROM bg_tournaments WHERE id = ? LIMIT 1${forUpdate ? " FOR UPDATE" : ""}`,
    [tournamentId],
  );
  return rows.length === 0 ? null : rows[0];
}

export function configOf(tournament: TournamentEnduranceRow): EnduranceConfig {
  return resolveEnduranceConfig({
    startPoints: tournament.endurance_start_points ?? undefined,
    winDelta: tournament.endurance_win_delta ?? undefined,
    lossDelta: tournament.endurance_loss_delta ?? undefined,
    playoffSize: tournament.endurance_playoff_size ?? undefined,
    maxRounds: tournament.endurance_max_rounds ?? undefined,
  });
}

/**
 * Format de la **phase qualificative** (`null` = score libre). C'est lui qui
 * chiffre un forfait : en FT3, l'équipe partie encaisse un 3-0. C'est aussi le
 * seul des deux qui puisse autoriser une égalité.
 */
export function matchFormatOf(tournament: TournamentEnduranceRow): MatchFormat | null {
  return parseMatchFormat(
    tournament.match_format_type,
    tournament.match_format_value,
    tournament.match_format_max_maps,
    tournament.match_format_draws,
  );
}

/**
 * Arbitre qui tranche **son propre** litige (`docs/features/SCORE_DISPUTE_LOCK.md`
 * § Arbitre qui joue, décision du 2026-10-20) : le geste reste permis — une
 * petite organisation n'a pas toujours un arbitre neutre sous la main —, mais
 * les **autres** membres du staff en sont avertis (push
 * `REFEREE_SELF_RESOLUTION`, l'auteur exclu) et le geste est journalisé
 * (`publishStaffAction` : anonyme sur Discord, nommé dans pm2).
 *
 * Tout part **après** le commit et au meilleur effort : l'arbitrage est acquis,
 * une alerte perdue ne le défait pas.
 */
import type { RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import { loadEntrantPlayerIds, notifyStaff } from "@/lib/server/notify";
import { publishStaffAction } from "@/lib/server/staff-audit";
import { matchRoundLabel } from "@/lib/shared/discord-notifications";
import { discordInline } from "@/lib/shared/discord-text";
import type { StaffActor } from "@/lib/shared/log-privacy";
import {
  selfResolvedDisputePush,
  selfResolvedOutcomeText,
  type SelfResolvedDispute,
  type SelfResolvedOutcome,
} from "@/lib/shared/push-messages";

/** Le litige tel que l'arbitrage l'a trouvé, lu sous verrou avant de trancher. */
export type DisputeBeforeResolution = {
  matchId: number;
  tournamentId: number;
  team1Id: number;
  team2Id: number;
};

type ResolvedMatchRow = RowDataPacket & {
  tournament_name: string;
  tournament_format: string;
  participant_type: string;
  bracket: string;
  round_number: number;
  team1_score: number | null;
  team2_score: number | null;
  forfeit_team_id: number | null;
  double_forfeit: number | null;
  team1_name: string | null;
  team2_name: string | null;
};

/** L'issue écrite en base, telle que l'alerte la décrit. */
export function resolvedOutcome(
  row: Pick<ResolvedMatchRow, "team1_score" | "team2_score" | "forfeit_team_id" | "double_forfeit">,
  team1Id: number,
): SelfResolvedOutcome {
  if (Number(row.double_forfeit ?? 0) === 1) return { kind: "doubleForfeit" };
  if (row.forfeit_team_id !== null) {
    return { kind: "forfeit", forfeitSide: Number(row.forfeit_team_id) === team1Id ? 1 : 2 };
  }
  return { kind: "score", team1Score: Number(row.team1_score ?? 0), team2Score: Number(row.team2_score ?? 0) };
}

/**
 * Ligne du journal Discord (français, `publishStaffAction`) : le staff y reste
 * anonyme, aucun joueur n'est nommé ; les noms d'équipe sont permis, neutralisés.
 */
export function selfResolvedDisputeLog(input: SelfResolvedDispute): string {
  const round = matchRoundLabel(input.bracket, input.roundNumber, input.swiss);
  const outcome = selfResolvedOutcomeText(input, "fr", discordInline);
  return `⚠️ Litige tranché par un membre du staff qui joue ce match · « ${discordInline(input.tournamentName)} », ${round} : ${outcome}.`;
}

/**
 * Avertit les autres membres du staff si l'arbitre qui vient de trancher un
 * litige joue la manche (membre actuel d'une des deux équipes, ou joueur d'une
 * entrée solo). Rien sinon. Ne lève jamais.
 */
export async function alertSelfResolvedDispute(
  dispute: DisputeBeforeResolution,
  actor: StaffActor,
): Promise<boolean> {
  try {
    const players = await loadEntrantPlayerIds([dispute.team1Id, dispute.team2Id]);
    const plays = [dispute.team1Id, dispute.team2Id].some((teamId) => players.get(teamId)?.includes(actor.id));
    if (!plays) return false;

    const db = await getDatabase();
    const [rows] = await db.execute<ResolvedMatchRow[]>(
      `SELECT t.name AS tournament_name, t.format AS tournament_format, t.participant_type,
              m.bracket, m.round_number, m.team1_score, m.team2_score, m.forfeit_team_id, m.double_forfeit,
              t1.name AS team1_name, t2.name AS team2_name
         FROM bg_matches m
         JOIN bg_tournaments t ON t.id = m.tournament_id
         LEFT JOIN bg_teams t1 ON t1.id = m.team1_id
         LEFT JOIN bg_teams t2 ON t2.id = m.team2_id
        WHERE m.id = ?
        LIMIT 1`,
      [dispute.matchId],
    );
    const row = rows[0];
    if (!row) return false;

    const input: SelfResolvedDispute = {
      tournamentId: dispute.tournamentId,
      tournamentName: String(row.tournament_name),
      matchId: dispute.matchId,
      bracket: String(row.bracket),
      roundNumber: Number(row.round_number),
      swiss: row.tournament_format === "SWISS",
      team1Name: String(row.team1_name ?? ""),
      team2Name: String(row.team2_name ?? ""),
      solo: row.participant_type === "SOLO",
      outcome: resolvedOutcome(row, dispute.team1Id),
    };

    publishStaffAction(selfResolvedDisputeLog(input), actor);
    await notifyStaff({
      topic: "REFEREE_SELF_RESOLUTION",
      excludeUserIds: [actor.id],
      push: (locale) => selfResolvedDisputePush(input, locale),
    });
    return true;
  } catch {
    return false;
  }
}

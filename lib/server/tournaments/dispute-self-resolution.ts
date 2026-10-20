/**
 * Arbitre qui tranche **son propre** litige, ou qui suspend la validation
 * d'office d'un report seul sur un match qu'il joue
 * (`docs/features/SCORE_DISPUTE_LOCK.md` § Arbitre qui joue, décisions du
 * 2026-10-20) : le geste reste permis — une petite organisation n'a pas
 * toujours un arbitre neutre sous la main —, mais les **autres** membres du
 * staff en sont avertis (push `REFEREE_SELF_RESOLUTION`, l'auteur exclu) et le
 * geste est journalisé (`publishStaffAction` : anonyme sur Discord, nommé dans
 * pm2). Seul membre du staff : personne à prévenir, le journal reste.
 *
 * Tout part **après** le commit et au meilleur effort : l'arbitrage est acquis,
 * une alerte perdue ne le défait pas.
 */
import type { RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import { notifyStaff } from "@/lib/server/notify";
import { publishStaffAction } from "@/lib/server/staff-audit";
import { matchRoundLabel } from "@/lib/shared/discord-notifications";
import { discordInline } from "@/lib/shared/discord-text";
import { isSwissRound, swissRoundSql } from "./swiss-round-sql";
import type { StaffActor } from "@/lib/shared/log-privacy";
import {
  selfPausedValidationPush,
  selfResolvedDisputePush,
  selfResolvedOutcomeText,
  type SelfResolvedDispute,
  type SelfResolvedOutcome,
} from "@/lib/shared/push-messages";

/**
 * La manche telle que l'arbitrage l'a trouvée, lue sous verrou avant d'écrire :
 * le litige à trancher, ou le report seul dont la validation est suspendue.
 */
export type DisputeBeforeResolution = {
  matchId: number;
  tournamentId: number;
  team1Id: number;
  team2Id: number;
};

type ResolvedMatchRow = RowDataPacket & {
  tournament_name: string;
  /** Ronde suisse — tournoi `SWISS` ou phase suisse d'un `MULTI` (`swissRoundSql`). */
  swiss_round?: number | boolean | null;
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
 * L'arbitre joue-t-il la manche ? Membre d'une des deux équipes — **encore**
 * membre, ou parti depuis que la manche existe (`m.created_at`) : quitter
 * l'équipe juste avant de trancher, puis la rejoindre, n'efface pas l'alerte —,
 * ou joueur d'une entrée solo.
 */
async function actorPlaysMatch(
  match: DisputeBeforeResolution,
  actorId: number,
  sides: readonly number[],
): Promise<boolean> {
  const [first, second = first] = sides;
  const db = await getDatabase();
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT 1 FROM bg_matches m
      WHERE m.id = ?
        AND (EXISTS (SELECT 1 FROM bg_team_members tm
                      WHERE tm.team_id IN (?, ?) AND tm.user_id = ?
                        AND (tm.left_at IS NULL OR tm.left_at >= m.created_at))
             OR EXISTS (SELECT 1 FROM bg_teams st
                         WHERE st.id IN (?, ?) AND st.solo_user_id = ?))
      LIMIT 1`,
    [match.matchId, first, second, actorId, first, second, actorId],
  );
  return rows.length > 0;
}

/** Tournoi, manche, noms et issue écrite de la manche, pour l'alerte. */
async function loadAlertMatch(match: DisputeBeforeResolution): Promise<SelfResolvedDispute | null> {
  const db = await getDatabase();
  const [rows] = await db.execute<ResolvedMatchRow[]>(
    `SELECT t.name AS tournament_name, ${swissRoundSql("m", "t")}, t.participant_type,
            m.bracket, m.round_number, m.team1_score, m.team2_score, m.forfeit_team_id, m.double_forfeit,
            t1.name AS team1_name, t2.name AS team2_name
       FROM bg_matches m
       JOIN bg_tournaments t ON t.id = m.tournament_id
       LEFT JOIN bg_teams t1 ON t1.id = m.team1_id
       LEFT JOIN bg_teams t2 ON t2.id = m.team2_id
      WHERE m.id = ?
      LIMIT 1`,
    [match.matchId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    tournamentId: match.tournamentId,
    tournamentName: String(row.tournament_name),
    matchId: match.matchId,
    bracket: String(row.bracket),
    roundNumber: Number(row.round_number),
    swiss: isSwissRound(row),
    team1Name: String(row.team1_name ?? ""),
    team2Name: String(row.team2_name ?? ""),
    solo: row.participant_type === "SOLO",
    outcome: resolvedOutcome(row, match.team1Id),
  };
}

/**
 * Ligne du journal Discord d'une suspension (français, `publishStaffAction`) :
 * staff anonyme, aucun nom d'engagé — le tournoi et la manche suffisent.
 */
export function selfPausedValidationLog(input: SelfResolvedDispute): string {
  const round = matchRoundLabel(input.bracket, input.roundNumber, input.swiss);
  return `⚠️ Validation automatique suspendue par un membre du staff qui joue ce match · « ${discordInline(input.tournamentName)} », ${round}.`;
}

type SelfActionKind = "resolved" | "paused";

/**
 * Avertit les autres membres du staff si l'arbitre qui vient d'agir joue la
 * manche. Rien sinon. Ne lève jamais.
 */
async function alertSelfAction(
  kind: SelfActionKind,
  match: DisputeBeforeResolution,
  actor: StaffActor,
  sides: readonly number[] = [match.team1Id, match.team2Id],
): Promise<boolean> {
  try {
    if (!(await actorPlaysMatch(match, actor.id, sides))) return false;
    const input = await loadAlertMatch(match);
    if (!input) return false;

    publishStaffAction(kind === "resolved" ? selfResolvedDisputeLog(input) : selfPausedValidationLog(input), actor);
    await notifyStaff({
      topic: "REFEREE_SELF_RESOLUTION",
      excludeUserIds: [actor.id],
      push: (locale) =>
        kind === "resolved" ? selfResolvedDisputePush(input, locale) : selfPausedValidationPush(input, locale),
    });
    return true;
  } catch (error) {
    // Le geste est acquis mais n'a pu être ni annoncé ni journalisé : au moins
    // une trace dans pm2, avec la manche et l'auteur (`[staff-audit]` n'est pas parti).
    console.error(`[staff-audit] alerte d'arbitre qui joue non envoyée (${kind}) — match #${match.matchId}, auteur #${actor.id}`, error);
    return false;
  }
}

/**
 * Litige tranché — « Valider le résultat », ou abandon forcé par l'arbitrage
 * (`forfeitTournamentTeamPublic`) qui clôt la manche en litige. `sides` : les
 * engagées où l'arbitre « joue » compte (les deux par défaut ; l'abandon ne
 * retient que l'adversaire de l'équipe retirée, à qui il profite).
 */
export function alertSelfResolvedDispute(
  dispute: DisputeBeforeResolution,
  actor: StaffActor,
  sides?: readonly number[],
): Promise<boolean> {
  return alertSelfAction("resolved", dispute, actor, sides);
}

/** « Enregistrer » qui vient de suspendre la validation d'office d'un report seul. */
export function alertSelfPausedValidation(match: DisputeBeforeResolution, actor: StaffActor): Promise<boolean> {
  return alertSelfAction("paused", match, actor);
}

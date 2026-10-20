/**
 * Arbitre qui tranche **son propre** litige, ou qui suspend la validation
 * d'office d'un report seul sur un match qu'il joue
 * (`docs/features/SCORE_DISPUTE_LOCK.md` § Arbitre qui joue, décisions du
 * 2026-10-20) : le geste reste permis — une petite organisation n'a pas
 * toujours un arbitre neutre sous la main —, mais les **autres** membres du
 * staff en sont avertis (push `REFEREE_SELF_RESOLUTION`, l'auteur exclu) et le
 * geste est journalisé (`publishStaffAction` : sur Discord, le tournoi et la
 * nature du geste seulement, staff anonyme ; dans pm2, manche, issue et auteur). Seul membre du staff : personne à prévenir, le journal reste.
 *
 * Tout part **après** le commit et au meilleur effort : l'arbitrage est acquis,
 * une alerte perdue ne le défait pas.
 */
import type { RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import { notifyStaff } from "@/lib/server/notify";
import { auditStaffAction, publishStaffAction } from "@/lib/server/staff-audit";
import { matchRoundLabel } from "@/lib/shared/discord-notifications";
import { discordInline } from "@/lib/shared/discord-text";
import { isSwissRound, swissRoundSql } from "./swiss-round-sql";
import type { StaffActor } from "@/lib/shared/log-privacy";
import type { ReportInstant } from "@/lib/shared/score-dispute";
import type { Locale } from "@/lib/shared/locales";
import type { PushContent } from "@/lib/shared/push-notifications";
import {
  selfCorrectedResultPush,
  selfImposedForfeitPush,
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
  /**
   * Premier report de la manche, lu sous verrou **avant** que l'arbitrage ne
   * l'efface : l'instant où elle s'est jouée, auquel se juge l'appartenance à
   * l'équipe. Absent : lancement, sinon création de la manche.
   */
  playedAt?: ReportInstant | null;
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
 * Ligne **détaillée** (manche, issue) d'un litige tranché, pour pm2 seulement
 * (`publishStaffAction`, `auditLine`) : Discord ne reçoit que
 * {@link selfActionDiscordLine}. Aucun joueur n'y est nommé.
 */
export function selfResolvedDisputeLog(input: SelfResolvedDispute): string {
  const round = matchRoundLabel(input.bracket, input.roundNumber, input.swiss);
  const outcome = selfResolvedOutcomeText(input, "fr", discordInline);
  return `⚠️ Litige tranché par un membre du staff qui joue ce match · « ${discordInline(input.tournamentName)} », ${round} : ${outcome}.`;
}

/**
 * L'arbitre « joue-t-il » la manche, c'est-à-dire y a-t-il un intérêt ? Membre
 * d'une des deux équipes — **encore** membre (quelle que soit sa date
 * d'arrivée : l'issue engage son équipe, et une date de report, que la resaisie
 * déplace et que la clôture efface, ne la borne pas sûrement), ou **parti
 * depuis que la manche a commencé** : au premier des deux, lancement ou premier
 * report (`playedAt`), sinon à sa création. Quitter l'équipe en cours de match,
 * ou juste avant d'agir, n'efface donc pas l'alerte ; un ancien membre parti
 * avant le match n'est pas visé. Ou joueur d'une entrée solo.
 */
async function actorPlaysMatch(
  match: DisputeBeforeResolution,
  actorId: number,
  sides: readonly number[],
): Promise<boolean> {
  const [first, second = first] = sides;
  const playedAt = match.playedAt ?? null;
  const db = await getDatabase();
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT 1 FROM bg_matches m
      WHERE m.id = ?
        AND (EXISTS (SELECT 1 FROM bg_team_members tm
                      WHERE tm.team_id IN (?, ?) AND tm.user_id = ?
                        AND (tm.left_at IS NULL
                             OR tm.left_at >= COALESCE(LEAST(COALESCE(m.launched_at, ?), COALESCE(?, m.launched_at)), m.created_at)))
             OR EXISTS (SELECT 1 FROM bg_teams st
                         WHERE st.id IN (?, ?) AND st.solo_user_id = ?))
      LIMIT 1`,
    [match.matchId, first, second, actorId, playedAt, playedAt, first, second, actorId],
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

/** Ligne détaillée (pm2) d'une correction de résultat acquis : mêmes règles que le litige tranché. */
export function selfCorrectedResultLog(input: SelfResolvedDispute): string {
  const round = matchRoundLabel(input.bracket, input.roundNumber, input.swiss);
  const outcome = selfResolvedOutcomeText(input, "fr", discordInline);
  return `⚠️ Résultat corrigé par un membre du staff qui joue ce match · « ${discordInline(input.tournamentName)} », ${round} : ${outcome}.`;
}

/** Ligne détaillée (pm2) d'un abandon imposé à l'adversaire. */
export function selfImposedForfeitLog(input: SelfResolvedDispute): string {
  const round = matchRoundLabel(input.bracket, input.roundNumber, input.swiss);
  const outcome = selfResolvedOutcomeText(input, "fr", discordInline);
  return `⚠️ Abandon imposé à son adversaire par un membre du staff qui joue ce match · « ${discordInline(input.tournamentName)} », ${round} : ${outcome}.`;
}

/** Ligne détaillée (pm2) d'une suspension : aucun nom d'engagé, le tournoi et la manche. */
export function selfPausedValidationLog(input: SelfResolvedDispute): string {
  const round = matchRoundLabel(input.bracket, input.roundNumber, input.swiss);
  return `⚠️ Validation automatique suspendue par un membre du staff qui joue ce match · « ${discordInline(input.tournamentName)} », ${round}.`;
}

export type SelfActionKind = "resolved" | "corrected" | "forfeited" | "paused";

/** Ce que dit la ligne Discord, par geste. */
const SELF_ACTION_DISCORD: Record<SelfActionKind, string> = {
  resolved: "Litige tranché",
  corrected: "Résultat corrigé",
  forfeited: "Abandon imposé à son adversaire",
  paused: "Validation automatique suspendue",
};

/**
 * Ligne du journal **Discord** (français) : le tournoi et la nature du geste,
 * rien d'autre — ni manche, ni issue, ni nom d'engagé, et le staff anonyme
 * (décision du 2026-10-20, `RGPD_LOGS_AND_VISITS.md`). Le détail et l'auteur
 * ne vivent que dans pm2.
 */
export function selfActionDiscordLine(kind: SelfActionKind, tournamentName: string): string {
  return `⚠️ ${SELF_ACTION_DISCORD[kind]} par un membre du staff qui joue ce match · « ${discordInline(tournamentName)} ».`;
}

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
  // Trace courte **avant** toute lecture (`auditStaffAction`, partie avant le
  // premier `await`, donc avant la réponse de la route) : un arrêt du serveur
  // entre le commit et la ligne détaillée ne laisse pas le geste sans auteur.
  auditStaffAction(`${SELF_ACTION_TRACE[kind]} — match #${match.matchId}`, actor);
  let logged = false;
  try {
    if (!(await actorPlaysMatch(match, actor.id, sides))) return false;
    const input = await loadAlertMatch(match);
    if (!input) return false;

    publishStaffAction(selfActionDiscordLine(kind, input.tournamentName), actor, SELF_ACTION_LOG[kind](input));
    logged = true;
    await notifyStaff({
      topic: "REFEREE_SELF_RESOLUTION",
      excludeUserIds: [actor.id],
      push: (locale) => SELF_ACTION_PUSH[kind](input, locale),
    });
    return true;
  } catch (error) {
    // Le geste est acquis ; dire ce qui manque, la manche et l'auteur (par son id).
    const missing = logged ? "push non envoyé" : "ni journalisée ni envoyée";
    console.error(`[staff-audit] alerte d'arbitre qui joue ${missing} (${kind}) — match #${match.matchId}, auteur #${actor.id}`, error);
    return false;
  }
}

/** Ligne détaillée du journal pm2, par geste. */
const SELF_ACTION_LOG: Record<SelfActionKind, (input: SelfResolvedDispute) => string> = {
  resolved: selfResolvedDisputeLog,
  corrected: selfCorrectedResultLog,
  forfeited: selfImposedForfeitLog,
  paused: selfPausedValidationLog,
};

/** Rédacteur du push, par geste. */
const SELF_ACTION_PUSH: Record<SelfActionKind, (input: SelfResolvedDispute, locale: Locale) => PushContent> = {
  resolved: selfResolvedDisputePush,
  corrected: selfCorrectedResultPush,
  forfeited: selfImposedForfeitPush,
  paused: selfPausedValidationPush,
};

/** Trace pm2 d'avant lecture, par geste. */
const SELF_ACTION_TRACE: Record<SelfActionKind, string> = {
  resolved: "Litige clos par l'arbitrage (vérification « arbitre qui joue »)",
  corrected: "Résultat acquis corrigé par l'arbitrage (vérification « arbitre qui joue »)",
  forfeited: "Manche close par un abandon imposé par l'arbitrage (vérification « arbitre qui joue »)",
  paused: "Validation automatique suspendue par l'arbitrage (vérification « arbitre qui joue »)",
};

/** Litige tranché par « Valider le résultat ». */
export function alertSelfResolvedDispute(dispute: DisputeBeforeResolution, actor: StaffActor): Promise<boolean> {
  return alertSelfAction("resolved", dispute, actor);
}

/**
 * Manche close par un abandon que l'arbitrage impose à une équipe
 * (`forfeitTournamentTeamPublic`), litige ou non : l'arbitre ne « joue » que du
 * côté de l'**adversaire** de l'équipe retirée (`sides`), à qui l'abandon
 * profite — retirer sa propre équipe est une concession.
 */
export function alertSelfImposedForfeit(
  match: DisputeBeforeResolution,
  actor: StaffActor,
  sides: readonly number[],
): Promise<boolean> {
  return alertSelfAction("forfeited", match, actor, sides);
}

/**
 * « Valider le résultat » sur un match **déjà tranché** (correction) : renverser
 * un résultat acquis — un litige tranché par un arbitre neutre, par exemple —
 * avertit comme trancher le litige.
 */
export function alertSelfCorrectedResult(match: DisputeBeforeResolution, actor: StaffActor): Promise<boolean> {
  return alertSelfAction("corrected", match, actor);
}

/** « Enregistrer » qui vient de suspendre la validation d'office d'un report seul. */
export function alertSelfPausedValidation(match: DisputeBeforeResolution, actor: StaffActor): Promise<boolean> {
  return alertSelfAction("paused", match, actor);
}

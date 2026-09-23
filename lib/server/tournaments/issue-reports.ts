/**
 * Signalement d'un problème par un engagé.
 *
 * Un tournoi se joue en soirée, sur Discord, pendant qu'un arbitre suit dix
 * plateaux : le joueur bloqué doit pouvoir alerter depuis la page où il est
 * déjà — la manche, ou le tournoi entier — sans chercher qui prévenir. Le
 * message part vers le canal de logs du bot **et** vers le rôle arbitre
 * configuré sur Discord (`/set-referee-role`).
 *
 * **Réservé aux engagés.** Ce n'est pas un formulaire de contact : le bouton
 * n'existe que pour qui est inscrit au tournoi, et le serveur le revérifie —
 * sans quoi n'importe quel visiteur pourrait faire sonner le téléphone des
 * arbitres.
 *
 * **L'auteur n'est pas nommé** : le message part sur Discord, qui ne reçoit
 * aucun pseudo de joueur (`lib/shared/log-privacy.ts`). Il est désigné par son
 * équipe — « un joueur de l'équipe X » —, et en tournoi individuel par « un
 * joueur » ; l'arbitre remonte à lui par la page du tournoi.
 *
 * La rédaction vit dans le module pur `lib/shared/discord-notifications.ts`.
 */
import type { RowDataPacket } from "mysql2/promise";
import { getDatabase, withConnection } from "@/lib/server/database";
import { toParticipantType } from "@/lib/shared/participants";
import { pushRefereeAlert } from "@/lib/server/bot-integration";
import {
  buildIssueReportMessage,
  matchRoundLabel,
  normalizeIssueReportMessage,
} from "@/lib/shared/discord-notifications";
import type { LogEntrant } from "@/lib/shared/log-privacy";
import { tournamentPageUrl } from "./app-url";
import { resolveUserEntrantTeamId } from "./registration";
import { loadTournamentRow } from "./repository";

type EntrantRow = RowDataPacket & {
  tournament_name: string;
  participant_type: string | null;
  entrant_name: string;
};

type MatchRow = RowDataPacket & {
  bracket: string;
  round_number: number;
  team1_name: string | null;
  team2_name: string | null;
};

/** Ce qu'un signalement dit au staff, une fois accepté. */
export interface IssueReportResult {
  /** Arbitres joints en message privé (le log part dans tous les cas). */
  notifiedReferees: number;
}

/**
 * Enregistre et relaie un signalement.
 *
 * @param tournamentId Tournoi visé.
 * @param userId Auteur du signalement.
 * @param rawMessage Texte saisi (validé ici, pas seulement dans l'interface).
 * @param matchId Manche visée, `null` pour un signalement portant sur le tournoi.
 * @returns Le nombre d'arbitres joints.
 * @throws `INVALID_ISSUE_MESSAGE` | `TOURNAMENT_NOT_FOUND` | `NOT_REGISTERED`
 *         | `MATCH_NOT_FOUND` | `BOT_INTERNAL_UNREACHABLE`
 */
export async function reportTournamentIssue(
  tournamentId: number,
  userId: number,
  rawMessage: unknown,
  matchId: number | null,
): Promise<IssueReportResult> {
  const message = normalizeIssueReportMessage(rawMessage);
  if (message === null) throw new Error("INVALID_ISSUE_MESSAGE");

  const db = await getDatabase();

  // Même résolution d'engagé que l'inscription, le report de score et
  // l'abandon : équipe active en tournoi par équipes, entrée solo en tournoi
  // individuel. Un `null` signifie « pas inscrit », donc pas de signalement.
  const entrantTeamId = await withConnection(async (connection) => {
    const tournament = await loadTournamentRow(connection, tournamentId);
    if (!tournament) throw new Error("TOURNAMENT_NOT_FOUND");
    return resolveUserEntrantTeamId(connection, tournament, userId);
  });
  if (entrantTeamId === null) throw new Error("NOT_REGISTERED");

  const [rows] = await db.execute<EntrantRow[]>(
    `SELECT t.name AS tournament_name, t.participant_type, e.name AS entrant_name
       FROM bg_tournaments t
       JOIN bg_tournament_registrations r
         ON r.tournament_id = t.id AND r.team_id = ?
       JOIN bg_teams e ON e.id = r.team_id
      WHERE t.id = ?
      LIMIT 1`,
    [entrantTeamId, tournamentId],
  );
  if (rows.length === 0) throw new Error("NOT_REGISTERED");
  const context = rows[0];
  const participantType = toParticipantType(context.participant_type);

  let match: { round: string; team1: LogEntrant | null; team2: LogEntrant | null; id: number } | null =
    null;
  if (matchId !== null) {
    const [matchRows] = await db.execute<MatchRow[]>(
      `SELECT m.bracket, m.round_number,
              t1.name AS team1_name, t2.name AS team2_name
         FROM bg_matches m
         LEFT JOIN bg_teams t1 ON t1.id = m.team1_id
         LEFT JOIN bg_teams t2 ON t2.id = m.team2_id
        WHERE m.id = ? AND m.tournament_id = ?
        LIMIT 1`,
      [matchId, tournamentId],
    );
    // Le match doit appartenir au tournoi : sans ce contrôle, un identifiant
    // pris ailleurs ferait décrire à l'arbitre une manche d'un autre plateau.
    if (matchRows.length === 0) throw new Error("MATCH_NOT_FOUND");
    const row = matchRows[0];
    match = {
      round: matchRoundLabel(String(row.bracket), Number(row.round_number)),
      team1: row.team1_name ? { name: row.team1_name, participantType } : null,
      team2: row.team2_name ? { name: row.team2_name, participantType } : null,
      id: matchId,
    };
  }

  const alert = await pushRefereeAlert(
    buildIssueReportMessage({
      tournamentName: String(context.tournament_name),
      tournamentUrl: tournamentPageUrl(tournamentId),
      entrant: { name: String(context.entrant_name), participantType },
      match,
      message,
    }),
    "issue-report",
  );

  // Le bot injoignable est remonté, pas avalé : répondre « signalement envoyé »
  // quand rien n'est parti laisserait le joueur attendre un arbitre qui n'a
  // rien reçu. Il reste alors le canal Discord habituel.
  if (alert === null) throw new Error("BOT_INTERNAL_UNREACHABLE");

  return { notifiedReferees: alert.sent };
}

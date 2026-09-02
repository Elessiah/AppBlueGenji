/**
 * Déclenchement du journal Discord : quoi journaliser, et quand l'envoyer.
 *
 * La rédaction vit dans le module pur `lib/shared/bot-logs.ts`. Ici, deux
 * problèmes bien concrets, que chaque appelant résoudrait sinon à sa façon :
 *
 * **1. Ne rien annoncer qui n'ait été écrit.** Les évènements naissent au cœur
 * d'une transaction (l'inscription s'insère, le match se clôt, le tournoi passe
 * « en cours »), et une transaction peut encore échouer après coup. On y
 * *réserve* donc une ligne — {@link queueBotLog} — que seul un commit convertit
 * en message ({@link flushBotLogs}), un échec la jetant avec le reste
 * ({@link discardBotLogs}). Un tournoi n'est jamais annoncé lancé par une
 * transaction qui a fini par rendre la main sur une erreur.
 *
 * **2. Ne pas faire porter la rédaction au moteur.** Une entrée en attente n'est
 * qu'un *renvoi* — « le match 42 s'est terminé » —, jamais un texte : les noms,
 * l'effectif et la championne sont relus **après** le commit, sur le pool. Le
 * moteur n'a donc aucun `JOIN` d'affichage à traîner sur ses chemins chauds, et
 * la ligne parle de l'état réellement enregistré (le classement final n'est
 * écrit qu'après la clôture, par exemple).
 *
 * **3. Choisir le canal une seule fois.** Tous les évènements ne vont pas au
 * même endroit : ceux qui appellent une intervention humaine partent au canal
 * arbitre (`POST /internal/notify/referees` : messages privés au rôle configuré
 * par `/set-referee-role`, plus une trace que le bot pose lui-même dans le canal
 * de logs), les autres au journal (`POST /internal/log`). Le tri est une règle
 * pure et unique — `lib/shared/referee-alerts.ts` — appliquée ici, à l'envoi :
 * aucun appelant ne le connaît, et un évènement ajouté demain est classé sans
 * qu'on touche au moteur. Chaque entrée part par **exactement un** transport,
 * ce qui interdit le doublon : le point d'entrée arbitre écrivant déjà dans le
 * canal de logs, l'y envoyer aussi par `sendBotLog` afficherait la ligne deux
 * fois dans le même salon.
 *
 * L'envoi lui-même reste au meilleur effort, comme tout ce qui passe par le
 * canal interne : ni la lecture ni l'écriture ne doivent échouer parce que le
 * bot dort. Un rôle arbitre non configuré n'y change rien — le bot répond 200
 * et se contente du log.
 */
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { pushRefereeAlert, sendBotLog } from "@/lib/server/bot-integration";
import { getDatabase } from "@/lib/server/database";
import {
  formatForfeitLog,
  formatMatchResultLog,
  formatRegistrationLog,
  formatTournamentCreatedLog,
  formatTournamentFinishedLog,
  formatTournamentStartedLog,
  formatUnderfilledTournamentLog,
  type BotEventKind,
} from "@/lib/shared/bot-logs";
import { SCORE_REPORT_TIMEOUT_MINUTES } from "@/lib/shared/constants";
import { toParticipantType } from "@/lib/shared/participants";
import {
  botEventChannel,
  formatScoreConflictAlert,
  formatStalledScoreReportAlert,
  type BotEventChannel,
  type RefereeAlertContext,
} from "@/lib/shared/referee-alerts";
import { tournamentPageUrl } from "./app-url";

/**
 * Évènement réservé pendant une transaction.
 *
 * Rien qu'un renvoi vers une ligne de la base : la résolution des noms est
 * faite après le commit (voir l'en-tête du module).
 */
export type PendingBotLog =
  | { kind: "tournament_created"; tournamentId: number }
  | { kind: "registration"; tournamentId: number; teamId: number; byStaff: boolean }
  | { kind: "forfeit"; tournamentId: number; teamId: number }
  | { kind: "match_finished"; matchId: number }
  | { kind: "score_conflict"; matchId: number }
  | { kind: "score_report_stalled"; matchId: number }
  | { kind: "tournament_started"; tournamentId: number }
  | { kind: "tournament_finished"; tournamentId: number }
  | { kind: "tournament_underfilled"; tournamentId: number };

/**
 * Garde de compilation : les natures d'entrée sont **exactement** celles que le
 * tri connaît (`BotEventKind`). Une entrée inventée ici sans être classée dans
 * `lib/shared/referee-alerts.ts` — ou l'inverse — ne compile pas, et le canal
 * d'un nouvel évènement ne peut donc pas rester indécis.
 */
type AssertSameKinds = [
  PendingBotLog["kind"] extends BotEventKind ? true : never,
  BotEventKind extends PendingBotLog["kind"] ? true : never,
];
const KINDS_MATCH: AssertSameKinds = [true, true];
void KINDS_MATCH;

/**
 * Une ligne prête à partir, le canal qui doit la porter, et l'entrée dont elle
 * vient.
 *
 * L'entrée voyage jusqu'au transport parce qu'un envoi qui échoue peut avoir à
 * **défaire** ce que sa mise en file avait réservé (voir `flushBotLogs`).
 */
export interface ResolvedBotLog {
  entry: PendingBotLog;
  channel: BotEventChannel;
  message: string;
}

/**
 * Clé de réservation de l'escalade « désaccord non tranché ».
 *
 * Déclarée ici, où vit `claimRefereeAlert`, parce que deux endroits doivent la
 * connaître : `resolveExpiredScoreReports`, qui réserve, et `flushBotLogs`, qui
 * rend la réservation si l'alerte n'est pas partie.
 */
export const STALLED_ALERT_KEY = "SCORE_REPORT_STALLED";

/** Une réservation d'alerte se pose et se retire par la même paire de clés. */
const RELEASE_ALERT_SQL = `DELETE FROM bg_referee_alerts WHERE match_id = ? AND alert_key = ?`;

/**
 * Plafond d'entrées retenues par transaction.
 *
 * Une transaction ordinaire en produit une ou deux ; les rares qui en produisent
 * plus (le dernier match d'un tournoi : fin de match **et** clôture) restent loin
 * du compte. Le plafond vise l'autre cas : le `seed`, qui rejoue des milliers de
 * matchs sur une même connexion sans jamais vider la file. Il borne l'empreinte
 * mémoire sans rien changer au fonctionnement nominal.
 */
const MAX_PENDING_PER_TRANSACTION = 32;

/**
 * Files en attente, indexées par connexion.
 *
 * Une `WeakMap` : la file suit la transaction sans que le module ait à connaître
 * son cycle de vie, et une connexion oubliée n'empêche pas sa file d'être
 * collectée.
 */
const pending = new WeakMap<PoolConnection, PendingBotLog[]>();

/** Deux entrées identiques dans une même transaction ne font qu'une ligne. */
function entryKey(entry: PendingBotLog): string {
  return JSON.stringify(entry);
}

/**
 * Réserve une ligne de journal, à envoyer si — et seulement si — la transaction
 * en cours aboutit.
 *
 * @returns `true` si l'évènement est retenu (une entrée identique déjà en file
 *          compte comme retenue : elle produira la même ligne), `false` s'il est
 *          **abandonné** parce que la file a atteint son plafond. Un appelant
 *          qui a réservé quelque chose en base avant de mettre en file doit
 *          lire ce retour : sans quoi la réservation serait consommée sans
 *          qu'aucun message ne parte, et jamais rejouée.
 */
export function queueBotLog(connection: PoolConnection, entry: PendingBotLog): boolean {
  const queue = pending.get(connection);
  if (!queue) {
    pending.set(connection, [entry]);
    return true;
  }
  // Le dédoublonnage passe **avant** le plafond : une entrée déjà en file est
  // retenue, elle n'est pas perdue, et l'annoncer perdue ferait rendre une
  // réservation encore utile.
  if (queue.some((existing) => entryKey(existing) === entryKey(entry))) return true;
  if (queue.length >= MAX_PENDING_PER_TRANSACTION) return false;
  queue.push(entry);
  return true;
}

/** Jette les lignes réservées : la transaction n'a pas abouti. */
export function discardBotLogs(connection: PoolConnection): void {
  pending.delete(connection);
}

/**
 * Envoie les lignes réservées par la transaction qui vient d'aboutir.
 *
 * **Sans attendre** : la résolution des noms et l'appel au bot se poursuivent en
 * arrière-plan, pour ne pas ajouter au temps de réponse d'un report de score le
 * délai d'un bot lent. Ne lève jamais.
 *
 * À appeler juste après le commit ; `discardBotLogs` couvre le chemin d'échec.
 */
export function flushBotLogs(connection: PoolConnection): void {
  const queue = pending.get(connection);
  pending.delete(connection);
  if (!queue || queue.length === 0) return;

  void (async () => {
    for (const { entry, channel, message } of await resolveBotLogs(queue)) {
      if (channel !== "REFEREE") {
        await sendBotLog(message);
        continue;
      }

      // Le coupe-circuit est respecté ici, contrairement au signalement d'un
      // problème : personne n'attend cette réponse, et un bot éteint ferait
      // sinon patienter chaque envoi de fond sur la fenêtre de 30 s que
      // demande la lecture des membres du rôle.
      let delivered = false;
      try {
        delivered =
          (await pushRefereeAlert(message, "referee-alert", { honourCircuit: true })) !== null;
      } catch {
        delivered = false;
      }

      // Une alerte réservée en base mais **non remise** — bot éteint,
      // coupe-circuit ouvert, réseau coupé — doit rendre sa réservation, sinon
      // la table censée éviter le doublon finit par n'alerter personne : la
      // manche resterait bloquée sans que le prochain balayage ne réessaie.
      // Rendre la réservation choisit le risque du doublon plutôt que celui du
      // silence, et c'est le bon sens du risque pour une alerte qui ne se
      // répète pas d'elle-même.
      if (!delivered && entry.kind === "score_report_stalled") {
        await releaseRefereeAlertOnPool(entry.matchId, STALLED_ALERT_KEY);
      }
    }
  })().catch(() => undefined);
}

/**
 * Réserve une alerte arbitre pour une manche, **dans la transaction en cours**.
 *
 * Certaines alertes ne naissent pas d'une écriture mais d'un constat répété à
 * chaque passage d'entretien — « ce report a dépassé son délai et personne n'a
 * tranché ». Sans marque, l'arbitre recevrait le même message à chaque lecture
 * de la page. La ligne `bg_referee_alerts (match_id, alert_key)` porte donc une
 * clé unique, et seule l'insertion qui gagne réserve l'envoi.
 *
 * Elle est écrite sur la **connexion de la transaction**, et non sur le pool :
 * la réservation et l'évènement sont ainsi validés ou annulés ensemble — un
 * rollback ne consomme pas l'alerte, contrairement aux rappels de match, dont
 * la réservation précède un envoi hors transaction.
 *
 * La table suit la manche (`ON DELETE CASCADE`) : un plateau régénéré —
 * réappariement d'une ronde suisse, correction de score en survie — efface ses
 * matchs, donc ses réservations.
 *
 * @returns `true` si la réservation est acquise (c'est à nous d'alerter).
 */
export async function claimRefereeAlert(
  connection: PoolConnection,
  matchId: number,
  alertKey: string,
): Promise<boolean> {
  const [result] = await connection.execute(
    `INSERT IGNORE INTO bg_referee_alerts (match_id, alert_key) VALUES (?, ?)`,
    [matchId, alertKey],
  );
  return (result as { affectedRows?: number }).affectedRows === 1;
}

/**
 * Rend une réservation d'alerte **dans la transaction en cours**.
 *
 * Le pendant de `claimRefereeAlert`, pour le cas où la mise en file échoue
 * après coup : la réservation et son abandon sont alors validés ou annulés
 * ensemble, et le prochain balayage retrouve la manche vierge.
 */
export async function releaseRefereeAlert(
  connection: PoolConnection,
  matchId: number,
  alertKey: string,
): Promise<void> {
  await connection.execute(RELEASE_ALERT_SQL, [matchId, alertKey]);
}

/**
 * Rend une réservation d'alerte **après le commit**, sur le pool.
 *
 * C'est le chemin de `flushBotLogs` : la transaction est close depuis longtemps
 * quand on apprend que le bot n'a rien reçu. Meilleur effort, comme tout ce
 * chemin — une réservation qu'on n'arrive pas à rendre laisse simplement la
 * manche sans escalade, ce qui est l'état d'avant.
 */
async function releaseRefereeAlertOnPool(matchId: number, alertKey: string): Promise<void> {
  try {
    const db = await getDatabase();
    await db.execute(RELEASE_ALERT_SQL, [matchId, alertKey]);
  } catch {
    // Meilleur effort.
  }
}

/**
 * Traduit des entrées en lignes de journal, en relisant la base.
 *
 * Exporté pour les tests : c'est là que vit tout ce qui peut se tromper de nom,
 * d'effectif ou de championne. Une entrée qui ne se résout pas (match effacé
 * entre-temps, bye, engagé sans nom) est **silencieusement ignorée** — un
 * journal manquant vaut mieux qu'un journal faux, et rien ici ne justifie de
 * remonter une erreur.
 */
export async function resolveBotLogs(
  entries: readonly PendingBotLog[],
): Promise<ResolvedBotLog[]> {
  const messages: ResolvedBotLog[] = [];

  for (const entry of entries) {
    try {
      const message = await resolveOne(entry);
      if (message) messages.push({ entry, channel: botEventChannel(entry.kind), message });
    } catch {
      // Meilleur effort : une ligne perdue n'emporte pas les suivantes.
    }
  }

  return messages;
}

type TournamentLogRow = RowDataPacket & {
  id: number;
  name: string;
  format: string;
  game: string;
  max_teams: number;
  participant_type: string | null;
  start_at: Date | string | null;
  organizer_pseudo: string | null;
  registered_teams: number;
  champion_name: string | null;
};

/**
 * Tout ce qu'une ligne de journal peut avoir à dire d'un tournoi, en une
 * lecture : son identité, son effectif, et sa championne s'il en a une.
 */
async function loadTournament(tournamentId: number): Promise<TournamentLogRow | null> {
  const db = await getDatabase();
  const [rows] = await db.execute<TournamentLogRow[]>(
    `SELECT
        t.id,
        t.name,
        t.format,
        t.game,
        t.max_teams,
        t.participant_type,
        t.start_at,
        u.pseudo AS organizer_pseudo,
        (SELECT COUNT(*) FROM bg_tournament_registrations r WHERE r.tournament_id = t.id)
          AS registered_teams,
        (SELECT c.name
           FROM bg_tournament_registrations w
           JOIN bg_teams c ON c.id = w.team_id
          WHERE w.tournament_id = t.id AND w.final_rank = 1
          LIMIT 1) AS champion_name
       FROM bg_tournaments t
       LEFT JOIN bg_users u ON u.id = t.organizer_user_id
      WHERE t.id = ?
      LIMIT 1`,
    [tournamentId],
  );
  return rows[0] ?? null;
}

async function loadEntrantName(teamId: number): Promise<string | null> {
  const db = await getDatabase();
  const [rows] = await db.execute<(RowDataPacket & { name: string })[]>(
    `SELECT name FROM bg_teams WHERE id = ? LIMIT 1`,
    [teamId],
  );
  return rows[0]?.name ?? null;
}

type MatchLogRow = RowDataPacket & {
  id: number;
  bracket: string;
  round_number: number;
  team1_score: number | null;
  team2_score: number | null;
  forfeit_team_id: number | null;
  is_bye: number | null;
  team1_name: string | null;
  team2_name: string | null;
  tournament_id: number;
  tournament_name: string;
};

async function loadMatch(matchId: number): Promise<MatchLogRow | null> {
  const db = await getDatabase();
  const [rows] = await db.execute<MatchLogRow[]>(
    `SELECT
        m.id,
        m.bracket,
        m.round_number,
        m.team1_score,
        m.team2_score,
        m.forfeit_team_id,
        m.is_bye,
        t1.name AS team1_name,
        t2.name AS team2_name,
        tr.id AS tournament_id,
        tr.name AS tournament_name
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

/**
 * Ce qu'une alerte arbitre a besoin de savoir d'une rencontre bloquée.
 *
 * Une manche dont un adversaire manque n'a pas d'alerte à produire : il n'y a
 * rien à arbitrer entre une équipe et une case vide, et le message ne saurait
 * pas quoi nommer.
 */
async function loadRefereeAlertContext(matchId: number): Promise<RefereeAlertContext | null> {
  const match = await loadMatch(matchId);
  if (!match || !match.team1_name || !match.team2_name) return null;
  return {
    tournament: { id: Number(match.tournament_id), name: match.tournament_name },
    tournamentUrl: tournamentPageUrl(Number(match.tournament_id)),
    matchId: Number(match.id),
    bracket: String(match.bracket),
    roundNumber: Number(match.round_number),
    team1Name: match.team1_name,
    team2Name: match.team2_name,
  };
}

async function resolveOne(entry: PendingBotLog): Promise<string | null> {
  switch (entry.kind) {
    case "tournament_created": {
      const tournament = await loadTournament(entry.tournamentId);
      if (!tournament) return null;
      return formatTournamentCreatedLog({
        tournament: { id: Number(tournament.id), name: tournament.name },
        format: tournament.format,
        game: tournament.game,
        maxTeams: Number(tournament.max_teams),
        participantType: toParticipantType(tournament.participant_type),
        organizerPseudo: tournament.organizer_pseudo ?? "le staff",
        startAt: tournament.start_at,
      });
    }

    case "registration": {
      const [tournament, entrantName] = await Promise.all([
        loadTournament(entry.tournamentId),
        loadEntrantName(entry.teamId),
      ]);
      if (!tournament || !entrantName) return null;
      return formatRegistrationLog({
        tournament: { id: Number(tournament.id), name: tournament.name },
        entrantName,
        registeredTeams: Number(tournament.registered_teams),
        maxTeams: Number(tournament.max_teams),
        participantType: toParticipantType(tournament.participant_type),
        byStaff: entry.byStaff,
      });
    }

    case "forfeit": {
      const [tournament, entrantName] = await Promise.all([
        loadTournament(entry.tournamentId),
        loadEntrantName(entry.teamId),
      ]);
      if (!tournament || !entrantName) return null;
      return formatForfeitLog({
        tournament: { id: Number(tournament.id), name: tournament.name },
        entrantName,
      });
    }

    case "match_finished": {
      const match = await loadMatch(entry.matchId);
      // Un bye ou un match fantôme porte un score posé par le moteur, pas saisi
      // par une équipe : il n'a rien à raconter (et il y en a autant que
      // d'effectifs impairs).
      if (!match || Number(match.is_bye ?? 0) === 1) return null;
      if (!match.team1_name || !match.team2_name) return null;
      // Un forfait arbitré ne porte aucun score : c'est le seul cas où leur
      // absence décrit un match bel et bien tranché.
      const forfeit = match.forfeit_team_id !== null;
      if (!forfeit && (match.team1_score === null || match.team2_score === null)) return null;
      return formatMatchResultLog({
        tournament: { id: Number(match.tournament_id), name: match.tournament_name },
        bracket: String(match.bracket),
        roundNumber: Number(match.round_number),
        team1Name: match.team1_name,
        team2Name: match.team2_name,
        team1Score: match.team1_score === null ? null : Number(match.team1_score),
        team2Score: match.team2_score === null ? null : Number(match.team2_score),
        forfeit,
      });
    }

    case "score_conflict": {
      const context = await loadRefereeAlertContext(entry.matchId);
      return context === null ? null : formatScoreConflictAlert(context);
    }

    case "score_report_stalled": {
      const context = await loadRefereeAlertContext(entry.matchId);
      return context === null
        ? null
        : formatStalledScoreReportAlert(context, SCORE_REPORT_TIMEOUT_MINUTES);
    }

    case "tournament_started": {
      const tournament = await loadTournament(entry.tournamentId);
      if (!tournament) return null;
      return formatTournamentStartedLog({
        tournament: { id: Number(tournament.id), name: tournament.name },
        format: tournament.format,
        registeredTeams: Number(tournament.registered_teams),
        participantType: toParticipantType(tournament.participant_type),
      });
    }

    case "tournament_finished": {
      const tournament = await loadTournament(entry.tournamentId);
      if (!tournament) return null;
      return formatTournamentFinishedLog({
        tournament: { id: Number(tournament.id), name: tournament.name },
        championName: tournament.champion_name,
      });
    }

    case "tournament_underfilled": {
      const tournament = await loadTournament(entry.tournamentId);
      if (!tournament) return null;
      return formatUnderfilledTournamentLog({
        tournament: { id: Number(tournament.id), name: tournament.name },
        registeredTeams: Number(tournament.registered_teams),
        participantType: toParticipantType(tournament.participant_type),
      });
    }
  }
}

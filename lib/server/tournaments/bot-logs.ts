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
 * L'envoi lui-même reste au meilleur effort, comme tout ce qui passe par le
 * canal interne : ni la lecture ni l'écriture ne doivent échouer parce que le
 * bot dort.
 */
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { sendBotLog } from "@/lib/server/bot-integration";
import { getDatabase } from "@/lib/server/database";
import {
  formatForfeitLog,
  formatMatchResultLog,
  formatRegistrationLog,
  formatScoreConflictLog,
  formatTournamentCreatedLog,
  formatTournamentFinishedLog,
  formatTournamentStartedLog,
  formatUnderfilledTournamentLog,
} from "@/lib/shared/bot-logs";
import { toParticipantType } from "@/lib/shared/participants";

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
  | { kind: "tournament_started"; tournamentId: number }
  | { kind: "tournament_finished"; tournamentId: number }
  | { kind: "tournament_underfilled"; tournamentId: number };

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
 */
export function queueBotLog(connection: PoolConnection, entry: PendingBotLog): void {
  const queue = pending.get(connection);
  if (!queue) {
    pending.set(connection, [entry]);
    return;
  }
  if (queue.length >= MAX_PENDING_PER_TRANSACTION) return;
  if (queue.some((existing) => entryKey(existing) === entryKey(entry))) return;
  queue.push(entry);
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
    for (const message of await resolveBotLogs(queue)) {
      await sendBotLog(message);
    }
  })().catch(() => undefined);
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
export async function resolveBotLogs(entries: readonly PendingBotLog[]): Promise<string[]> {
  const messages: string[] = [];

  for (const entry of entries) {
    try {
      const message = await resolveOne(entry);
      if (message) messages.push(message);
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
      if (match.team1_score === null || match.team2_score === null) return null;
      return formatMatchResultLog({
        tournament: { id: Number(match.tournament_id), name: match.tournament_name },
        bracket: String(match.bracket),
        roundNumber: Number(match.round_number),
        team1Name: match.team1_name,
        team2Name: match.team2_name,
        team1Score: Number(match.team1_score),
        team2Score: Number(match.team2_score),
        forfeit: match.forfeit_team_id !== null,
      });
    }

    case "score_conflict": {
      const match = await loadMatch(entry.matchId);
      if (!match || !match.team1_name || !match.team2_name) return null;
      return formatScoreConflictLog({
        tournament: { id: Number(match.tournament_id), name: match.tournament_name },
        matchId: Number(match.id),
        bracket: String(match.bracket),
        roundNumber: Number(match.round_number),
        team1Name: match.team1_name,
        team2Name: match.team2_name,
      });
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

/**
 * Journal d'activité du site, poussé au canal de logs Discord du bot.
 *
 * Même sens que partout ailleurs : **le site rédige, le bot distribue**
 * (`/internal/log`, qui préfixe chaque ligne de `[AppBlueGenji]`). Le canal
 * sert à *suivre* une soirée de tournoi depuis Discord — qui s'inscrit, qui
 * abandonne, quelle manche vient de tomber et sur quel score — pas à rejouer la
 * base : ce qui se relit déjà sur la page du tournoi n'a pas à y défiler.
 *
 * D'où deux règles de rédaction, tenues ici parce qu'elles ne valent que si
 * elles sont tenues au même endroit pour tout le monde :
 *
 * 1. **Une ligne par évènement**, jamais un bloc. Le canal est une bande
 *    déroulante, pas un rapport ; dix évènements doivent tenir à l'écran.
 * 2. **Un évènement = un fait accompli.** On journalise la *fin* d'un match, pas
 *    les deux reports de score qui y mènent ; l'inscription, pas la visite de la
 *    page. Le nombre de lignes d'un tournoi reste ainsi de l'ordre de son nombre
 *    de matchs, quel que soit le trafic.
 *
 * Module pur (`lib/shared`) : aucune base, aucun réseau. Le déclenchement et la
 * résolution des noms vivent dans `lib/server/tournaments/bot-logs.ts`.
 */
import { matchRoundLabel, formatMatchStart } from "./discord-notifications";
import { participantWording, type ParticipantType } from "./participants";
import { formatLabel, gameLabel } from "./tournament-labels";
import type { TournamentFormat, TournamentGame } from "./types";

/** Tournoi désigné dans une ligne de journal. */
export interface BotLogTournament {
  id: number;
  name: string;
}

/**
 * Titre d'un tournoi tel qu'il apparaît dans le journal.
 *
 * L'identifiant suit toujours le nom : deux éditions d'un même tournoi portent
 * volontiers le même nom, et une ligne de journal doit pouvoir être rapprochée
 * d'une page (`/tournois/<id>`) sans deviner de laquelle il s'agit.
 */
function tournamentLabel(tournament: BotLogTournament): string {
  return `« ${tournament.name} » (#${tournament.id})`;
}

/** Création d'un tournoi par le staff. */
export function formatTournamentCreatedLog(context: {
  tournament: BotLogTournament;
  format: TournamentFormat | string;
  game: TournamentGame | string;
  maxTeams: number;
  participantType: ParticipantType;
  organizerPseudo: string;
  startAt: string | Date | null;
}): string {
  const parts = [
    `${formatLabel(context.format)} · ${gameLabel(context.game)}`,
    `${context.maxTeams} ${participantWording(context.participantType).many} max`,
    `créé par ${context.organizerPseudo}`,
  ];
  if (context.startAt !== null) {
    parts.push(`début le ${formatMatchStart(context.startAt)}`);
  }
  return `📅 Nouveau tournoi ${tournamentLabel(context.tournament)} — ${parts.join(", ")}.`;
}

/**
 * Inscription d'un engagé.
 *
 * `byStaff` distingue l'ajout d'une équipe fantôme (ou d'un joueur invité) de
 * l'inscription d'un joueur : sur le canal, les deux se ressemblent à s'y
 * méprendre, et c'est justement la différence qu'un arbitre cherche quand il
 * relit un plateau de remplissage.
 */
export function formatRegistrationLog(context: {
  tournament: BotLogTournament;
  entrantName: string;
  registeredTeams: number;
  maxTeams: number;
  participantType: ParticipantType;
  byStaff: boolean;
}): string {
  const field = `${context.registeredTeams}/${context.maxTeams} ${participantWording(context.participantType).many}`;
  const author = context.byStaff ? " (ajout du staff)" : "";
  return `✅ Inscription — ${tournamentLabel(context.tournament)} : ${context.entrantName}${author}. ${field}.`;
}

/**
 * Abandon d'un engagé en cours de tournoi.
 *
 * C'est la seule sortie possible du plateau : une inscription ne se retire
 * jamais une fois posée (c'est sur quoi s'appuie `finalizeUnderfilledTournament`),
 * un engagé qui s'en va le fait par forfait.
 */
export function formatForfeitLog(context: {
  tournament: BotLogTournament;
  entrantName: string;
}): string {
  return `🚪 Abandon — ${tournamentLabel(context.tournament)} : ${context.entrantName} quitte la compétition.`;
}

/**
 * Fin d'un match, avec son score.
 *
 * Écrite au moment où le match est **tranché** — les deux engagés d'accord, un
 * délai de report expiré, ou un arbitrage — et non à chaque saisie : un match ne
 * produit donc qu'une ligne, deux s'il est corrigé plus tard.
 */
export function formatMatchResultLog(context: {
  tournament: BotLogTournament;
  bracket: string;
  roundNumber: number;
  team1Name: string;
  team2Name: string;
  team1Score: number;
  team2Score: number;
  /** Forfait déclaré sur ce match : le score seul ne le dirait pas. */
  forfeit?: boolean;
}): string {
  const round = matchRoundLabel(context.bracket, context.roundNumber);
  const score = `${context.team1Name} ${context.team1Score}–${context.team2Score} ${context.team2Name}`;
  const forfeit = context.forfeit ? " (forfait)" : "";
  return `🏁 ${tournamentLabel(context.tournament)} · ${round} : ${score}${forfeit}.`;
}

/** Désaccord entre les deux reports d'un même match : un arbitre doit trancher. */
export function formatScoreConflictLog(context: {
  tournament: BotLogTournament;
  matchId: number;
  bracket: string;
  roundNumber: number;
  team1Name: string;
  team2Name: string;
}): string {
  const round = matchRoundLabel(context.bracket, context.roundNumber);
  return `⚠️ Conflit de score — ${tournamentLabel(context.tournament)} · ${round} : ${context.team1Name} vs ${context.team2Name} (match #${context.matchId}). Arbitrage requis.`;
}

/** Coup d'envoi : le tournoi passe « en cours ». */
export function formatTournamentStartedLog(context: {
  tournament: BotLogTournament;
  format: TournamentFormat | string;
  registeredTeams: number;
  participantType: ParticipantType;
}): string {
  const field = `${context.registeredTeams} ${participantWording(context.participantType).many}`;
  return `🚀 Coup d'envoi — ${tournamentLabel(context.tournament)} : ${field}, ${formatLabel(context.format)}.`;
}

/** Clôture d'un tournoi, avec sa championne quand le classement en désigne une. */
export function formatTournamentFinishedLog(context: {
  tournament: BotLogTournament;
  championName: string | null;
}): string {
  const champion = context.championName ? ` : ${context.championName} l'emporte.` : ".";
  return `🏆 Tournoi terminé — ${tournamentLabel(context.tournament)}${champion}`;
}

/**
 * Tournoi clos à son coup d'envoi faute d'adversaires (0 ou 1 engagé).
 *
 * Ligne distincte de la clôture ordinaire : un tournoi qui se termine sans avoir
 * joué est un incident d'organisation, pas un palmarès — et c'est précisément le
 * genre de chose qu'on veut voir passer sur Discord le soir même.
 */
export function formatUnderfilledTournamentLog(context: {
  tournament: BotLogTournament;
  registeredTeams: number;
  participantType: ParticipantType;
}): string {
  const wording = participantWording(context.participantType);
  const field =
    context.registeredTeams === 0
      ? "aucun engagement"
      : `1 seul${wording.one === "équipe" ? "e équipe engagée" : " joueur engagé"}`;
  return `🚫 Tournoi clos faute d'adversaires — ${tournamentLabel(context.tournament)} : ${field}.`;
}

/** Suppression définitive d'un tournoi (administrateur). */
export function formatTournamentDeletedLog(context: {
  tournament: BotLogTournament;
  actorPseudo: string;
  actorId: number;
}): string {
  return `🗑️ Tournoi supprimé définitivement : ${tournamentLabel(context.tournament)} par ${context.actorPseudo} (#${context.actorId}).`;
}

/**
 * Ce qu'un message Discord a le droit de dire d'une personne.
 *
 * Tout ce que le site poste sur Discord — journal d'activité, alertes arbitre,
 * signalements — passe par ce module pour nommer un engagé ou un membre du
 * staff. La règle tient au salon lui-même : un tiers, hébergé hors de l'Union
 * européenne, sans purge automatique.
 *
 * - un **nom d'équipe** peut partir ;
 * - un **joueur** jamais — ni pseudo, ni identifiant qui mène à sa fiche ; en
 *   tournoi individuel, le nom d'un engagé *est* un pseudo ;
 * - le **staff** n'est pas nommé sur Discord, mais son geste est tracé avec son
 *   nom dans les journaux du serveur (pm2), pour la modération.
 *
 * Module pur et sans dépendance de rédaction : il est importé par tous les
 * rédacteurs (`bot-logs`, `referee-alerts`, `discord-notifications`) sans créer
 * de cycle entre eux.
 */
import type { ParticipantType } from "./participants";

/**
 * Un engagé tel qu'un message Discord le reçoit : son nom **et** ce qu'il est.
 *
 * Le nom seul ne suffit pas à savoir s'il peut partir : une entrée solo porte le
 * pseudo de son joueur, un « joueur invité » un nom choisi pour une personne.
 * Les rédacteurs ne prennent jamais un nom nu — c'est ce qui interdit à une
 * ligne ajoutée demain de publier un pseudo par mégarde.
 */
export interface LogEntrant {
  name: string;
  participantType: ParticipantType;
}

/** Ce qu'un message Discord écrit à la place d'un joueur. */
export const ANONYMOUS_PLAYER_LABEL = "un joueur";

/** Ce qu'un message Discord écrit à la place d'un membre du staff. */
export const ANONYMOUS_STAFF_LABEL = "le staff";

/** Nom d'un engagé sur Discord : l'équipe par son nom, le joueur jamais. */
export function entrantLabel(entrant: LogEntrant): string {
  return entrant.participantType === "SOLO" ? ANONYMOUS_PLAYER_LABEL : entrant.name;
}

/** Auteur d'un geste du staff : nommé dans les journaux du serveur, jamais sur Discord. */
export interface StaffActor {
  id: number;
  pseudo: string;
}

/**
 * La ligne d'audit d'un geste du staff, pour les journaux du serveur (pm2).
 *
 * Même texte que la ligne Discord, plus l'auteur : la modération relit ce que le
 * canal a vu, et sait qui l'a fait. Préfixe fixe, pour qu'un
 * `pm2 logs bluegenji | grep staff-audit` suffise à tout retrouver.
 */
export function staffAuditLine(discordLine: string, actor: StaffActor): string {
  return `[staff-audit] ${discordLine} — auteur : ${actor.pseudo} (#${actor.id})`;
}

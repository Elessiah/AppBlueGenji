/**
 * Prévenir la gestion d'une équipe qu'un joueur demande à la rejoindre — règles.
 *
 * Une demande d'adhésion (`bg_team_invitations.kind = 'REQUEST'`) ne se voyait
 * que sur la fiche de l'équipe, à qui pensait à l'ouvrir : un joueur pouvait
 * attendre des jours une réponse que personne ne savait devoir donner. Le bot
 * écrit donc en message privé à ceux qui **ont qualité pour répondre** — et à
 * eux seuls : `OWNER` et `MANAGER` (`hasTeamManagementRole`), la même paire qui
 * accepte ou refuse la demande. Un coéquipier sportif n'a rien à en faire.
 *
 * Module **pur** : le choix des destinataires, la borne anti-répétition et la
 * rédaction se testent sans base ni bot.
 */

import { hasTeamManagementRole } from "./team-roles";
import type { TeamRole } from "./types";

/**
 * Une même personne ne fait écrire le bot à une même équipe qu'une fois par
 * fenêtre : une demande se retire (`DELETE /api/invitations/[id]`) et se
 * redépose, et sans cette borne le bouton « Rejoindre » ferait vibrer le
 * téléphone du propriétaire en boucle. La demande, elle, est bien enregistrée —
 * seul le message de plus est retenu.
 */
export const TEAM_JOIN_REQUEST_NOTICE_COOLDOWN_HOURS = 24;

/** Un membre actuel de l'équipe, tel que le service le lit. */
export type TeamJoinNoticeMember = {
  pseudo: string;
  roles: readonly TeamRole[];
  discordId: string | null;
  discordPseudo: string | null;
  discordVerified: boolean;
};

/** Destinataire d'un message privé (même forme que `DiscordRecipient`). */
export type TeamJoinNoticeRecipient = {
  discordId: string | null;
  handle: string | null;
  label: string;
};

/**
 * Les membres à prévenir : gestion de l'équipe, joignable par un moyen
 * **prouvé** (identifiant Discord, ou tag certifié). Un tag saisi à la main
 * peut désigner n'importe qui — le bot écrirait alors à un inconnu.
 */
export function teamJoinNoticeRecipients(members: readonly TeamJoinNoticeMember[]): TeamJoinNoticeRecipient[] {
  const recipients: TeamJoinNoticeRecipient[] = [];
  for (const member of members) {
    if (!hasTeamManagementRole(member.roles)) continue;
    const handle = member.discordVerified ? member.discordPseudo : null;
    if (!member.discordId && !handle) continue;
    recipients.push({ discordId: member.discordId, handle, label: member.pseudo });
  }
  return recipients;
}

/**
 * Faut-il écrire ? Oui pour la **seule** demande de cette personne à cette
 * équipe dans la fenêtre — celle qui vient d'être déposée, d'où `<= 1`.
 *
 * @param requestsInWindow Demandes (tous statuts) de ce joueur à cette équipe
 *   créées depuis `TEAM_JOIN_REQUEST_NOTICE_COOLDOWN_HOURS`, la nouvelle comprise.
 */
export function shouldNotifyTeamJoinRequest(requestsInWindow: number): boolean {
  return requestsInWindow <= 1;
}

/**
 * Le message privé. **Aucun pseudo de joueur** — règle de tous les messages
 * Discord du site (`docs/features/RGPD_LOGS_AND_VISITS.md`) : le demandeur se
 * lit sur la fiche de l'équipe, où mène le lien, derrière une connexion.
 */
export function formatTeamJoinRequestNotice(input: { teamName: string; url: string }): string {
  return (
    `📨 BlueGenji — Un joueur demande à rejoindre ton équipe « ${input.teamName} ». ` +
    `Accepte ou refuse sa demande depuis la fiche de l'équipe : ${input.url}`
  );
}

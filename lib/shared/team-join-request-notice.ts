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
import { discordInline } from "./discord-text";

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
  userId: number;
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
 * Les membres à prévenir : la gestion de l'équipe. Chacun reçoit la
 * notification push de ses appareils abonnés ; le message privé Discord ne part
 * qu'à qui est joignable par un moyen **prouvé** (identifiant Discord, ou tag
 * certifié) — un tag saisi à la main peut désigner n'importe qui, le bot
 * écrirait alors à un inconnu (`discord: null`).
 */
export function teamJoinNoticeRecipients(
  members: readonly TeamJoinNoticeMember[],
): { userId: number; discord: TeamJoinNoticeRecipient | null }[] {
  const recipients: { userId: number; discord: TeamJoinNoticeRecipient | null }[] = [];
  for (const member of members) {
    if (!hasTeamManagementRole(member.roles)) continue;
    const handle = member.discordVerified ? member.discordPseudo : null;
    const discord = member.discordId || handle ? { discordId: member.discordId, handle, label: member.pseudo } : null;
    recipients.push({ userId: member.userId, discord });
  }
  return recipients;
}

/**
 * Équipes qu'une même personne peut faire prévenir de ses demandes, par
 * fenêtre de `TEAM_JOIN_REQUEST_NOTICE_COOLDOWN_HOURS`, **toutes équipes
 * confondues**.
 *
 * La borne par équipe ne suffit pas : sans plafond sur le nombre d'équipes, un
 * compte — gratuit par OAuth — demandait à rejoindre chaque équipe du site et
 * faisait écrire le bot à toutes leurs gestions dans la journée, de quoi faire
 * classer le bot comme spammeur par Discord (ce qui couperait aussi la
 * connexion par code). Un joueur qui cherche une équipe en sollicite quelques
 * unes ; au-delà, ses demandes sont enregistrées et visibles sur les fiches,
 * seul le message est retenu.
 */
export const TEAM_JOIN_REQUEST_NOTICES_DAILY_CAP = 5;

/**
 * Faut-il écrire ? Oui pour la **seule** demande de cette personne à cette
 * équipe dans la fenêtre — celle qui vient d'être déposée, d'où `<= 1` —, tant
 * que ses demandes de la fenêtre, toutes équipes confondues, n'excèdent pas
 * `TEAM_JOIN_REQUEST_NOTICES_DAILY_CAP`.
 *
 * @param input.toThisTeam Demandes (tous statuts) de ce joueur à cette équipe
 *   créées depuis `TEAM_JOIN_REQUEST_NOTICE_COOLDOWN_HOURS`, la nouvelle comprise.
 * @param input.toAnyTeam Même compte, toutes équipes confondues.
 */
export function shouldNotifyTeamJoinRequest(input: { toThisTeam: number; toAnyTeam: number }): boolean {
  return input.toThisTeam <= 1 && input.toAnyTeam <= TEAM_JOIN_REQUEST_NOTICES_DAILY_CAP;
}

/**
 * Le message privé. **Aucun pseudo de joueur** — règle de tous les messages
 * Discord du site (`docs/features/RGPD_LOGS_AND_VISITS.md`) : le demandeur se
 * lit sur la fiche de l'équipe, où mène le lien, derrière une connexion.
 */
export function formatTeamJoinRequestNotice(input: { teamName: string; url: string }): string {
  return (
    `📨 BlueGenji — Un joueur demande à rejoindre ton équipe « ${discordInline(input.teamName)} ». ` +
    `Accepte ou refuse sa demande depuis la fiche de l'équipe : ${input.url}`
  );
}

/**
 * Prévenir un joueur de ce qu'une équipe lui propose — règles.
 *
 * Trois gestes laissaient le joueur visé dans l'ignorance tant qu'il n'ouvrait
 * pas « Mon profil » ou la fiche de son équipe : une **invitation** de la
 * gestion d'une équipe, une **reprise** d'équipe fantôme proposée par le staff
 * (`claimGhostTeam`, invitation marquée `OWNER`), et la **propriété** de son
 * équipe qu'un propriétaire vient de lui transférer. Chacun part désormais en
 * notification push et en message privé Discord (sujet `TEAM_INVITATION`).
 *
 * Module **pur** : le choix du destinataire et la rédaction se testent sans
 * base ni bot (`docs/features/TEAM_INVITATION_NOTIFICATION.md`).
 */

import { discordInline } from "./discord-text";
import { localizedSiteUrl } from "./dm-language";
import type { Locale } from "./locales";

/**
 * Ce qui attend le joueur : une invitation ordinaire, une reprise de fantôme
 * proposée par le staff, ou la propriété de son équipe reçue.
 */
export type TeamInviteNoticeKind = "INVITE" | "GHOST_CLAIM" | "OWNERSHIP";

/** Où l'invitation s'accepte : la section « Invitations d'équipe » de « Mon profil ». */
export const TEAM_INVITATIONS_PATH = "/profil#invitations";

/** Chemin du site ouvert par la notification : le profil pour répondre, la fiche de l'équipe pour la propriété. */
export function teamInviteNoticePath(kind: TeamInviteNoticeKind, teamId: number): string {
  return kind === "OWNERSHIP" ? `/equipes/${teamId}` : TEAM_INVITATIONS_PATH;
}

/**
 * Une invitation se retire (`DELETE /api/invitations/[id]`) et se renvoie :
 * sans borne, la gestion d'une équipe ferait vibrer le téléphone d'un joueur en
 * boucle. Une même équipe ne fait écrire au même joueur qu'une fois par
 * fenêtre — l'invitation, elle, est bien enregistrée.
 */
export const TEAM_INVITE_NOTICE_COOLDOWN_HOURS = 24;

/**
 * Joueurs **distincts** qu'une même équipe — ou une même personne, toutes ses
 * équipes confondues — peut faire prévenir par fenêtre : une gestion qui
 * inviterait chaque pseudo du site (ou recréerait une équipe pour repartir de
 * zéro) ferait classer le bot comme spammeur par Discord (ce qui couperait
 * aussi la connexion par code). Au-delà, les invitations sont enregistrées et
 * visibles sur « Mon profil » ; seul le message est retenu.
 */
export const TEAM_INVITE_NOTICES_DAILY_CAP = 10;

/**
 * Équipes **distinctes** dont un même joueur peut recevoir l'invitation par
 * fenêtre : plusieurs comptes, ou plusieurs équipes, ne lui écrivent pas en
 * boucle.
 */
export const TEAM_INVITE_NOTICES_PER_PLAYER_CAP = 3;

/**
 * Ce que la base compte dans la fenêtre, invitation qui vient d'être écrite
 * **comprise** — la ligne écrite est la réservation : deux invitations
 * simultanées se voient l'une l'autre au pire, et se taisent plutôt que
 * d'écrire deux fois.
 */
export type TeamInviteNoticeBudget = {
  /** Invitations de cette équipe à ce joueur. */
  toThisPlayer: number;
  /** Joueurs distincts invités par cette équipe. */
  toAnyPlayer: number;
  /** Joueurs distincts invités par l'auteur, toutes équipes confondues. */
  byActor: number;
  /** Équipes distinctes qui ont invité ce joueur. */
  teamsToThisPlayer: number;
};

/**
 * Borne d'une invitation ordinaire : la **seule** invitation de cette équipe à
 * ce joueur dans la fenêtre (celle qui vient d'être écrite, d'où `<= 1`), tant
 * que les joueurs invités par l'équipe, ou par l'auteur, n'excèdent pas
 * {@link TEAM_INVITE_NOTICES_DAILY_CAP} et que les équipes qui invitent ce
 * joueur n'excèdent pas {@link TEAM_INVITE_NOTICES_PER_PLAYER_CAP}.
 */
export function withinTeamInviteNoticeBudget(input: TeamInviteNoticeBudget): boolean {
  return (
    input.toThisPlayer <= 1 &&
    input.toAnyPlayer <= TEAM_INVITE_NOTICES_DAILY_CAP &&
    input.byActor <= TEAM_INVITE_NOTICES_DAILY_CAP &&
    input.teamsToThisPlayer <= TEAM_INVITE_NOTICES_PER_PLAYER_CAP
  );
}

/** Ce que la base compte des reprises proposées dans la fenêtre, celle-ci comprise. */
export type GhostClaimNoticeBudget = {
  /** Propositions de cette fantôme à ce joueur. */
  toThisPlayer: number;
  /** Joueurs distincts à qui l'auteur a proposé une reprise, toutes fantômes confondues. */
  byActor: number;
  /** Fantômes distinctes proposées à ce joueur. */
  teamsToThisPlayer: number;
};

/**
 * Borne d'une reprise proposée par le staff : une fois par équipe et par
 * joueur dans la fenêtre (proposition retirée puis refaite comprise), et les
 * mêmes plafonds qu'une invitation — un compte staff ne fait pas écrire à plus
 * de {@link TEAM_INVITE_NOTICES_DAILY_CAP} joueurs, un joueur ne reçoit pas
 * plus de {@link TEAM_INVITE_NOTICES_PER_PLAYER_CAP} reprises (revue sécurité
 * #544). Au-delà, la proposition reste visible sur « Mon profil ».
 */
export function withinGhostClaimNoticeBudget(input: GhostClaimNoticeBudget): boolean {
  return (
    input.toThisPlayer <= 1 &&
    input.byActor <= TEAM_INVITE_NOTICES_DAILY_CAP &&
    input.teamsToThisPlayer <= TEAM_INVITE_NOTICES_PER_PLAYER_CAP
  );
}

/** Le compte visé, tel que le service le lit. */
export type TeamInviteNoticeAccount = {
  userId: number;
  pseudo: string;
  discordId: string | null;
  discordPseudo: string | null;
  discordVerified: boolean;
  /** Supprimé (anonymisé) ou suspendu : il ne peut pas se connecter pour répondre, rien ne part. */
  deleted: boolean;
  suspended: boolean;
};

/** L'équipe, telle que le service la lit. */
export type TeamInviteNoticeTeam = {
  name: string;
  isGhost: boolean;
  soloUserId: number | null;
  deleted: boolean;
};

/**
 * Faut-il écrire ? Jamais à l'auteur du geste (un arbitre qui se propose
 * lui-même une reprise), jamais pour une entrée solo (ce n'est pas une
 * équipe), jamais à un compte supprimé ou suspendu, jamais pour une équipe
 * dissoute. Une invitation ordinaire ou une propriété ne concerne qu'une
 * équipe réelle (une fantôme n'a personne pour la gérer), une reprise qu'une
 * fantôme.
 */
export function shouldNotifyTeamInvite(input: {
  kind: TeamInviteNoticeKind;
  actorId: number;
  account: TeamInviteNoticeAccount;
  team: TeamInviteNoticeTeam;
}): boolean {
  const { kind, actorId, account, team } = input;
  if (account.userId === actorId || account.deleted || account.suspended) return false;
  if (team.deleted || team.soloUserId !== null) return false;
  return kind === "GHOST_CLAIM" ? team.isGhost : !team.isGhost;
}

/**
 * Destinataire du message privé : par un moyen **prouvé** seulement
 * (identifiant Discord, ou tag certifié) — un tag saisi à la main peut
 * désigner n'importe qui. Sans moyen prouvé, le push seul (`discord: null`).
 */
export function teamInviteNoticeRecipient(account: TeamInviteNoticeAccount): {
  userId: number;
  discord: { discordId: string | null; handle: string | null; label: string } | null;
} {
  const handle = account.discordVerified ? account.discordPseudo : null;
  const discord = account.discordId || handle ? { discordId: account.discordId, handle, label: account.pseudo } : null;
  return { userId: account.userId, discord };
}

/**
 * Le message privé. **Aucun pseudo de joueur ni `#id`** — ni de qui invite, ni
 * de qui transfère : seul le nom de l'équipe (`discordInline`), public. Une
 * reprise ne nomme que l'équipe — ni « un admin », ni personne (décision D4 de
 * l'utilisateur, 2026-11-09) —, son nom en lien masqué vers « Mon profil » : `discordInline` en échappe
 * crochets et parenthèses, il ne peut ni fermer le lien ni en forger un autre.
 *
 * @param input.url adresse absolue du site, en français ; passée à l'anglais ici (`localizedSiteUrl`).
 */
export function formatTeamInviteNotice(
  input: { kind: TeamInviteNoticeKind; teamName: string; url: string },
  locale: Locale = "fr",
): string {
  const url = localizedSiteUrl(input.url, locale);
  const team = discordInline(input.teamName);
  if (locale === "en") {
    switch (input.kind) {
      case "INVITE":
        return `📨 BlueGenji — The team “${team}” invites you to join it. Accept or decline from your profile: ${url}`;
      case "GHOST_CLAIM":
        return `📨 BlueGenji — You can take over the team [${team}](${url}). Accept or decline from your profile.`;
      case "OWNERSHIP":
        return `👑 BlueGenji — Ownership of your team “${team}” has just been transferred to you. You now manage its name, tag and members: ${url}`;
    }
  }
  switch (input.kind) {
    case "INVITE":
      return `📨 BlueGenji — L'équipe « ${team} » t'invite à la rejoindre. Accepte ou refuse depuis ton profil : ${url}`;
    case "GHOST_CLAIM":
      return `📨 BlueGenji — Tu peux reprendre l'équipe [${team}](${url}). Accepte ou refuse depuis ton profil.`;
    case "OWNERSHIP":
      return `👑 BlueGenji — La propriété de ton équipe « ${team} » vient de t'être transférée. Tu gères désormais son nom, son sigle et ses membres : ${url}`;
  }
}

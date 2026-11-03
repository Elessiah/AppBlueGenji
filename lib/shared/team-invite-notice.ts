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
 * Joueurs **distincts** qu'une même équipe peut faire prévenir par fenêtre :
 * une gestion qui inviterait chaque pseudo du site ferait classer le bot comme
 * spammeur par Discord (ce qui couperait aussi la connexion par code). Au-delà,
 * les invitations sont enregistrées et visibles sur « Mon profil » ; seul le
 * message est retenu.
 */
export const TEAM_INVITE_NOTICES_DAILY_CAP = 10;

/**
 * Borne d'une invitation ordinaire : la **seule** invitation de cette équipe à
 * ce joueur dans la fenêtre (celle qui vient d'être écrite, d'où `<= 1`), tant
 * que les joueurs invités par l'équipe dans la fenêtre n'excèdent pas
 * {@link TEAM_INVITE_NOTICES_DAILY_CAP}.
 */
export function withinTeamInviteNoticeBudget(input: { toThisPlayer: number; toAnyPlayer: number }): boolean {
  return input.toThisPlayer <= 1 && input.toAnyPlayer <= TEAM_INVITE_NOTICES_DAILY_CAP;
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
 * de qui transfère : seul le nom de l'équipe (`discordInline`), public.
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
        return `📨 BlueGenji — The staff offers you to take over the team “${team}” as its owner. Accept or decline from your profile: ${url}`;
      case "OWNERSHIP":
        return `👑 BlueGenji — Ownership of your team “${team}” has just been transferred to you. You now manage its name, tag and members: ${url}`;
    }
  }
  switch (input.kind) {
    case "INVITE":
      return `📨 BlueGenji — L'équipe « ${team} » t'invite à la rejoindre. Accepte ou refuse depuis ton profil : ${url}`;
    case "GHOST_CLAIM":
      return `📨 BlueGenji — Le staff te propose de reprendre l'équipe « ${team} » comme propriétaire. Accepte ou refuse depuis ton profil : ${url}`;
    case "OWNERSHIP":
      return `👑 BlueGenji — La propriété de ton équipe « ${team} » vient de t'être transférée. Tu gères désormais son nom, son sigle et ses membres : ${url}`;
  }
}

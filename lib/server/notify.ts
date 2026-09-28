/**
 * Le point d'entrée unique de toute notification adressée à une personne.
 *
 * Le site prévient par deux canaux : le **message privé Discord** (rédigé ici,
 * distribué par le bot) et la **notification push** du navigateur
 * (`./push-subscriptions`). Ils ne se recouvrent pas — un joueur sans Discord
 * rattaché a souvent un téléphone abonné, et l'inverse —, si bien qu'une
 * notification envoyée par un seul canal manque une partie de ceux qu'elle
 * vise. Ce module les envoie **ensemble**, et c'est le seul qui ait le droit
 * d'appeler les envois Discord aux personnes : un balayage
 * (`tests/lib/server/notification-channels.test.ts`) refuse tout
 * `pushDiscordDirectMessages`, `pushRefereeAlert` ou `pushLeadershipAlert`
 * ailleurs. Une notification ajoutée demain passe donc par ici, et arrive en
 * push sans que personne ait à s'en souvenir.
 *
 * Deux formes, selon qui l'on prévient :
 *
 * - {@link notifyUsers} — des **personnes nommées** (les joueurs d'un match, la
 *   gestion d'une équipe) : message privé à ceux que Discord joint, push à tous ;
 * - {@link notifyStaff} — un **métier** (l'arbitrage, la modération) : le bot
 *   s'adresse à un rôle ou à un salon, le push aux comptes du site qui
 *   détiennent la permission du sujet (`PUSH_TOPICS[topic].audience`).
 *
 * Les deux ne lèvent jamais sur le push ; le bilan Discord est rendu tel que le
 * bot le donne (`null` = injoignable), pour les appelants qui en ont besoin.
 */
import type { RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import { parseRoles } from "@/lib/server/serialization";
import { hasTeamManagementRole } from "@/lib/shared/team-roles";
import {
  pushDiscordDirectMessages,
  type DiscordDeliveryReport,
  type DiscordRecipient,
} from "@/lib/server/bot-integration";
import { can, sanitizePlatformRoles } from "@/lib/shared/permissions";
import {
  PUSH_TOPICS,
  type PushContent,
  type PushTopic,
} from "@/lib/shared/push-notifications";
import { pushToUsers, subscribedStaffCandidates, type PushOptions } from "./push-subscriptions";

/** Une personne à prévenir : son compte, et comment Discord la joint (ou pas). */
export type NotificationRecipient = {
  userId: number;
  discord: DiscordRecipient | null;
};

export type UserNotification = {
  topic: PushTopic;
  push: PushContent;
  /** Le message privé Discord, quand la notification en a un. */
  discord?: { message: string; context: string };
  pushOptions?: PushOptions;
};

export type NotificationReport = {
  /** `null` : bot injoignable. Bilan vide si personne n'était joignable sur Discord. */
  discord: DiscordDeliveryReport | null;
  /** Appareils atteints. */
  pushed: number;
};

/**
 * Prévient des personnes nommées, sur les deux canaux à la fois.
 *
 * Un compte sans moyen Discord est tout de même un destinataire : il peut
 * avoir un appareil abonné. C'est la différence avec l'ancien envoi, qui
 * écartait d'emblée qui n'avait pas de tag.
 */
export async function notifyUsers(
  recipients: readonly NotificationRecipient[],
  notification: UserNotification,
): Promise<NotificationReport> {
  const discordRecipients = recipients
    .map((recipient) => recipient.discord)
    .filter((recipient): recipient is DiscordRecipient => recipient !== null);
  const userIds = recipients.map((recipient) => recipient.userId);

  const [discord, pushed] = await Promise.all([
    // Personne à joindre sur Discord : aucun appel au bot, un bilan vide.
    notification.discord && discordRecipients.length > 0
      ? pushDiscordDirectMessages(notification.discord.message, discordRecipients, notification.discord.context)
      : Promise.resolve({ sent: 0, unresolved: [], failed: [] }),
    pushToUsers(userIds, notification.topic, notification.push, notification.pushOptions),
  ]);
  return { discord, pushed };
}

export type StaffNotification = {
  topic: PushTopic;
  push: PushContent;
  /**
   * L'envoi Discord au métier (rôle arbitre, direction), déjà câblé par
   * l'appelant : il décide du coupe-circuit, que ce module n'a pas à connaître.
   */
  discord?: () => Promise<DiscordDeliveryReport | null>;
  pushOptions?: PushOptions;
};

/**
 * Prévient un métier : l'envoi Discord de l'appelant, et le push aux comptes
 * qui détiennent la permission du sujet.
 */
export async function notifyStaff(notification: StaffNotification): Promise<NotificationReport> {
  const audience = PUSH_TOPICS[notification.topic].audience;
  const staffPush = async (): Promise<number> => {
    if (audience === null) return 0;
    const candidates = await subscribedStaffCandidates();
    const userIds = candidates
      .filter((candidate) =>
        can({ isAdmin: candidate.isAdmin, roles: sanitizePlatformRoles(candidate.rolesJson) }, audience),
      )
      .map((candidate) => candidate.userId);
    return pushToUsers(userIds, notification.topic, notification.push, notification.pushOptions);
  };
  const [discord, pushed] = await Promise.all([
    notification.discord ? notification.discord() : Promise.resolve(null),
    staffPush().catch(() => 0),
  ]);
  return { discord, pushed };
}

type RecipientRow = RowDataPacket & {
  id: number;
  pseudo: string;
  discord_id: string | null;
  discord_pseudo: string | null;
  discord_verified_at: Date | string | null;
};

/**
 * Comment Discord joint un compte :
 *
 * - `proven` — identifiant rattaché, ou tag **certifié** : on n'écrit pas à
 *   l'inconnu qu'un tag saisi à la main peut désigner, quand le message parle
 *   du compte (modération, signalement, données) ;
 * - `declared` — tout tag, même saisi : les rappels de match ont toujours
 *   écrit au tag déclaré par le joueur lui-même, et le message ne dit rien de
 *   plus qu'un horaire public.
 */
export type DiscordReach = "proven" | "declared";

export function toNotificationRecipient(row: RecipientRow, reach: DiscordReach): NotificationRecipient {
  const handle = reach === "declared" || row.discord_verified_at ? row.discord_pseudo : null;
  const discord = row.discord_id || handle ? { discordId: row.discord_id, handle, label: row.pseudo } : null;
  return { userId: Number(row.id), discord };
}

/**
 * Les destinataires de comptes donnés, comptes supprimés exclus.
 */
export async function loadNotificationRecipients(
  userIds: readonly number[],
  reach: DiscordReach,
): Promise<NotificationRecipient[]> {
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return [];
  const db = await getDatabase();
  const [rows] = await db.query<RecipientRow[]>(
    `SELECT id, pseudo, discord_id, discord_pseudo, discord_verified_at
     FROM bg_users WHERE is_deleted = 0 AND id IN (${ids.map(() => "?").join(", ")})`,
    ids,
  );
  return rows.map((row) => toNotificationRecipient(row, reach));
}

/**
 * Joueurs des engagées données, par engagée : membres actuels d'une équipe et
 * joueur d'une entrée solo (`bg_teams.solo_user_id`, qui n'a pas de ligne de
 * membre). Une fantôme n'a personne.
 */
export async function loadEntrantPlayerIds(teamIds: readonly number[]): Promise<Map<number, number[]>> {
  const byTeam = new Map<number, number[]>();
  const ids = [...new Set(teamIds)];
  if (ids.length === 0) return byTeam;
  const db = await getDatabase();
  const placeholders = ids.map(() => "?").join(", ");
  const [rows] = await db.query<(RowDataPacket & { team_id: number; user_id: number })[]>(
    `SELECT tm.team_id, tm.user_id FROM bg_team_members tm
      WHERE tm.team_id IN (${placeholders}) AND tm.left_at IS NULL
     UNION
     SELECT t.id AS team_id, t.solo_user_id AS user_id FROM bg_teams t
      WHERE t.id IN (${placeholders}) AND t.solo_user_id IS NOT NULL`,
    [...ids, ...ids],
  );
  for (const row of rows) {
    const teamId = Number(row.team_id);
    byTeam.set(teamId, [...(byTeam.get(teamId) ?? []), Number(row.user_id)]);
  }
  return byTeam;
}

/**
 * Ceux qui ont **qualité pour agir au nom** des engagées données, par engagée :
 * `OWNER` et `MANAGER` d'une équipe (`hasTeamManagementRole`), le joueur d'une
 * entrée solo. Pour les notifications qui appellent un geste que seuls eux
 * peuvent faire — confirmer ou contester un score (`reportMatchScore` refuse
 * `NOT_TEAM_MANAGER`) : prévenir tout le roster enverrait un membre sportif
 * vers un bouton qu'il n'a pas.
 */
export async function loadEntrantManagerIds(teamIds: readonly number[]): Promise<Map<number, number[]>> {
  const byTeam = new Map<number, number[]>();
  const ids = [...new Set(teamIds)];
  if (ids.length === 0) return byTeam;
  const db = await getDatabase();
  const placeholders = ids.map(() => "?").join(", ");
  const [rows] = await db.query<
    (RowDataPacket & { team_id: number; user_id: number; roles_json: unknown; solo: number })[]
  >(
    `SELECT tm.team_id, tm.user_id, tm.roles_json, 0 AS solo FROM bg_team_members tm
      WHERE tm.team_id IN (${placeholders}) AND tm.left_at IS NULL
     UNION ALL
     SELECT t.id AS team_id, t.solo_user_id AS user_id, NULL AS roles_json, 1 AS solo FROM bg_teams t
      WHERE t.id IN (${placeholders}) AND t.solo_user_id IS NOT NULL`,
    [...ids, ...ids],
  );
  for (const row of rows) {
    if (Number(row.solo) !== 1 && !hasTeamManagementRole(parseRoles(row.roles_json))) continue;
    const teamId = Number(row.team_id);
    const users = byTeam.get(teamId) ?? [];
    if (!users.includes(Number(row.user_id))) users.push(Number(row.user_id));
    byTeam.set(teamId, users);
  }
  return byTeam;
}

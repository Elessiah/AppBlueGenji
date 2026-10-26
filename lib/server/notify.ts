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
import { isUnknownColumnError } from "@/lib/server/mysql-errors";
import { parseRoles } from "@/lib/server/serialization";
import { canDeclareTeamReady } from "@/lib/shared/match-launch";
import {
  pushDiscordDirectMessages,
  type DiscordDeliveryReport,
  type DiscordRecipient,
} from "@/lib/server/bot-integration";
import { can, sanitizePlatformRoles } from "@/lib/shared/permissions";
import { renderDm, type LocalizedDm } from "@/lib/shared/dm-language";
import type { Locale } from "@/lib/shared/locales";
import { accountLocaleFromRow } from "./users/account-locale";
import {
  PUSH_TOPICS,
  type LocalizedPushContent,
  type PushTopic,
} from "@/lib/shared/push-notifications";
import { pushToUsers, subscribedStaffCandidates, type PushOptions } from "./push-subscriptions";
import { matchDmEnabled } from "./users/match-dm-preference";

/** Une personne à prévenir : son compte, et comment Discord la joint (ou pas). */
export type NotificationRecipient = {
  userId: number;
  discord: DiscordRecipient | null;
};

export type UserNotification = {
  topic: PushTopic;
  /** Rédigée dans la langue de chaque destinataire (lot 9-3, `bg_users.locale`). */
  push: LocalizedPushContent;
  /**
   * Le message privé Discord, quand la notification en a un : rédigé dans la
   * langue du compte de chaque destinataire (`bg_users.locale`), bilingue si
   * elle n'a pas pu être lue (`docs/features/BOT_DM_LANGUAGE.md`).
   */
  discord?: { message: LocalizedDm; context: string };
  pushOptions?: PushOptions;
};

export type NotificationReport = {
  /**
   * `null` : bot injoignable pour **tous** les envois. Bilan vide si personne
   * n'était joignable sur Discord. Les destinataires d'une langue partent en un
   * appel au bot, les langues l'une après l'autre : un appel perdu arrête les
   * suivants. Si un appel a abouti, le bilan est celui des appels aboutis, et
   * {@link discordUnreachedUserIds} nomme les comptes de l'appel perdu et des
   * langues non tentées.
   */
  discord: DiscordDeliveryReport | null;
  /** Comptes dont l'appel au bot a échoué ou n'a pas été tenté (tous ceux joignables sur Discord si `discord` est `null`). */
  discordUnreachedUserIds: number[];
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
  const reachable = recipients.filter(
    (recipient): recipient is NotificationRecipient & { discord: DiscordRecipient } => recipient.discord !== null,
  );
  const userIds = recipients.map((recipient) => recipient.userId);
  const message = notification.discord;

  const [discord, pushed] = await Promise.all([
    // Personne à joindre sur Discord : aucun appel au bot, un bilan vide.
    message && reachable.length > 0
      ? sendLocalizedDirectMessages(reachable, message)
      : Promise.resolve({ report: { sent: 0, unresolved: [], failed: [] }, unreached: [] }),
    pushToUsers(userIds, notification.topic, notification.push, notification.pushOptions),
  ]);
  return { discord: discord.report, discordUnreachedUserIds: discord.unreached, pushed };
}

/**
 * Langue de chaque compte, en une lecture. Une lecture qui échoue (base
 * indisponible, colonne pas encore créée) ne coupe pas l'envoi : la langue
 * reste inconnue, et le message part bilingue.
 */
async function loadAccountLocales(userIds: readonly number[]): Promise<Map<number, Locale>> {
  const locales = new Map<number, Locale>();
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return locales;
  try {
    const db = await getDatabase();
    const [rows] = await db.query<(RowDataPacket & { id: number; locale: unknown })[]>(
      `SELECT id, locale FROM bg_users WHERE id IN (${ids.map(() => "?").join(", ")})`,
      ids,
    );
    for (const row of rows) locales.set(Number(row.id), accountLocaleFromRow(row.locale));
  } catch (error) {
    console.error("[notify] langue des comptes illisible, messages privés bilingues", error);
  }
  return locales;
}

/**
 * Un appel au bot par langue : chaque destinataire reçoit le message dans la
 * langue de son compte, bilingue s'il n'a pas pu être lue. Le bot distribue
 * un texte unique par appel (`POST /internal/notify/dm`), ce qui le laisse
 * ignorer tout de la langue — son contrat ne change pas.
 */
async function sendLocalizedDirectMessages(
  recipients: readonly (NotificationRecipient & { discord: DiscordRecipient })[],
  message: { message: LocalizedDm; context: string },
): Promise<{ report: DiscordDeliveryReport | null; unreached: number[] }> {
  const locales = await loadAccountLocales(recipients.map((recipient) => recipient.userId));
  const groups = new Map<Locale | null, (NotificationRecipient & { discord: DiscordRecipient })[]>();
  for (const recipient of recipients) {
    const locale = locales.get(recipient.userId) ?? null;
    const group = groups.get(locale);
    if (group) group.push(recipient);
    else groups.set(locale, [recipient]);
  }
  // Les langues partent **l'une après l'autre**, et un appel perdu arrête les
  // suivants : un bot lent ou tombé ne reçoit qu'un appel par notification,
  // comme avant le découpage par langue. Lancés ensemble, les appels d'un seul
  // match (deux camps, deux langues) atteindraient d'un coup le seuil du
  // coupe-circuit et suspendraient tout le trafic de fond pour une seule
  // notification ; les comptes non tentés sont rendus comme non joints.
  const sends: { group: (NotificationRecipient & { discord: DiscordRecipient })[]; report: DiscordDeliveryReport | null }[] = [];
  let botLost = false;
  for (const [locale, group] of groups) {
    const report = botLost
      ? null
      : await pushDiscordDirectMessages(
          renderDm(message.message, locale),
          group.map((recipient) => recipient.discord),
          message.context,
        );
    if (report === null) botLost = true;
    sends.push({ group, report });
  }
  const unreached = sends.flatMap(({ group, report }) => (report === null ? group.map((r) => r.userId) : []));
  const reached = sends.flatMap(({ report }) => (report === null ? [] : [report]));
  if (reached.length === 0) return { report: null, unreached };
  return {
    report: {
      sent: reached.reduce((total, report) => total + report.sent, 0),
      unresolved: reached.flatMap((report) => report.unresolved),
      failed: reached.flatMap((report) => report.failed),
    },
    unreached,
  };
}

export type StaffNotification = {
  topic: PushTopic;
  /** Rédigée dans la langue de chaque destinataire (lot 9-3, `bg_users.locale`). */
  push: LocalizedPushContent;
  /**
   * L'envoi Discord au métier (rôle arbitre, direction), déjà câblé par
   * l'appelant : il décide du coupe-circuit, que ce module n'a pas à connaître.
   */
  discord?: () => Promise<DiscordDeliveryReport | null>;
  pushOptions?: PushOptions;
  /**
   * Comptes à ne pas prévenir — l'auteur du geste, qui n'a rien à apprendre
   * de ce qu'il vient de faire.
   */
  excludeUserIds?: readonly number[];
};

/**
 * Prévient un métier : l'envoi Discord de l'appelant, et le push aux comptes
 * qui détiennent la permission du sujet (hors `excludeUserIds`).
 */
export async function notifyStaff(notification: StaffNotification): Promise<NotificationReport> {
  const audience = PUSH_TOPICS[notification.topic].audience;
  const excluded = new Set(notification.excludeUserIds ?? []);
  const staffPush = async (): Promise<number> => {
    if (audience === null) return 0;
    const candidates = await subscribedStaffCandidates();
    const userIds = candidates
      .filter((candidate) => !excluded.has(candidate.userId))
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
  return { discord, discordUnreachedUserIds: [], pushed };
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
 * - `certified` — tag **certifié** seul (`bg_users.discord_verified_at`) : les
 *   messages privés de match (horaires, rappels, « Match retiré »). Un tag
 *   saisi, ou un identifiant rattaché sans tag certifié, ne reçoit rien : on
 *   n'écrit pas en série à un compte Discord que le joueur n'a pas certifié
 *   (lutte contre le spam). Le joueur garde ses notifications push.
 */
export type DiscordReach = "proven" | "certified";

export function toNotificationRecipient(row: RecipientRow, reach: DiscordReach): NotificationRecipient {
  const certified = Boolean(row.discord_verified_at);
  const handle = certified ? row.discord_pseudo : null;
  const discordId = reach === "proven" || certified ? row.discord_id : null;
  const discord = discordId || handle ? { discordId, handle, label: row.pseudo } : null;
  return { userId: Number(row.id), discord };
}

/**
 * Les destinataires de comptes donnés, comptes supprimés exclus.
 *
 * `matchDm` : la notification est un **message privé de match** adressé à un
 * joueur (horaire posé, changé ou retiré, rappels, « Match retiré »). Un joueur
 * qui s'y est opposé dans « Mon profil » (`bg_users.match_dm_enabled = 0`,
 * `lib/server/users/match-dm-preference.ts`) reste un destinataire, **sans
 * canal Discord** : il garde ses notifications push, qui ont leurs propres
 * réglages par sujet. Les envois au staff (`notifyStaff`) ne lisent jamais ce
 * réglage.
 */
export async function loadNotificationRecipients(
  userIds: readonly number[],
  reach: DiscordReach,
  options: { matchDm?: boolean } = {},
): Promise<NotificationRecipient[]> {
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return [];
  const db = await getDatabase();
  const select = (withMatchDm: boolean) =>
    db.query<(RecipientRow & { match_dm_enabled?: number | null })[]>(
      `SELECT id, pseudo, discord_id, discord_pseudo, discord_verified_at${withMatchDm ? ", match_dm_enabled" : ""}
       FROM bg_users WHERE is_deleted = 0 AND id IN (${ids.map(() => "?").join(", ")})`,
      ids,
    );
  // La colonne n'est lue que pour un message de match : une migration en échec
  // (`reportSchemaFailure`, rejouée au démarrage suivant) ne coupe pas les
  // autres envois. Sans elle, personne n'a pu s'opposer (la route d'écriture
  // échoue aussi) : la relecture sans colonne garde le comportement d'avant.
  let rows: Awaited<ReturnType<typeof select>>[0];
  try {
    [rows] = await select(options.matchDm === true);
  } catch (error) {
    if (options.matchDm !== true || !isUnknownColumnError(error)) throw error;
    [rows] = await select(false);
  }
  return rows.map((row) => {
    const recipient = toNotificationRecipient(row, reach);
    return options.matchDm && !matchDmEnabled(row.match_dm_enabled) ? { ...recipient, discord: null } : recipient;
  });
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
 * Ceux qui **mènent le match** au nom des engagées données, par engagée :
 * `CAPITAINE`, `MANAGER` et `OWNER` d'une équipe (`canDeclareTeamReady`), le
 * joueur d'une entrée solo. Pour les notifications qui appellent un geste que
 * seuls eux peuvent faire — confirmer ou contester un score
 * (`reportMatchScore` refuse `NOT_TEAM_MATCH_LEADER`) : prévenir tout le roster
 * enverrait un membre sportif vers un bouton qu'il n'a pas.
 */
export async function loadEntrantMatchLeaderIds(teamIds: readonly number[]): Promise<Map<number, number[]>> {
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
    if (Number(row.solo) !== 1 && !canDeclareTeamReady(parseRoles(row.roles_json))) continue;
    const teamId = Number(row.team_id);
    const users = byTeam.get(teamId) ?? [];
    if (!users.includes(Number(row.user_id))) users.push(Number(row.user_id));
    byTeam.set(teamId, users);
  }
  return byTeam;
}

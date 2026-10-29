import type { RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import { isUnknownColumnError } from "@/lib/server/mysql-errors";
import type { ConnectionMethod } from "@/lib/shared/account-connections";
import { toIso } from "@/lib/server/serialization";
import { listPrivacyAcknowledgments } from "@/lib/server/privacy-consent";
import { listOwnConnectionLogs } from "@/lib/server/connection-logs";
import { listOwnMapEntries } from "@/lib/server/match-map-entries";
import { listTermsAcceptances } from "@/lib/server/terms-acceptance";
import { listReportsByAuthor } from "@/lib/server/content-reports";
import { exportPushData } from "@/lib/server/push-subscriptions";
import { listOwnSuspensions } from "@/lib/server/account-suspensions";
import type { PersonalDataExport } from "@/lib/shared/types";
import { getFullProfile } from "./full-profile";
import { accountLocaleFromRow } from "./account-locale";
import { listOwnLiveAnnouncements } from "./live-announcement-export";
import { listOwnMatchRoles } from "./match-roles-export";
import { battletagFromBlizzard } from "@/lib/server/battletag-origin";
import { matchDmEnabled } from "./match-dm-preference";
import { recruitmentModalBackOn, recruitmentModalOff } from "./recruitment-modal-preference";

/**
 * Colonnes du compte venues de changements récents (`RECENT_SCHEMA_CHANGES`),
 * de la plus ancienne à la plus récente : un `ALTER` échoué au démarrage ne doit
 * pas priver le titulaire de son export (droit d'accès). Elles sont lues dans
 * **la** lecture du compte ; une colonne refusée en est retirée seule — celle
 * que nomme l'erreur, à défaut la plus récente —, sans jamais faire taire les
 * autres, présentes.
 */
const OPTIONAL_ACCOUNT_COLUMNS = [
  "recruitment_modal_off",
  "discord_certify_prompt_dismissed_at",
  "certification_prompt_dismissed_at",
  "referee_objection_at",
  "overwatch_battletag_typed",
] as const;

type OptionalAccountColumn = (typeof OPTIONAL_ACCOUNT_COLUMNS)[number];

/**
 * La colonne optionnelle qu'une erreur « Unknown column » désigne ; sans nom
 * dans le message, la plus récente encore lue. Une colonne nommée hors de la
 * liste n'est pas un repli possible : `undefined`, l'erreur remonte.
 */
export function refusedOptionalColumn(
  error: unknown,
  remaining: readonly OptionalAccountColumn[],
): OptionalAccountColumn | undefined {
  const message = error instanceof Error ? error.message : "";
  const named = /Unknown column '(?:[^'.]*\.)?([^']+)'/i.exec(message)?.[1];
  if (named === undefined) return remaining.at(-1);
  return remaining.find((column) => column === named);
}

/**
 * Rassemble l'intégralité des données personnelles du propriétaire du compte
 * pour l'export RGPD (droit à la portabilité, art. 20). Retourne les données
 * brutes non masquées — l'appelant DOIT s'assurer que `userId` est bien celui
 * de l'utilisateur authentifié (jamais un tiers).
 */
export async function exportOwnData(userId: number): Promise<PersonalDataExport> {
  const db = await getDatabase();
  type AccountRow = RowDataPacket & {
    id: number;
    pseudo: string;
    avatar_url: string | null;
    overwatch_battletag: string | null;
    marvel_rivals_tag: string | null;
    discord_pseudo: string | null;
    discord_verified_at: Date | null;
    discord_id: string | null;
    discord_link_method: ConnectionMethod | null;
    google_sub: string | null;
    blizzard_sub: string | null;
    is_adult: 0 | 1 | null;
    is_admin: 0 | 1;
    visible_avatar: 0 | 1;
    visible_overwatch: 0 | 1;
    visible_marvel: 0 | 1;
    visible_major: 0 | 1;
    visible_discord: 0 | 1;
    open_to_recruitment: 0 | 1;
    locale: string | null;
    match_dm_enabled: number | null;
    created_at: Date;
  } & Partial<Record<OptionalAccountColumn, number | Date | null>>;
  const selectAccount = (optional: readonly OptionalAccountColumn[]) =>
    db.execute<AccountRow[]>(
      `SELECT id, pseudo, avatar_url, overwatch_battletag, marvel_rivals_tag,
              discord_pseudo, discord_verified_at, discord_id, discord_link_method,
              google_sub, blizzard_sub, is_adult, is_admin,
              visible_avatar, visible_overwatch, visible_marvel, visible_major, visible_discord,
              open_to_recruitment, locale, match_dm_enabled${optional.map((column) => `, ${column}`).join("")}, created_at
       FROM bg_users
       WHERE id = ? AND is_deleted = 0
       LIMIT 1`,
      [userId],
    );
  // Repli par colonne (`OPTIONAL_ACCOUNT_COLUMNS`) : une colonne absente garde
  // sa valeur par défaut dans l'export, comme la lecture de session
  // (`selectUserRows`), et une autre panne n'est jamais masquée.
  let optional: OptionalAccountColumn[] = [...OPTIONAL_ACCOUNT_COLUMNS];
  let rows: AccountRow[] = [];
  for (;;) {
    try {
      [rows] = await selectAccount(optional);
      break;
    } catch (error) {
      const refused = isUnknownColumnError(error) ? refusedOptionalColumn(error, optional) : undefined;
      if (refused === undefined) throw error;
      optional = optional.filter((column) => column !== refused);
    }
  }

  if (rows.length === 0) throw new Error("PROFILE_NOT_FOUND");
  const row = rows[0];
  const dateOf = (column: OptionalAccountColumn) => toIso((row[column] as Date | null | undefined) ?? null);
  const battletagTyped = Number(row.overwatch_battletag_typed ?? 0) === 1;

  // Réutilise l'agrégation existante pour les stats, l'historique d'équipes et
  // le palmarès de tournois (vue « self » = données complètes non masquées).
  const full = await getFullProfile({ id: userId }, userId);
  if (!full) throw new Error("PROFILE_NOT_FOUND");

  return {
    exportedAt: new Date().toISOString(),
    account: {
      id: Number(row.id),
      pseudo: row.pseudo,
      discordId: row.discord_id,
      discordPseudo: row.discord_pseudo,
      // L'export RGPD dit **tout** ce que le site détient : la date de
      // certification en fait partie, c'est elle qui justifie l'exposition du
      // tag à l'organisation.
      discordVerifiedAt: toIso(row.discord_verified_at),
      // Et ce que le site sait de la **porte** par laquelle ce Discord est
      // arrivé : c'est une donnée détenue, elle est donc rendue — `null` sur
      // les rattachements antérieurs à la colonne, qui ne se classent pas après
      // coup.
      discordLinkMethod: row.discord_link_method,
      googleSub: row.google_sub,
      blizzardSub: row.blizzard_sub,
      isAdult: row.is_adult === null ? null : Boolean(row.is_adult),
      isAdmin: Boolean(row.is_admin),
      // La langue du compte est une donnée détenue (lot 9-3) : elle est rendue.
      locale: accountLocaleFromRow(row.locale),
      // L'opposition aux messages privés de match est une donnée détenue : rendue.
      matchDmEnabled: matchDmEnabled(row.match_dm_enabled),
      // « Ne plus afficher » la modale d'arrivée du recrutement : donnée détenue, rendue.
      recruitmentModalOff: recruitmentModalOff(row.recruitment_modal_off as number | null | undefined),
      recruitmentModalBackOn: recruitmentModalBackOn(row.recruitment_modal_off as number | null | undefined),
      // « Ne plus voir » la fenêtre de certification du tag Discord : donnée détenue, rendue.
      discordCertifyPromptDismissedAt: dateOf("discord_certify_prompt_dismissed_at"),
      // Et celui de l'invitation à certifier de la fiche tournoi : rendu de même.
      certificationPromptDismissedAt: dateOf("certification_prompt_dismissed_at"),
      // L'opposition d'arbitre retenue (date), donnée détenue : rendue.
      refereeObjectionAt: dateOf("referee_objection_at"),
      // L'origine du BattleTag (`overwatch_battletag_typed`, `battletag-origin.ts`) :
      // tapé à la main, il n'est jamais tenu pour vérifié — donnée détenue, rendue.
      overwatchBattletagTyped: battletagTyped,
      createdAt: toIso(row.created_at) ?? new Date().toISOString(),
    },
    profile: {
      avatarUrl: row.avatar_url,
      overwatchBattletag: row.overwatch_battletag,
      // Fourni par Battle.net (donc tenu pour vérifié) ou non.
      // Sans BattleTag, rien n'a d'origine : jamais « fourni par Battle.net ».
      battletagFromBlizzard: Boolean(row.overwatch_battletag) && battletagFromBlizzard({
        blizzard_sub: row.blizzard_sub,
        overwatch_battletag_typed: battletagTyped ? 1 : 0,
      }),
      marvelRivalsTag: row.marvel_rivals_tag,
      visibility: {
        avatar: Boolean(row.visible_avatar),
        overwatch: Boolean(row.visible_overwatch),
        marvel: Boolean(row.visible_marvel),
        major: Boolean(row.visible_major),
        discord: Boolean(row.visible_discord),
      },
      openToRecruitment: Boolean(row.open_to_recruitment),
    },
    stats: full.stats,
    teamsTimeline: full.teamsTimeline,
    tournaments: full.tournaments,
    privacyAcknowledgments: await listPrivacyAcknowledgments(userId),
    termsAcceptances: await listTermsAcceptances(userId),
    reports: await listReportsByAuthor(userId),
    pushNotifications: await exportPushData(userId),
    connectionLogs: await listOwnConnectionLogs(userId),
    mapEntries: await listOwnMapEntries(userId),
    liveAnnouncements: await listOwnLiveAnnouncements(userId),
    ...(await listOwnMatchRoles(userId)),
    suspensions: (await listOwnSuspensions(userId)).map((suspension) => ({
      reason: suspension.reason,
      ground: suspension.ground,
      startsAt: suspension.startsAt,
      endsAt: suspension.endsAt,
      liftedAt: suspension.liftedAt,
    })),
  };
}

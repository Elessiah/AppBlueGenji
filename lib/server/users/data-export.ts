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
import { matchDmEnabled } from "./match-dm-preference";
import { recruitmentModalBackOn, recruitmentModalOff } from "./recruitment-modal-preference";

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
    /** Absente si son `ALTER` de `RECENT_SCHEMA_CHANGES` a échoué. */
    recruitment_modal_off?: number | null;
    /** Absente de même (changement récent). */
    discord_certify_prompt_dismissed_at?: Date | null;
    created_at: Date;
  };
  const selectAccount = (withModalOff: boolean, withCertifyPromptOff: boolean) =>
    db.execute<AccountRow[]>(
      `SELECT id, pseudo, avatar_url, overwatch_battletag, marvel_rivals_tag,
              discord_pseudo, discord_verified_at, discord_id, discord_link_method,
              google_sub, blizzard_sub, is_adult, is_admin,
              visible_avatar, visible_overwatch, visible_marvel, visible_major, visible_discord,
              open_to_recruitment, locale, match_dm_enabled${withModalOff ? ", recruitment_modal_off" : ""}${withCertifyPromptOff ? ", discord_certify_prompt_dismissed_at" : ""}, created_at
       FROM bg_users
       WHERE id = ? AND is_deleted = 0
       LIMIT 1`,
      [userId],
    );
  // Colonne d'un changement récent : son `ALTER` échoué au démarrage ne doit
  // pas priver le titulaire de son export (droit d'accès) — relu sans elle,
  // drapeau au défaut, comme la lecture de session (`selectUserRows`).
  // Un repli par colonne : la plus récente tombe seule d'abord, sans emporter
  // `recruitment_modal_off` (l'export doit dire le choix réellement gardé).
  // Chaque combinaison est tentée : l'absence de l'une ne fait jamais taire
  // l'autre, présente.
  const attempts: readonly (readonly [boolean, boolean])[] = [
    [true, true],
    [true, false],
    [false, true],
    [false, false],
  ];
  let rows: AccountRow[] = [];
  for (const [index, [modalOff, certifyOff]] of attempts.entries()) {
    try {
      [rows] = await selectAccount(modalOff, certifyOff);
      break;
    } catch (error) {
      if (!isUnknownColumnError(error) || index === attempts.length - 1) throw error;
    }
  }

  if (rows.length === 0) throw new Error("PROFILE_NOT_FOUND");
  const row = rows[0];

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
      recruitmentModalOff: recruitmentModalOff(row.recruitment_modal_off),
      recruitmentModalBackOn: recruitmentModalBackOn(row.recruitment_modal_off),
      // « Ne plus voir » la fenêtre de certification du tag Discord : donnée détenue, rendue.
      discordCertifyPromptDismissedAt: toIso(row.discord_certify_prompt_dismissed_at ?? null),
      createdAt: toIso(row.created_at) ?? new Date().toISOString(),
    },
    profile: {
      avatarUrl: row.avatar_url,
      overwatchBattletag: row.overwatch_battletag,
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
    suspensions: (await listOwnSuspensions(userId)).map((suspension) => ({
      reason: suspension.reason,
      ground: suspension.ground,
      startsAt: suspension.startsAt,
      endsAt: suspension.endsAt,
      liftedAt: suspension.liftedAt,
    })),
  };
}

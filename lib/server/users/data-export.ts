import type { RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
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

/**
 * Rassemble l'intégralité des données personnelles du propriétaire du compte
 * pour l'export RGPD (droit à la portabilité, art. 20). Retourne les données
 * brutes non masquées — l'appelant DOIT s'assurer que `userId` est bien celui
 * de l'utilisateur authentifié (jamais un tiers).
 */
export async function exportOwnData(userId: number): Promise<PersonalDataExport> {
  const db = await getDatabase();
  const [rows] = await db.execute<
    (RowDataPacket & {
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
      created_at: Date;
    })[]
  >(
    `SELECT id, pseudo, avatar_url, overwatch_battletag, marvel_rivals_tag,
            discord_pseudo, discord_verified_at, discord_id, discord_link_method,
            google_sub, blizzard_sub, is_adult, is_admin,
            visible_avatar, visible_overwatch, visible_marvel, visible_major, visible_discord,
            open_to_recruitment, created_at
     FROM bg_users
     WHERE id = ? AND is_deleted = 0
     LIMIT 1`,
    [userId],
  );

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
    suspensions: (await listOwnSuspensions(userId)).map((suspension) => ({
      reason: suspension.reason,
      ground: suspension.ground,
      startsAt: suspension.startsAt,
      endsAt: suspension.endsAt,
      liftedAt: suspension.liftedAt,
    })),
  };
}

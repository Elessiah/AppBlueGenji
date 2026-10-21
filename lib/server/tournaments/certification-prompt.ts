/**
 * Lecture de l'invitation à certifier (`lib/shared/certification-prompt.ts`)
 * pour le lecteur d'une fiche de tournoi : son roster en cours, en une requête.
 *
 * Voir `docs/features/CERTIFICATION_PROMPT.md`.
 */
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import {
  certificationPromptFor,
  teamHasContact,
  type CertificationIdentity,
  type CertificationPrompt,
} from "@/lib/shared/certification-prompt";
import { hasVerifiedBattletag, hasVerifiedDiscord } from "@/lib/shared/match-launch";

type RosterIdentityRow = RowDataPacket & {
  user_id: number;
  discord_verified_at: Date | string | null;
  discord_pseudo: string | null;
  blizzard_sub: string | null;
  overwatch_battletag: string | null;
};

/** Certifications d'un membre, par les règles mêmes de `pickLaunchContacts`. */
function identityOf(row: RosterIdentityRow): CertificationIdentity {
  return {
    discordVerified: hasVerifiedDiscord({
      discordVerified: row.discord_verified_at !== null,
      discordTag: row.discord_pseudo,
    }),
    battletagVerified: hasVerifiedBattletag({
      blizzardLinked: row.blizzard_sub !== null,
      battletag: row.overwatch_battletag,
    }),
  };
}

/**
 * Invitation due au lecteur, membre de l'équipe `teamId` ; `null` s'il n'en a
 * pas besoin, ou s'il n'est plus dans le roster (départ entre deux lectures).
 */
export async function loadCertificationPrompt(
  executor: Pick<PoolConnection, "execute">,
  userId: number,
  teamId: number,
  isManager: boolean,
  battletagRelevant: boolean,
): Promise<CertificationPrompt | null> {
  const [rows] = await executor.execute<RosterIdentityRow[]>(
    `SELECT u.id AS user_id, u.discord_verified_at, u.discord_pseudo, u.blizzard_sub, u.overwatch_battletag
     FROM bg_team_members tm
     JOIN bg_users u ON u.id = tm.user_id
     WHERE tm.team_id = ? AND tm.left_at IS NULL AND u.is_deleted = 0`,
    [teamId],
  );
  const viewer = rows.find((row) => Number(row.user_id) === userId);
  if (!viewer) return null;
  return certificationPromptFor({
    isManager,
    viewer: identityOf(viewer),
    teamHasContact: teamHasContact(rows.map(identityOf)),
    battletagRelevant,
  });
}

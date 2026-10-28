/**
 * Lecture de l'invitation à certifier (`lib/shared/certification-prompt.ts`)
 * pour le lecteur d'une fiche de tournoi : son roster en cours, en une requête.
 *
 * Voir `docs/features/CERTIFICATION_PROMPT.md`.
 */
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import { isUnknownColumnError } from "@/lib/server/mysql-errors";
import { forgetCertificationPromptsOf } from "./certification-prompt-cache";
import {
  certificationPromptFor,
  teamHasContact,
  type CertificationIdentity,
  type CertificationPrompt,
} from "@/lib/shared/certification-prompt";

type CertificationRow = RowDataPacket & {
  user_id: number;
  discord_verified: number | boolean | null;
  battletag_verified: number | boolean | null;
  blizzard_linked: number | boolean | null;
};

/**
 * Le roster en cours de l'équipe, réduit à ce que la règle lit : qui, et ses
 * deux certifications (minimisation — ni pseudo, ni tag, ni identifiant
 * Battle.net, ni rôles ne sortent de la base pour quelques booléens). Les
 * certifications s'y calculent par les règles mêmes du lancement :
 * `hasVerifiedDiscord` (date de certification **et** tag non vide) et
 * `hasVerifiedBattletag` (Battle.net rattaché **et** BattleTag non vide,
 * `lib/shared/match-launch.ts`) ; `blizzard_linked` dit un Battle.net rattaché
 * sans BattleTag (inactionnable depuis le profil).
 */
async function loadRosterCertifications(
  executor: Pick<PoolConnection, "execute">,
  teamId: number,
): Promise<{ userId: number; identity: CertificationIdentity; blizzardLinked: boolean }[]> {
  const [rows] = await executor.execute<CertificationRow[]>(
    `SELECT tm.user_id,
            (u.discord_verified_at IS NOT NULL AND COALESCE(u.discord_pseudo, '') <> '') AS discord_verified,
            (u.blizzard_sub IS NOT NULL AND COALESCE(u.overwatch_battletag, '') <> '') AS battletag_verified,
            (u.blizzard_sub IS NOT NULL) AS blizzard_linked
     FROM bg_team_members tm
     JOIN bg_users u ON u.id = tm.user_id
     WHERE tm.team_id = ? AND tm.left_at IS NULL AND u.is_deleted = 0`,
    [teamId],
  );
  return rows.map((row) => ({
    userId: Number(row.user_id),
    identity: { discordVerified: Number(row.discord_verified ?? 0) === 1, battletagVerified: Number(row.battletag_verified ?? 0) === 1 },
    blizzardLinked: Number(row.blizzard_linked ?? 0) === 1,
  }));
}

/**
 * Un choix du compte posé (date non nulle) dans `column` ? Colonne absente
 * (`ALTER` échoué) : comme sans choix.
 */
async function accountChoiceSet(
  executor: Pick<PoolConnection, "execute">,
  userId: number,
  column: "discord_certify_prompt_dismissed_at" | "certification_prompt_dismissed_at",
): Promise<boolean> {
  try {
    const [rows] = await executor.execute<RowDataPacket[]>(
      `SELECT ${column} IS NOT NULL AS chosen FROM bg_users WHERE id = ?`,
      [userId],
    );
    return Number(rows[0]?.chosen ?? 0) === 1;
  } catch (error) {
    if (isUnknownColumnError(error)) return false;
    throw error;
  }
}

/**
 * Invitation due au lecteur, membre de l'équipe `teamId` ; `null` s'il n'en a
 * pas besoin, s'il n'est plus dans le roster (départ entre deux lectures), ou
 * s'il a coché « Ne plus voir » dans cette modale (gardé sur **son** compte,
 * `bg_users.certification_prompt_dismissed_at` : jamais celui d'un autre
 * compte du même navigateur). En Marvel Rivals, un BattleTag vérifié ne compte
 * pas comme contact (`teamHasContact`) : le lancement ne le présente pas non
 * plus (`sideContacts`, décision de l'utilisateur 38).
 */
export async function loadCertificationPrompt(
  executor: Pick<PoolConnection, "execute">,
  userId: number,
  teamId: number,
  isManager: boolean,
  battletagRelevant: boolean,
): Promise<CertificationPrompt | null> {
  const members = await loadRosterCertifications(executor, teamId);
  const viewer = members.find((member) => member.userId === userId);
  if (!viewer) return null;
  // Battle.net rattaché sans BattleTag enregistré : rien à faire depuis le
  // profil (le rattachement est déjà là, un BattleTag tapé y est refusé) — la
  // modale ne lui en parle pas (variante « Discord seul »). Pour l'équipe, il
  // ne fait toujours pas un contact.
  const own = viewer.identity;
  const battletagUnfixable = viewer.blizzardLinked && !own.battletagVerified;
  const teamReachable = teamHasContact(members.map((member) => member.identity), battletagRelevant);
  const prompt = certificationPromptFor({
    isManager,
    viewer: own,
    teamHasContact: teamReachable,
    battletagRelevant: battletagRelevant && !battletagUnfixable,
  });
  // Les choix du compte ne se lisent que quand une invitation est due : la
  // plupart des lecteurs n'en ont pas.
  if (prompt === null) return null;
  // « Ne plus voir » de cette modale : le choix de ce compte, pour toute invitation.
  if (await accountChoiceSet(executor, userId, "certification_prompt_dismissed_at")) return null;
  // Refus de la proposition de la connexion (`DISCORD_CERTIFY_PROMPT.md`) : un
  // choix personnel, qui ne tait que l'invitation faite au meneur pour
  // lui-même, et seulement quand Discord est seul en cause — jamais l'alerte
  // d'une équipe sans aucun contact. Variante affichée : un BattleTag
  // inactionnable n'y figure pas, la modale ne parle que de Discord — celle-là
  // même que ce refus a écartée.
  const onlyDiscordMissing = !prompt.discordVerified && (prompt.battletagVerified || !prompt.battletagRelevant);
  if (
    teamReachable &&
    onlyDiscordMissing &&
    (await accountChoiceSet(executor, userId, "discord_certify_prompt_dismissed_at"))
  ) {
    return null;
  }
  return prompt;
}

/**
 * « Ne plus voir » coché dans l'invitation de la fiche tournoi : posé sur le
 * compte (date du premier choix, `COALESCE` implicite par le `WHERE`), jamais
 * sur un compte supprimé ; rejoué, il n'écrit rien. L'invitation retenue en
 * mémoire pour ce compte est oubliée : la lecture suivante la tait.
 */
export async function recordCertificationPromptOff(userId: number): Promise<void> {
  if (!Number.isInteger(userId) || userId <= 0) return;
  const db = await getDatabase();
  await db.execute(
    `UPDATE bg_users SET certification_prompt_dismissed_at = NOW()
     WHERE id = ? AND is_deleted = 0 AND certification_prompt_dismissed_at IS NULL`,
    [userId],
  );
  forgetCertificationPromptsOf(userId);
}

export {
  CERTIFICATION_PROMPT_CACHE_MAX,
  CERTIFICATION_PROMPT_FAILURE_TTL_MS,
  CERTIFICATION_PROMPT_READ_TIMEOUT_MS,
  CERTIFICATION_PROMPT_STUCK_READ_MS,
  CERTIFICATION_PROMPT_TTL_MS,
  cachedCertificationPrompt,
  finalCertificationPrompt,
  forgetCertificationPrompts,
  forgetCertificationPromptsOf,
  peekCertificationPrompt,
} from "./certification-prompt-cache";

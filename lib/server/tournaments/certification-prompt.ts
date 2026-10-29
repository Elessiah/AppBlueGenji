/**
 * Lecture de l'invitation à certifier (`lib/shared/certification-prompt.ts`)
 * pour le lecteur d'une fiche de tournoi : son roster en cours, en une requête.
 *
 * Voir `docs/features/CERTIFICATION_PROMPT.md`.
 */
import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import { isUnknownColumnError } from "@/lib/server/mysql-errors";
import { battletagFromBlizzard } from "@/lib/server/battletag-origin";
import { hasVerifiedBattletag, hasVerifiedDiscord } from "@/lib/shared/match-launch";
import { forgetCertificationPromptsOf, forgetCertificationPromptsOfTeam } from "./certification-prompt-cache";
import {
  certificationPromptFor,
  teamHasContact,
  type CertificationIdentity,
  type CertificationPrompt,
} from "@/lib/shared/certification-prompt";

type CertificationRow = RowDataPacket & {
  user_id: number;
  discord_verified_at: Date | string | null;
  discord_pseudo: string | null;
  blizzard_sub: string | null;
  overwatch_battletag: string | null;
  overwatch_battletag_typed: number | null;
};

/**
 * Le roster en cours de l'équipe, réduit à ce que la règle lit : qui, et ses
 * deux certifications. Les colonnes brutes sont lues et passées aux règles
 * mêmes du lancement — `hasVerifiedDiscord` (date de certification **et** tag
 * non vide) et `hasVerifiedBattletag` (BattleTag venu de Battle.net,
 * `battletag-origin.ts`, **et** non vide, `lib/shared/match-launch.ts`) — et
 * non réécrites en SQL : une évolution de la règle partagée ne peut plus faire
 * diverger l'invitation de `pickLaunchContacts`. Tags et identifiant ne
 * quittent pas cette fonction (seuls des booléens en sortent) ;
 * `blizzardLinked` dit un Battle.net rattaché, BattleTag vérifié ou non
 * (inactionnable depuis le profil).
 */
async function loadRosterCertifications(
  executor: Pick<PoolConnection, "execute">,
  teamId: number,
): Promise<{ userId: number; identity: CertificationIdentity; blizzardLinked: boolean }[]> {
  const [rows] = await executor.execute<CertificationRow[]>(
    `SELECT tm.user_id, u.discord_verified_at, u.discord_pseudo, u.blizzard_sub,
            u.overwatch_battletag, u.overwatch_battletag_typed
     FROM bg_team_members tm
     JOIN bg_users u ON u.id = tm.user_id
     WHERE tm.team_id = ? AND tm.left_at IS NULL AND u.is_deleted = 0`,
    [teamId],
  );
  return rows.map((row) => ({
    userId: Number(row.user_id),
    identity: {
      discordVerified: hasVerifiedDiscord({
        discordVerified: row.discord_verified_at !== null,
        discordTag: row.discord_pseudo,
      }),
      battletagVerified: hasVerifiedBattletag({
        blizzardLinked: battletagFromBlizzard(row),
        battletag: row.overwatch_battletag,
      }),
    },
    blizzardLinked: row.blizzard_sub !== null,
  }));
}

type AccountChoices = { certificationPromptOff: boolean; discordCertifyPromptOff: boolean };

/** Un choix posé (date non nulle) dans `column`, seul ; colonne absente : comme sans choix. */
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
 * Les deux « Ne plus voir » du compte, en **un** SELECT. Une colonne absente
 * (`ALTER` échoué) fait échouer la lecture commune : chacune est alors relue à
 * part, l'absente valant « sans choix ».
 */
async function loadAccountChoices(
  executor: Pick<PoolConnection, "execute">,
  userId: number,
): Promise<AccountChoices> {
  try {
    const [rows] = await executor.execute<RowDataPacket[]>(
      `SELECT certification_prompt_dismissed_at IS NOT NULL AS certification_off,
              discord_certify_prompt_dismissed_at IS NOT NULL AS discord_off
       FROM bg_users WHERE id = ?`,
      [userId],
    );
    return {
      certificationPromptOff: Number(rows[0]?.certification_off ?? 0) === 1,
      discordCertifyPromptOff: Number(rows[0]?.discord_off ?? 0) === 1,
    };
  } catch (error) {
    if (!isUnknownColumnError(error)) throw error;
    return {
      certificationPromptOff: await accountChoiceSet(executor, userId, "certification_prompt_dismissed_at"),
      discordCertifyPromptOff: await accountChoiceSet(executor, userId, "discord_certify_prompt_dismissed_at"),
    };
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
  // Battle.net rattaché sans BattleTag venu de lui : rien à faire depuis le
  // profil (le rattachement est déjà là, un BattleTag tapé n'y est jamais
  // vérifié, `battletag-origin.ts`) — la
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
  const choices = await loadAccountChoices(executor, userId);
  // « Ne plus voir » de cette modale : le choix de ce compte, pour toute invitation.
  if (choices.certificationPromptOff) return null;
  // Refus de la proposition de la connexion (`DISCORD_CERTIFY_PROMPT.md`) : un
  // choix personnel, qui ne tait que l'invitation faite au meneur pour
  // lui-même, et seulement quand Discord est seul en cause — jamais l'alerte
  // d'une équipe sans aucun contact. Variante affichée : un BattleTag
  // inactionnable n'y figure pas, la modale ne parle que de Discord — celle-là
  // même que ce refus a écartée.
  const onlyDiscordMissing = !prompt.discordVerified && (prompt.battletagVerified || !prompt.battletagRelevant);
  if (teamReachable && onlyDiscordMissing && choices.discordCertifyPromptOff) return null;
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
  const [result] = await db.execute<ResultSetHeader>(
    `UPDATE bg_users SET certification_prompt_dismissed_at = NOW()
     WHERE id = ? AND is_deleted = 0 AND certification_prompt_dismissed_at IS NULL`,
    [userId],
  );
  // Déjà gardé (rejoué) : la mémoire ne porte déjà plus d'invitation pour lui.
  if (result.affectedRows > 0) forgetCertificationPromptsOf(userId);
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
  forgetCertificationPromptsOfTeam,
  peekCertificationPrompt,
} from "./certification-prompt-cache";

/**
 * Après un geste qui change la certification d'un compte (Discord certifié,
 * Battle.net rattaché, tag retiré) : oublie ses invitations **et** celles de
 * ses coéquipiers, dont l'état « équipe sans contact » dépend de lui. Son
 * équipe active est relue (une requête indexée) ; une lecture en échec n'oublie
 * que le compte (journal pm2) — les coéquipiers relisent au plus une minute
 * plus tard. Ne rejette jamais.
 */
export async function forgetCertificationPromptsAround(userId: number): Promise<void> {
  forgetCertificationPromptsOf(userId);
  try {
    const db = await getDatabase();
    const [rows] = await db.execute<(RowDataPacket & { team_id: number })[]>(
      `SELECT team_id FROM bg_team_members WHERE user_id = ? AND left_at IS NULL`,
      [userId],
    );
    for (const row of rows) forgetCertificationPromptsOfTeam(Number(row.team_id));
  } catch (error) {
    console.error("[tournaments] équipe du compte illisible pour l'invitation à certifier :", error);
  }
}

/**
 * Lecture de l'invitation à certifier (`lib/shared/certification-prompt.ts`)
 * pour le lecteur d'une fiche de tournoi : son roster en cours, en une requête.
 *
 * Voir `docs/features/CERTIFICATION_PROMPT.md`.
 */
import type { PoolConnection } from "mysql2/promise";
import { parseRoles } from "@/lib/server/serialization";
import {
  certificationPromptFor,
  teamHasContact,
  type CertificationIdentity,
  type CertificationPrompt,
} from "@/lib/shared/certification-prompt";
import { hasVerifiedBattletag, hasVerifiedDiscord, type ContactCandidate } from "@/lib/shared/match-launch";
import { loadRosters, toCandidate } from "./match-launch-info";

/** Certifications d'un membre, par les règles mêmes de `pickLaunchContacts`. */
function identityOf(member: ContactCandidate): CertificationIdentity {
  return { discordVerified: hasVerifiedDiscord(member), battletagVerified: hasVerifiedBattletag(member) };
}

/**
 * Invitation due au lecteur, membre de l'équipe `teamId` ; `null` s'il n'en a
 * pas besoin, ou s'il n'est plus dans le roster (départ entre deux lectures).
 * Le roster et ses certifications se lisent comme le lancement les lit
 * (`loadRosters`, `toCandidate`, `hasVerifiedDiscord` / `hasVerifiedBattletag`).
 * Seule différence voulue : en Marvel Rivals, un BattleTag vérifié ne compte
 * pas comme contact (`teamHasContact`), même si le lancement le présente.
 */
export async function loadCertificationPrompt(
  executor: Pick<PoolConnection, "execute">,
  userId: number,
  teamId: number,
  isManager: boolean,
  battletagRelevant: boolean,
): Promise<CertificationPrompt | null> {
  const rosters = await loadRosters(executor, new Set([teamId]));
  const members = (rosters.get(teamId) ?? []).map((row) => toCandidate({ ...row, roles: parseRoles(row.roles_json) }));
  const viewer = members.find((member) => member.userId === userId);
  if (!viewer) return null;
  return certificationPromptFor({
    isManager,
    viewer: identityOf(viewer),
    teamHasContact: teamHasContact(members.map(identityOf), battletagRelevant),
    battletagRelevant,
  });
}

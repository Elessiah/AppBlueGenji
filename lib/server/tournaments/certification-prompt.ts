/**
 * Lecture de l'invitation à certifier (`lib/shared/certification-prompt.ts`)
 * pour le lecteur d'une fiche de tournoi : son roster en cours, en une requête.
 *
 * Voir `docs/features/CERTIFICATION_PROMPT.md`.
 */
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { isUnknownColumnError } from "@/lib/server/mysql-errors";
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
 * « Ne plus voir » donné à la proposition de certification de la connexion
 * (`DISCORD_CERTIFY_PROMPT.md`, gardé sur le compte) : l'invitation de la fiche
 * le respecte aussi, sur tous les appareils — quand Discord est **seul** à
 * manquer (un BattleTag à vérifier n'était pas l'objet de ce refus). Colonne
 * absente (`ALTER` échoué) : comme sans choix.
 */
async function certificationNudgesDeclined(executor: Pick<PoolConnection, "execute">, userId: number): Promise<boolean> {
  try {
    const [rows] = await executor.execute<RowDataPacket[]>(
      "SELECT discord_certify_prompt_dismissed_at IS NOT NULL AS declined FROM bg_users WHERE id = ?",
      [userId],
    );
    return Number(rows[0]?.declined ?? 0) === 1;
  } catch (error) {
    if (isUnknownColumnError(error)) return false;
    throw error;
  }
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
  // Les rôles ne comptent pas ici (seules les certifications) : pas de lecture du JSON.
  const members = (rosters.get(teamId) ?? []).map((row) => toCandidate({ ...row, roles: [] }));
  const viewer = members.find((member) => member.userId === userId);
  if (!viewer) return null;
  // Battle.net rattaché sans BattleTag enregistré : rien à faire depuis le
  // profil (le rattachement est déjà là, un BattleTag tapé y est refusé) — la
  // modale ne lui en parle pas (variante « Discord seul »). Pour l'équipe, il
  // ne fait toujours pas un contact.
  const own = identityOf(viewer);
  const battletagUnfixable = viewer.blizzardLinked && !own.battletagVerified;
  const teamReachable = teamHasContact(members.map(identityOf), battletagRelevant);
  const prompt = certificationPromptFor({
    isManager,
    viewer: own,
    teamHasContact: teamReachable,
    battletagRelevant: battletagRelevant && !battletagUnfixable,
  });
  // Refus de la proposition de la connexion : un choix personnel, qui ne tait
  // que l'invitation faite au meneur pour lui-même, et seulement quand Discord
  // est seul en cause — jamais l'alerte d'une équipe sans aucun contact. Lu
  // dans ce seul cas : la plupart des lecteurs n'en ont pas.
  if (prompt === null) return null;
  const onlyDiscordMissing = !prompt.discordVerified && (prompt.battletagVerified || !prompt.battletagRelevant);
  if (teamReachable && onlyDiscordMissing && (await certificationNudgesDeclined(executor, userId))) {
    return null;
  }
  return prompt;
}

/**
 * Mémoire courte des invitations calculées, par lecteur (utilisateur, équipe,
 * rôle, jeu). Le contexte du lecteur se relit à chaque lecture REST de la
 * fiche ; sans elle, chaque geste d'un meneur un soir de match coûterait une
 * place du pool et une ou deux requêtes. Une certification faite entre-temps
 * se voit au plus une minute plus tard. Bornée ; la lecture **en cours** est
 * partagée (une vague de reconnexions ne vaut qu'une requête par lecteur) ; un
 * échec — ou une lecture de plus de trois secondes — est retenu dix secondes,
 * sans quoi chaque lecture le retenterait pendant la panne même.
 */
export const CERTIFICATION_PROMPT_TTL_MS = 60_000;
export const CERTIFICATION_PROMPT_FAILURE_TTL_MS = 10_000;
/**
 * Au-delà, une lecture est tenue pour échouée (pool saturé, lien à demi
 * ouvert) : partagée, elle retiendrait sinon toutes les lectures du contexte
 * de ce lecteur — flux compris — aussi longtemps qu'elle pend.
 */
export const CERTIFICATION_PROMPT_READ_TIMEOUT_MS = 3_000;
const CERTIFICATION_PROMPT_CACHE_MAX = 2_000;
const recentPrompts = new Map<string, { value: Promise<CertificationPrompt | null>; expiresAt: number }>();

/**
 * Invitation de `key`, lue par `load` au plus une fois par fenêtre (une minute,
 * dix secondes après un échec, qui rend `null`), et au plus une fois à la fois.
 */
export function cachedCertificationPrompt(
  key: string,
  load: () => Promise<CertificationPrompt | null>,
  now: () => number = Date.now,
): Promise<CertificationPrompt | null> {
  const entry = recentPrompts.get(key);
  if (entry && entry.expiresAt > now()) return entry.value;
  recentPrompts.delete(key);
  if (recentPrompts.size >= CERTIFICATION_PROMPT_CACHE_MAX) {
    const oldest = recentPrompts.keys().next().value;
    if (oldest !== undefined) recentPrompts.delete(oldest);
  }
  const slot = { value: Promise.resolve<CertificationPrompt | null>(null), expiresAt: Number.POSITIVE_INFINITY };
  slot.value = withTimeout(load(), CERTIFICATION_PROMPT_READ_TIMEOUT_MS).then(
    (prompt) => {
      slot.expiresAt = now() + CERTIFICATION_PROMPT_TTL_MS;
      return prompt;
    },
    (error: unknown) => {
      console.error("[tournaments] invitation à certifier indisponible :", error);
      slot.expiresAt = now() + CERTIFICATION_PROMPT_FAILURE_TTL_MS;
      return null;
    },
  );
  recentPrompts.set(key, slot);
  return slot.value;
}

/** `promise`, ou un échec passé `ms` (la lecture abandonnée finit seule). */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("CERTIFICATION_PROMPT_TIMEOUT")), ms);
  });
  return Promise.race([promise, expired]).finally(() => clearTimeout(timer));
}

/** Vide la mémoire (tests). */
export function forgetCertificationPrompts(): void {
  recentPrompts.clear();
}

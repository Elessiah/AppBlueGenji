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
  // Statut réel du BattleTag (pas la variante d'affichage d'un BattleTag
  // inactionnable) : les déclarations promettent « seul Discord manque ».
  const onlyDiscordMissing = !prompt.discordVerified && (own.battletagVerified || !battletagRelevant);
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
 * échec est retenu dix secondes, une lecture abandonnée après trois secondes
 * une minute — sans quoi chaque relecture la retenterait pendant la panne même.
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
/** Lectures retenues encore en cours : la mémoire pleine d'elles se sait sans la parcourir. */
let inFlightPrompts = 0;

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
  recentPrompts.delete(key);
  if (entry && entry.expiresAt > now()) {
    // Servie : remise en fin d'ordre — les plus anciennes restent en tête.
    recentPrompts.set(key, entry);
    return entry.value;
  }
  const room = makeRoom(now());

  const slot = { value: Promise.resolve<CertificationPrompt | null>(null), expiresAt: Number.POSITIVE_INFINITY };
  const reading = load();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<"TIMEOUT">((resolve) => {
    timer = setTimeout(() => resolve("TIMEOUT"), CERTIFICATION_PROMPT_READ_TIMEOUT_MS);
  });
  // La lecture n'est pas annulable : abandonnée, sa clé reste occupée une
  // minute (« rien » servi tout de suite), pour qu'une lecture qui pend ne
  // soit pas doublée à chaque relecture ; finie tard mais réussie, elle sert
  // quand même. Le compte des lectures en cours s'arrête à l'abandon : une
  // lecture qui pendrait pour de bon (lien à demi ouvert) n'occupe pas la
  // mémoire à jamais.
  const settled = reading.then(
    (prompt) => ({ ok: true as const, prompt }),
    (error: unknown) => ({ ok: false as const, error }),
  );
  if (room) inFlightPrompts += 1;
  slot.value = Promise.race([settled, expired]).then((outcome) => {
    clearTimeout(timer);
    if (room) inFlightPrompts = Math.max(0, inFlightPrompts - 1);
    if (outcome === "TIMEOUT") {
      logCertificationPromptFailure(now(), "lecture abandonnée après 3 s");
      slot.expiresAt = now() + CERTIFICATION_PROMPT_TTL_MS;
      void settled.then((late) => {
        if (!late.ok) return;
        slot.value = Promise.resolve(late.prompt);
        slot.expiresAt = now() + CERTIFICATION_PROMPT_TTL_MS;
      });
      return null;
    }
    if (outcome.ok) {
      slot.expiresAt = now() + CERTIFICATION_PROMPT_TTL_MS;
      return outcome.prompt;
    }
    logCertificationPromptFailure(now(), outcome.error);
    slot.expiresAt = now() + CERTIFICATION_PROMPT_FAILURE_TTL_MS;
    return null;
  });
  // Mémoire pleine de lectures en cours : celle-ci se fait sans être retenue.
  if (room) recentPrompts.set(key, slot);
  return slot.value;
}

/**
 * Place pour une entrée de plus : les entrées expirées partent d'abord, puis
 * la plus ancienne **terminée** — jamais une lecture en cours, qui ne serait
 * plus partagée. `false` : rien à chasser, la mémoire ne grandit pas.
 */
function makeRoom(at: number): boolean {
  if (recentPrompts.size < CERTIFICATION_PROMPT_CACHE_MAX) return true;
  if (inFlightPrompts >= CERTIFICATION_PROMPT_CACHE_MAX) return false;
  // En tête, les moins récemment servies : on s'arrête à la première vivante
  // terminée (les lectures en cours, sans échéance, sont passées).
  for (const [key, entry] of recentPrompts) {
    if (entry.expiresAt <= at) recentPrompts.delete(key);
    else if (entry.expiresAt !== Number.POSITIVE_INFINITY) break;
  }
  if (recentPrompts.size < CERTIFICATION_PROMPT_CACHE_MAX) return true;
  for (const [key, entry] of recentPrompts) {
    if (entry.expiresAt !== Number.POSITIVE_INFINITY) {
      recentPrompts.delete(key);
      return true;
    }
  }
  return false;
}

/**
 * Une panne de base touche tous les lecteurs à la fois : un seul message par
 * fenêtre d'échec dans pm2, avec le nombre d'échecs tus depuis le précédent.
 */
let lastFailureLogAt = Number.NEGATIVE_INFINITY;
let silencedFailures = 0;
function logCertificationPromptFailure(at: number, error: unknown): void {
  if (at - lastFailureLogAt < CERTIFICATION_PROMPT_FAILURE_TTL_MS) {
    silencedFailures += 1;
    return;
  }
  const silenced = silencedFailures > 0 ? ` (${silencedFailures} autres tus)` : "";
  console.error(`[tournaments] invitation à certifier indisponible${silenced} :`, error);
  lastFailureLogAt = at;
  silencedFailures = 0;
}

/** Vide la mémoire (tests). */
export function forgetCertificationPrompts(): void {
  recentPrompts.clear();
  inFlightPrompts = 0;
  lastFailureLogAt = Number.NEGATIVE_INFINITY;
  silencedFailures = 0;
}

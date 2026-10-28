/**
 * Mémoire courte des invitations à certifier calculées, par lecteur
 * (utilisateur, équipe, rôle, jeu) — `docs/features/CERTIFICATION_PROMPT.md`.
 *
 * Module **sans dépendance** : les gestes qui changent la réponse
 * (certification Discord, rattachement Battle.net, « Ne plus voir ») l'oublient
 * pour leur compte (`forgetCertificationPromptsOf`) sans tirer le moteur des
 * tournois.
 *
 * Le contexte du lecteur se relit à chaque lecture REST de la fiche ; sans
 * elle, chaque geste d'un meneur un soir de match coûterait une place du pool
 * et une ou deux requêtes. Bornée ; la lecture **en cours** est partagée (une
 * vague de reconnexions ne vaut qu'une requête par lecteur) ; un échec est
 * retenu dix secondes, une lecture abandonnée après trois secondes une minute
 * — et tant qu'elle pend encore (dix minutes au plus), sa clé n'en relance pas
 * une autre : pendant un blocage du pool, chaque lecteur n'ajoute qu'une
 * acquisition à la file, pas une par minute. Mémoire pleine de lectures en
 * cours : « rien » servi sans lire.
 */
import type { CertificationPrompt } from "@/lib/shared/certification-prompt";

export const CERTIFICATION_PROMPT_TTL_MS = 60_000;
export const CERTIFICATION_PROMPT_FAILURE_TTL_MS = 10_000;
/**
 * Au-delà, une lecture est tenue pour échouée (pool saturé, lien à demi
 * ouvert) : partagée, elle retiendrait sinon toutes les lectures du contexte
 * de ce lecteur — flux compris — aussi longtemps qu'elle pend.
 */
export const CERTIFICATION_PROMPT_READ_TIMEOUT_MS = 3_000;
/**
 * Au-delà, une lecture abandonnée qui pend encore est tenue pour perdue (lien
 * à demi ouvert) : sa clé peut relire.
 */
export const CERTIFICATION_PROMPT_STUCK_READ_MS = 10 * 60_000;
export const CERTIFICATION_PROMPT_CACHE_MAX = 2_000;

type Slot = {
  value: Promise<CertificationPrompt | null>;
  /** Échéance, posée à l'issue (réussite, échec ou abandon). */
  expiresAt: number;
  /** Issue connue : la valeur servie, sans attendre. */
  settled: { prompt: CertificationPrompt | null } | null;
  /** La lecture elle-même n'a pas encore répondu (abandonnée comprise). */
  reading: boolean;
  startedAt: number;
  /** Abandonnée après `CERTIFICATION_PROMPT_READ_TIMEOUT_MS` : une réponse tardive réussie servira. */
  timedOut: boolean;
  /** Oubliée pendant la lecture : son issue n'est pas retenue. */
  forgotten: boolean;
};

/** Lectures en cours, partagées ; sans échéance tant qu'elles n'ont pas d'issue. */
const inFlight = new Map<string, Slot>();
/** Issues connues, des moins récemment servies (en tête) aux plus récentes. */
const recent = new Map<string, Slot>();

/**
 * Invitation de `key`, lue par `load` au plus une fois par fenêtre (une minute,
 * dix secondes après un échec, qui rend `null`), et au plus une fois à la fois.
 */
export function cachedCertificationPrompt(
  key: string,
  load: () => Promise<CertificationPrompt | null>,
  now: () => number = Date.now,
): Promise<CertificationPrompt | null> {
  const flying = inFlight.get(key);
  if (flying) return flying.value;
  const entry = recent.get(key);
  if (entry) {
    recent.delete(key);
    const at = now();
    if (entry.expiresAt > at) {
      // Servie : remise en fin d'ordre — les plus anciennes restent en tête.
      recent.set(key, entry);
      return entry.value;
    }
    if (entry.reading && at - entry.startedAt < CERTIFICATION_PROMPT_STUCK_READ_MS) {
      // Abandonnée, mais elle pend encore : pas une seconde acquisition en file
      // derrière elle. « Rien », une minute de plus.
      entry.expiresAt = at + CERTIFICATION_PROMPT_TTL_MS;
      recent.set(key, entry);
      return entry.value;
    }
  }
  // Mémoire pleine de lectures en cours : « rien », sans lire — en pleine
  // surcharge, une lecture non partagée par appel ajouterait à la charge.
  if (!makeRoom()) return Promise.resolve(null);

  const slot: Slot = {
    value: Promise.resolve(null),
    expiresAt: Number.POSITIVE_INFINITY,
    settled: null,
    reading: true,
    startedAt: now(),
    timedOut: false,
    forgotten: false,
  };
  const reading = load();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<"TIMEOUT">((resolve) => {
    timer = setTimeout(() => resolve("TIMEOUT"), CERTIFICATION_PROMPT_READ_TIMEOUT_MS);
  });
  const outcomeOf = reading.then(
    (prompt) => ({ ok: true as const, prompt }),
    (error: unknown) => ({ ok: false as const, error }),
  );
  void outcomeOf.then((late) => {
    slot.reading = false;
    // Finie tard mais réussie, après l'abandon : elle sert quand même.
    if (late.ok && slot.timedOut) {
      slot.settled = { prompt: late.prompt };
      slot.value = Promise.resolve(late.prompt);
      slot.expiresAt = now() + CERTIFICATION_PROMPT_TTL_MS;
    }
  });
  const settle = (prompt: CertificationPrompt | null, ttl: number) => {
    slot.settled = { prompt };
    slot.expiresAt = now() + ttl;
    if (inFlight.get(key) === slot) inFlight.delete(key);
    if (!slot.forgotten) recent.set(key, slot);
    return prompt;
  };
  slot.value = Promise.race([outcomeOf, expired]).then((outcome) => {
    clearTimeout(timer);
    if (outcome === "TIMEOUT") {
      logCertificationPromptFailure(now(), "lecture abandonnée après 3 s");
      slot.timedOut = true;
      return settle(null, CERTIFICATION_PROMPT_TTL_MS);
    }
    if (outcome.ok) return settle(outcome.prompt, CERTIFICATION_PROMPT_TTL_MS);
    logCertificationPromptFailure(now(), outcome.error);
    return settle(null, CERTIFICATION_PROMPT_FAILURE_TTL_MS);
  });
  inFlight.set(key, slot);
  return slot.value;
}

/**
 * L'issue déjà connue de `key`, sans rien lire ni attendre ; `undefined` si
 * elle est inconnue, expirée ou en cours de lecture.
 */
export function peekCertificationPrompt(
  key: string,
  now: () => number = Date.now,
): { prompt: CertificationPrompt | null } | undefined {
  const entry = recent.get(key);
  if (!entry?.settled || entry.expiresAt <= now()) return undefined;
  return entry.settled;
}

/**
 * Place pour une lecture de plus : la moins récemment servie des issues
 * connues part — jamais une lecture en cours, qui ne serait plus partagée.
 * `false` : la mémoire n'est faite que de lectures en cours.
 */
function makeRoom(): boolean {
  if (inFlight.size + recent.size < CERTIFICATION_PROMPT_CACHE_MAX) return true;
  const oldest = recent.keys().next();
  if (oldest.done) return false;
  recent.delete(oldest.value);
  return true;
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

/**
 * Oublie les invitations retenues pour ce compte (toutes équipes, rôles,
 * jeux) : un geste qui change la réponse — certification, rattachement
 * Battle.net, « Ne plus voir » — se voit à la lecture suivante, pas une minute
 * plus tard. Une lecture en cours n'est pas interrompue, mais son issue n'est
 * pas retenue.
 */
export function forgetCertificationPromptsOf(userId: number): void {
  const prefix = `${userId}:`;
  for (const key of recent.keys()) if (key.startsWith(prefix)) recent.delete(key);
  for (const [key, slot] of inFlight) {
    if (!key.startsWith(prefix)) continue;
    slot.forgotten = true;
    inFlight.delete(key);
  }
}

/** Vide la mémoire (tests). */
export function forgetCertificationPrompts(): void {
  inFlight.clear();
  recent.clear();
  lastFailureLogAt = Number.NEGATIVE_INFINITY;
  silencedFailures = 0;
}

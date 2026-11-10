import { fail } from "@/lib/server/http";
import { isContentionError } from "@/lib/server/mysql-errors";
import { CONCURRENT_UPDATE_RETRY } from "@/lib/shared/api-error-code";
import { isMatchLiveTrigger, parseOrganisationLink } from "@/lib/shared/live-streams";
import type { CastSettings } from "./cast-settings";
import type { CastTarget } from "./match-launch";

/** Identifiant de match lu dans un segment d'URL : entier strictement positif. */
export function parseMatchIdParam(raw: string): number | null {
  const matchId = Number(raw);
  return Number.isInteger(matchId) && matchId > 0 ? matchId : null;
}

/**
 * Traduit un refus du service de lancement en réponse HTTP, d'après une table
 * fermée : un code absent de la table est une vraie panne (500).
 */
export function launchFailure(
  error: unknown,
  statuses: Readonly<Record<string, number>>,
  fallback: string,
) {
  const message = (error as Error).message;
  const status = statuses[message];
  if (status) return fail(message, status);
  // Interblocage ou contention passagère (`ER_CHECKREAD`, délai de verrou) à
  // chaque rejeu : un conflit « réessaie », pas une panne — même règle que la
  // route d'annulation d'un abandon (`isContentionError`).
  if (isContentionError(error)) {
    return fail(CONCURRENT_UPDATE_RETRY, 409);
  }
  console.error("[match-launch] échec", error);
  return fail(fallback, 500);
}

/** Entier strictement positif (identifiant). */
export function isPositiveId(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

/**
 * Le stream choisi : `{ streamId }` rejoint un stream du match (co-cast),
 * `{ liveUrl }` en ouvre un — **avec le lien de sa chaîne**, un stream sans lien
 * n'apparaissant sur aucune vue (`docs/features/CAST_SETTINGS.md`). Les deux à
 * la fois, aucun des deux, ou un type inattendu, sont refusés.
 */
export function parseCastTarget(body: unknown): CastTarget | null {
  const { streamId, liveUrl } = (typeof body === "object" && body !== null ? body : {}) as {
    streamId?: unknown;
    liveUrl?: unknown;
  };
  if (streamId !== undefined && liveUrl !== undefined) return null;
  if (streamId !== undefined) return isPositiveId(streamId) ? { streamId } : null;
  return typeof liveUrl === "string" ? { liveUrl } : null;
}

/**
 * Un champ **présent** dans le corps, lu et contrôlé ; `undefined` quand il est
 * absent (il n'est alors pas touché), `null` étant une valeur. Rend
 * `INVALID` quand le type ne convient pas : chaque champ se juge seul, et
 * `parseCastSettings` n'a plus qu'à refuser le tout.
 */
const INVALID = Symbol("invalid");

function readField<T>(
  raw: Record<string, unknown>,
  key: string,
  ok: (value: unknown) => value is T,
): T | null | undefined | typeof INVALID {
  if (!(key in raw)) return undefined;
  const value = raw[key];
  if (value === null) return null;
  return ok(value) ? value : INVALID;
}

const isString = (value: unknown): value is string => typeof value === "string";

/**
 * Réglages du cast lus dans un corps de requête (`CastSettings`) : chaque champ
 * **absent** reste absent — la fenêtre n'envoie que ce qu'elle montre, et un
 * champ qu'elle ne montre pas n'a pas à être touché. `null` est une valeur
 * (« plus casté », « le BattleTag de mon compte ») ; un lien `null` est refusé
 * au réglage (`STREAM_URL_REQUIRED`).
 *
 * Rend `null` sur un type inattendu : le refus est `INVALID_CAST_SETTINGS`.
 */
export function parseCastSettings(body: unknown): CastSettings | null {
  const raw = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  const trigger = readField(raw, "trigger", isMatchLiveTrigger);
  const liveUrl = readField(raw, "liveUrl", isString);
  const battletag = readField(raw, "battletag", isString);
  if (trigger === INVALID || liveUrl === INVALID || battletag === INVALID) return null;
  const settings: CastSettings = {};
  if (trigger !== undefined) settings.trigger = trigger;
  if (liveUrl !== undefined) settings.liveUrl = liveUrl;
  if (battletag !== undefined) settings.battletag = battletag;
  return settings;
}

/**
 * Refus que vaut la clé `organisationLink` d'un corps de caster, ou `null`.
 * Un caster ne dit jamais son lien « de l'organisation » (décision du
 * 2026-11-09), seul le staff le fait dans la configuration du direct : `true`
 * est refusé (403 `STAFF_STREAM_FORBIDDEN`), jamais en silence. `false` — sa
 * propre chaîne, ce que vaut tout lien de caster — passe : une fenêtre ouverte
 * avant la mise à jour l'envoie encore. Toute autre valeur (`"true"`, `1`,
 * `null`…) est illisible (400 `INVALID_ORGANISATION_LINK`), comme sur la
 * route de la configuration du direct.
 */
export function castOrganisationLinkRefusal(body: unknown): { code: string; status: number } | null {
  if (typeof body !== "object" || body === null) return null;
  const value = parseOrganisationLink((body as { organisationLink?: unknown }).organisationLink);
  if (value === null) return { code: "INVALID_ORGANISATION_LINK", status: 400 };
  return value ? { code: "STAFF_STREAM_FORBIDDEN", status: 403 } : null;
}

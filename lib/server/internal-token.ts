/**
 * Jeton des appels **du bot vers le site** (`SITE_INTERNAL_TOKEN`).
 *
 * Le sens ordinaire est app → bot (`BOT_INTERNAL_TOKEN`, `bot-integration.ts`).
 * Une seule route va dans l'autre sens, `/message-tournoi`
 * (`docs/features/TOURNAMENT_STAFF_MESSAGE.md`) : elle n'a ni session ni
 * cookie, seul ce jeton l'ouvre. Un jeton distinct de celui du bot — chaque
 * sens a le sien : un secret fuité ne donne que la moitié du canal.
 *
 * Module serveur.
 */
import crypto from "node:crypto";
import type { NextResponse } from "next/server";
import { fail, type ApiError } from "@/lib/server/http";

/** En-tête porté par le bot, le même nom que dans l'autre sens. */
export const INTERNAL_TOKEN_HEADER = "x-internal-token";

/** Le site n'a pas de jeton : la route est fermée, jamais ouverte sans secret. */
export const SITE_INTERNAL_TOKEN_NOT_CONFIGURED = "SITE_INTERNAL_TOKEN_NOT_CONFIGURED";

/** Jeton absent ou faux. */
export const INTERNAL_TOKEN_REFUSED = "UNAUTHORIZED";

/**
 * Comparaison en temps constant, longueur comprise : les deux côtés sont
 * réduits à leur SHA-256 (32 octets) avant `timingSafeEqual`, si bien que la
 * durée ne dit pas non plus combien de caractères le jeton reçu partage avec
 * le vrai, ni sa longueur.
 */
export function internalTokenMatches(given: string, expected: string): boolean {
  const a = crypto.createHash("sha256").update(given, "utf8").digest();
  const b = crypto.createHash("sha256").update(expected, "utf8").digest();
  return crypto.timingSafeEqual(a, b) && given.length === expected.length;
}

/**
 * Refuse un appel qui ne porte pas le jeton du site. Rend la réponse à
 * retourner telle quelle, ou `null` si l'appel peut continuer.
 *
 * - `SITE_INTERNAL_TOKEN` absent ou vide : 503, la route reste fermée ;
 * - en-tête absent ou différent : 401.
 */
export function rejectWithoutSiteInternalToken(req: Request): NextResponse<ApiError> | null {
  const expected = process.env.SITE_INTERNAL_TOKEN?.trim() ?? "";
  if (expected.length === 0) return fail(SITE_INTERNAL_TOKEN_NOT_CONFIGURED, 503);
  const given = req.headers.get(INTERNAL_TOKEN_HEADER) ?? "";
  if (!internalTokenMatches(given, expected)) return fail(INTERNAL_TOKEN_REFUSED, 401);
  return null;
}

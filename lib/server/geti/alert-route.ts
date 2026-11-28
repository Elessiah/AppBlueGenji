/**
 * Ce que partagent les routes `/api/geti/alerts*` — `docs/features/GETI_INFO.md`
 * § Alertes.
 *
 * Module serveur.
 */
import type { RateLimitRule } from "@/lib/server/rate-limit";
import { GETI_ALERT_ERRORS } from "@/lib/shared/geti/alerts";

/** Écritures d'alertes par compte : créer, renommer, mettre en pause, supprimer. */
export const GETI_ALERT_WRITE_RULE: RateLimitRule = {
  name: "geti-alert-write",
  limit: 40,
  windowMs: 10 * 60_000,
};

/** Corps d'une écriture : une catégorie, une recherche (600 caractères au plus gardés), un nom. */
export const GETI_ALERT_BODY_MAX_BYTES = 8 * 1024;

/** Statut HTTP d'un code de refus du service. */
export function getiAlertRefusalStatus(code: string): number {
  if (code === GETI_ALERT_ERRORS.notFound) return 404;
  if (code === GETI_ALERT_ERRORS.limit || code === GETI_ALERT_ERRORS.duplicate) return 409;
  return 400;
}

/** Identifiant d'alerte d'un segment d'adresse : entier positif écrit en chiffres, sinon `null`. */
export function parseGetiAlertId(segment: string): number | null {
  if (!/^[1-9]\d{0,15}$/.test(segment)) return null;
  const id = Number(segment);
  return Number.isSafeInteger(id) ? id : null;
}

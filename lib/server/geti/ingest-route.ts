/**
 * Porte commune des routes `/api/internal/geti/*`, appelées par le bot seul —
 * seconde exception au sens app → bot, après `/message-tournoi`
 * (`docs/features/BOT_INTEGRATION.md`, `docs/features/GETI_INFO.md`).
 *
 * Module serveur.
 */
import type { NextResponse } from "next/server";
import { enforceRateLimit } from "@/lib/server/api-guard";
import { failureReason } from "@/lib/server/failure-reason";
import { fail, ok, type ApiError } from "@/lib/server/http";
import { rejectWithoutSiteInternalToken } from "@/lib/server/internal-token";
import type { RateLimitRule } from "@/lib/server/rate-limit";
import { readJsonObject } from "@/lib/server/request-body";
import { GETI_INGEST_ERRORS } from "@/lib/server/geti/wire";

/**
 * Plafond d'appels du bot, toutes routes GETI confondues : un rattrapage de
 * de la durée de garde (14 jours, 7 pour les scrims) sur six salons tient en quelques centaines de lots, loin
 * dessous ; au-delà, c'est une boucle folle, que le site refuse (429) au lieu
 * d'écrire en base à chaque tour.
 */
export const GETI_INGEST_RULE: RateLimitRule = {
  name: "geti-ingest",
  limit: 1200,
  windowMs: 60_000,
};

/** Un seul appelant : le bot. */
const GETI_INGEST_IDENTITY = "bot";

/** Corps d'un lot d'annonces (vingt messages bruts, encarts compris) ou d'une fenêtre d'identifiants. */
export const GETI_INGEST_BODY_MAX_BYTES = 512 * 1024;

/**
 * Jeton, plafond, lecture bornée du corps, puis `handle` : ce qu'il rend part
 * tel quel (des **nombres** seulement), un code de refus part en 400, une
 * panne (base injoignable, table absente) en 503 — le bot réessaie plus tard.
 */
export async function handleGetiIngest<T extends object>(
  req: Request,
  maxBytes: number,
  handle: (body: Record<string, unknown>) => Promise<T | string>,
): Promise<NextResponse<T | ApiError>> {
  const refused = rejectWithoutSiteInternalToken(req);
  if (refused) return refused;
  const throttled = enforceRateLimit(GETI_INGEST_RULE, GETI_INGEST_IDENTITY);
  if (throttled) return throttled as NextResponse<ApiError>;

  const read = await readJsonObject(req, GETI_INGEST_ERRORS.invalidRequest, maxBytes);
  if ("refusal" in read) return fail(read.refusal, 400);
  try {
    const result = await handle(read.body);
    return typeof result === "string" ? fail(result, 400) : ok(result);
  } catch (error) {
    console.error("[geti] échec d'une route de récupération", failureReason(error));
    return fail(GETI_INGEST_ERRORS.unavailable, 503);
  }
}

/**
 * « Tester mes MP » depuis « Mon profil » (`docs/features/DISCORD_DM_TEST.md`) :
 * demande au bot un message privé de test vers le Discord rattaché du compte
 * connecté, et rend l'issue (`{ outcome }`). Écriture de `/api/` qui fait
 * partir un message privé : provenance vérifiée ici en première instruction
 * (403 `CROSS_SITE_REQUEST`, corps JSON exigé : 415 sinon), sans dépendre du
 * périmètre du middleware. Un refus ne porte qu'un code.
 */
import { getCurrentUser } from "@/lib/server/auth";
import { tooManyRequests } from "@/lib/server/api-guard";
import {
  consumeRateLimit,
  rateLimitIdentity,
  rateLimitWindowOf,
  refundTokenBucket,
  takeTokenBucket,
  type TokenBucketRule,
} from "@/lib/server/rate-limit";
import { rejectCrossSiteRequest } from "@/lib/server/request-origin";
import {
  DISCORD_DM_TEST_ATTEMPT_RULE,
  DISCORD_DM_TEST_GLOBAL_RULE,
  DISCORD_DM_TEST_VOLUME_RULE,
  DM_TEST_GLOBAL_KEY,
  DmTestError,
  reserveDmTestTry,
  sendDiscordDmTest,
} from "@/lib/server/discord-dm-test";
import { failureReason } from "@/lib/server/failure-reason";
import { fail, ok } from "@/lib/server/http";
import {
  DM_TEST_ABORTED,
  DM_TEST_BOT_UNREACHABLE,
  DM_TEST_BUSY,
  DM_TEST_FAILED,
  DM_TEST_NOT_CERTIFIED,
  DM_TEST_NOT_LINKED,
} from "@/lib/shared/discord-dm-test";

/** Statut HTTP de chaque code de refus ; tout autre code : 500. */
const STATUS: Readonly<Record<string, number>> = {
  PROFILE_NOT_FOUND: 404,
  [DM_TEST_NOT_LINKED]: 409,
  [DM_TEST_NOT_CERTIFIED]: 409,
  [DM_TEST_BUSY]: 503,
  [DM_TEST_BOT_UNREACHABLE]: 503,
  [DM_TEST_ABORTED]: 400,
};

export async function POST(req: Request) {
  const crossSite = rejectCrossSiteRequest(req, { requireJson: true });
  if (crossSite) return crossSite;

  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);

  // Tous les appels, refus compris (ceux-ci rendent leur place au plafond par
  // compte, pas à celui-ci). Seau plein, nouveau venu refusé : occupé, pas
  // « trop d'essais ».
  const attemptKey = rateLimitIdentity(user.id);
  const hadAttemptWindow = rateLimitWindowOf(DISCORD_DM_TEST_ATTEMPT_RULE, attemptKey) !== null;
  const attempts = consumeRateLimit(DISCORD_DM_TEST_ATTEMPT_RULE, attemptKey);
  if (!attempts.allowed) {
    return hadAttemptWindow ? tooManyRequests(attempts.retryAfterMs) : fail(DM_TEST_BUSY, 503);
  }

  // Réservée en une instruction, avant tout `await` : deux clics simultanés ne
  // passent pas tous deux sous le plafond.
  const reservation = reserveDmTestTry(user.id);
  if (reservation.refused === "TOO_MANY") return tooManyRequests(reservation.retryAfterMs);
  if (reservation.refused === "BUSY") return fail(DM_TEST_BUSY, 503);
  const refundLog = takeGlobalToken(DISCORD_DM_TEST_GLOBAL_RULE);
  const refundVolume = refundLog ? takeGlobalToken(DISCORD_DM_TEST_VOLUME_RULE) : null;
  if (!refundLog || !refundVolume) {
    refundLog?.();
    reservation.refund();
    return fail(DM_TEST_BUSY, 503);
  }

  try {
    // Remis, même après que la route a cessé d'attendre : aucune ligne au
    // journal du staff, le jeton de ce plafond-là est rendu.
    const outcome = await sendDiscordDmTest(user.id, req.signal, (late) => {
      if (late === "SENT") refundLog();
    });
    if (outcome === "SENT") refundLog();
    return ok({ outcome });
  } catch (error) {
    // Rien n'est parti : places rendues. Sinon (bot injoignable ou trop lent,
    // le message pouvant arriver après coup) elles restent prises : un bot en
    // panne ne se martèle pas.
    if (error instanceof DmTestError && error.nothingSent) {
      reservation.refund();
      refundLog();
      refundVolume();
    }
    return dmTestFailure(error);
  }
}

/** Prend un jeton du seau global `rule` ; rend de quoi le rendre une fois au plus, ou `null` s'il est vide. */
function takeGlobalToken(rule: TokenBucketRule): (() => void) | null {
  if (!takeTokenBucket(rule, DM_TEST_GLOBAL_KEY).allowed) return null;
  let refunded = false;
  return () => {
    if (refunded) return;
    refunded = true;
    refundTokenBucket(rule, DM_TEST_GLOBAL_KEY);
  };
}

/** La réponse d'un test qui n'a pas rendu d'issue : un code seul. */
function dmTestFailure(error: unknown) {
  const code = error instanceof DmTestError ? error.message : DM_TEST_FAILED;
  if (code === DM_TEST_FAILED) {
    const cause = error instanceof DmTestError ? (error.cause ?? error) : error;
    console.error("[profile] POST discord/dm-test failed:", failureReason(cause));
  }
  return fail(code, STATUS[code] ?? 500);
}

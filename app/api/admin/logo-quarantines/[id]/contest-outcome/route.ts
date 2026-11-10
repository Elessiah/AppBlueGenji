import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { recordContestOutcome } from "@/lib/server/logo-quarantine";
import { readJsonBody } from "@/lib/server/request-body";
import { isContestOutcome } from "@/lib/shared/logo-quarantine";
import { can } from "@/lib/shared/permissions";

/**
 * Écrit l'issue de la contestation d'une image modérée (décision D22) :
 * `{ outcome: "UPHELD" | "OVERTURNED" }`. Sur un avatar supprimé, l'issue pose
 * ou lève tout de suite le blocage de son empreinte (D18) ; sur une image
 * masquée, elle décide de la suppression à venir. Rend `blocked`, l'état de
 * blocage de l'image après le geste (`null` : sans objet), et `hashUnknown`
 * quand l'empreinte d'un avatar supprimé n'a pas été gardée.
 */
export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  if (!can(user, "moderation")) return fail("FORBIDDEN", 403);

  const { id } = await context.params;
  const quarantineId = Number(id);
  if (!Number.isSafeInteger(quarantineId) || quarantineId <= 0) return fail("QUARANTINE_NOT_FOUND", 404);

  const body = (await readJsonBody(req).catch(() => null)) as { outcome?: unknown } | null;
  const outcome = body?.outcome;
  if (!isContestOutcome(outcome)) return fail("INVALID_CONTEST_OUTCOME", 400);

  try {
    const { blocked, hashUnknown } = await recordContestOutcome(quarantineId, outcome, {
      userId: user.id,
      pseudo: user.pseudo,
    });
    return ok({ success: true, blocked, hashUnknown });
  } catch (error) {
    const message = (error as Error).message;
    if (message === "QUARANTINE_NOT_FOUND") return fail(message, 404);
    if (message === "QUARANTINE_CLOSED") return fail(message, 409);
    console.error("[moderation] issue de la contestation non écrite", error);
    return fail("CONTEST_OUTCOME_FAILED", 500);
  }
}

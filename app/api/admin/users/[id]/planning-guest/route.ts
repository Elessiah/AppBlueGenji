import { getCurrentUser } from "@/lib/server/auth";
import { failureReason, unexpectedFailureCode } from "@/lib/server/failure-reason";
import { fail, ok } from "@/lib/server/http";
import { readJsonBodyOrFallback } from "@/lib/server/request-body";
import { publishPlanningGuestChange, setPlanningGuest, type PlanningGuestSaveResult } from "@/lib/server/users/planning-guest";
import { can } from "@/lib/shared/permissions";

/** Hors du `try` de l'écriture, validée : une levée du journal ne rend pas 500 après coup. */
function publishAfterCommit(actor: { id: number; pseudo: string }, targetId: number, saved: PlanningGuestSaveResult): void {
  try {
    publishPlanningGuestChange(actor, targetId, saved);
  } catch (error) {
    console.error(`[planning-guest] journal du staff non publié : ${failureReason(error)}`);
  }
}

/**
 * Pose ou retire le drapeau « invité » d'un compte (`docs/features/CAST_PLANNING.md`
 * § Invités) : caster ou prod qui garde ses droits de diffusion mais sort du
 * planning. Corps : `{ guest: boolean }`.
 *
 * Réservé à la permission `roles` (le geste vit avec l'attribution des rôles) ;
 * jamais sur son propre compte (`CANNOT_MODIFY_SELF`) : ce n'est pas un réglage
 * du titulaire. Poser le drapeau quitte, par le désistement ordinaire, les
 * attributions à venir du compte et efface ses disponibilités à venir.
 *
 * @returns `200 { guest, changed, withdrawn, failed }`, ou `401`
 *   (`UNAUTHORIZED`), `403` (`FORBIDDEN`), `400` (`INVALID_ID` /
 *   `INVALID_PAYLOAD` / `CANNOT_MODIFY_SELF`), `404` (`USER_NOT_FOUND`), `409`
 *   (`PLANNING_GUEST_ADMIN` : un administrateur garde le planning ; `PLANNING_GUEST_NOT_STAFF` : ni
 *   caster ni prod) ; `403` aussi quand l'auteur a perdu l'administration avant l'écriture. Reposer
 *   `guest: true` rejoue la sortie (reprise d'une sortie incomplète).
 */
export async function PUT(req: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  if (!can(user, "roles")) return fail("FORBIDDEN", 403);

  const { id } = await context.params;
  const targetId = Number(id);
  if (!Number.isInteger(targetId) || targetId <= 0) return fail("INVALID_ID", 400);
  if (targetId === user.id) return fail("CANNOT_MODIFY_SELF", 400);

  const read = await readJsonBodyOrFallback(req, null);
  if ("refusal" in read) return read.refusal;
  const guest = (read.body as { guest?: unknown } | null)?.guest;
  if (typeof guest !== "boolean") return fail("INVALID_PAYLOAD", 400);

  let saved: PlanningGuestSaveResult;
  try {
    saved = await setPlanningGuest(targetId, guest, user.id);
  } catch (error) {
    const code = (error as Error)?.message;
    if (code === "USER_NOT_FOUND") return fail("USER_NOT_FOUND", 404);
    // Administration retirée par un autre entre la lecture de la session et l'écriture : refusé comme tel.
    if (code === "NOT_ADMIN") return fail("FORBIDDEN", 403);
    if (code === "PLANNING_GUEST_ADMIN" || code === "PLANNING_GUEST_NOT_STAFF") return fail(code, 409);
    return fail(unexpectedFailureCode(error, "PLANNING_GUEST_UPDATE_FAILED", "[planning-guest] enregistrement impossible"), 500);
  }
  publishAfterCommit({ id: user.id, pseudo: user.pseudo }, targetId, saved);
  return ok({
    guest: saved.guest,
    changed: saved.changed,
    withdrawn: saved.release?.withdrawn ?? 0,
    failed: saved.release?.failed ?? 0,
  });
}

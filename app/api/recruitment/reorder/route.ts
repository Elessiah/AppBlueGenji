import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { reorderRecruitmentAds } from "@/lib/server/recruitment-service";
import { validateReorderIds } from "@/lib/shared/reorder";
import { can } from "@/lib/shared/permissions";

export async function PUT(req: Request) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  if (!can(user, "recruitment")) return fail("FORBIDDEN", 403);

  let body: { ids?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return fail("INVALID_BODY", 400);
  }

  const validation = validateReorderIds(body.ids);
  if (!validation.ok) return fail(validation.error, 400);

  try {
    await reorderRecruitmentAds(validation.ids);
    return ok({});
  } catch (e) {
    const msg = (e as Error).message;
    // La saisie est bien formée : c'est l'état des annonces (leurs statuts) qui
    // interdit cet ordre — typiquement un statut changé depuis un autre onglet.
    return fail(msg || "RECRUITMENT_REORDER_FAILED", msg === "RECRUITMENT_ORDER_MIXES_PRIORITIES" ? 409 : 400);
  }
}

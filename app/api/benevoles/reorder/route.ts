import { getCurrentUser } from "@/lib/server/auth";
import { can } from "@/lib/shared/permissions";
import { fail, ok } from "@/lib/server/http";
import { reorderBenevoleCategories } from "@/lib/server/benevoles-service";
import { validateCategoryReorder } from "@/lib/shared/benevoles";

/** Réordonne les catégories de bénévoles (admin uniquement). */
export async function PUT(req: Request) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  if (!can(user, "showcase")) return fail("FORBIDDEN", 403);

  let body: { categories?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return fail("INVALID_BODY", 400);
  }

  const validation = validateCategoryReorder(body.categories);
  if (!validation.ok) return fail(validation.error, 400);

  try {
    await reorderBenevoleCategories(validation.categories);
    return ok({});
  } catch (e) {
    return fail((e as Error).message || "BENEVOLE_REORDER_FAILED", 400);
  }
}

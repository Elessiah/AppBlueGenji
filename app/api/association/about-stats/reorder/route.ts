import { getCurrentUser } from "@/lib/server/auth";
import { can } from "@/lib/shared/permissions";
import { fail, ok } from "@/lib/server/http";
import { reorderAboutStats } from "@/lib/server/about-stats-service";
import { validateReorderIds } from "@/lib/shared/reorder";

export async function PUT(req: Request) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  if (!can(user, "showcase")) return fail("FORBIDDEN", 403);

  let body: { ids?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return fail("INVALID_BODY", 400);
  }

  const validation = validateReorderIds(body.ids);
  if (!validation.ok) return fail(validation.error, 400);

  try {
    await reorderAboutStats(validation.ids);
    return ok({});
  } catch (e) {
    return fail((e as Error).message || "ABOUT_STAT_REORDER_FAILED", 400);
  }
}

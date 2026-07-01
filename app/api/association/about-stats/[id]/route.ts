import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { deleteAboutStat, updateAboutStat } from "@/lib/server/about-stats-service";

function parseId(raw: string): number | null {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) return null;
  return id;
}

export async function PUT(req: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  if (!user.isAdmin) return fail("FORBIDDEN", 403);

  const { id: rawId } = await context.params;
  const id = parseId(rawId);
  if (id === null) return fail("INVALID_ID", 400);

  let body: { value?: unknown; label?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return fail("INVALID_BODY", 400);
  }

  try {
    const stat = await updateAboutStat(id, {
      value: typeof body.value === "string" ? body.value : "",
      label: typeof body.label === "string" ? body.label : "",
    });
    return ok({ stat });
  } catch (e) {
    const msg = (e as Error).message;
    return fail(msg || "ABOUT_STAT_UPDATE_FAILED", msg === "ABOUT_STAT_NOT_FOUND" ? 404 : 400);
  }
}

export async function DELETE(_req: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  if (!user.isAdmin) return fail("FORBIDDEN", 403);

  const { id: rawId } = await context.params;
  const id = parseId(rawId);
  if (id === null) return fail("INVALID_ID", 400);

  try {
    await deleteAboutStat(id);
    return ok({});
  } catch (e) {
    const msg = (e as Error).message;
    return fail(msg || "ABOUT_STAT_DELETE_FAILED", msg === "ABOUT_STAT_NOT_FOUND" ? 404 : 400);
  }
}

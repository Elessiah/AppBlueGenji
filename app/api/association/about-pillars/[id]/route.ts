import { getCurrentUser } from "@/lib/server/auth";
import { can } from "@/lib/shared/permissions";
import { fail, ok } from "@/lib/server/http";
import { deleteAboutPillar, updateAboutPillar } from "@/lib/server/about-pillars-service";

function parseId(raw: string): number | null {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) return null;
  return id;
}

export async function PUT(req: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  if (!can(user, "showcase")) return fail("FORBIDDEN", 403);

  const { id: rawId } = await context.params;
  const id = parseId(rawId);
  if (id === null) return fail("INVALID_ID", 400);

  let body: { title?: unknown; text?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return fail("INVALID_BODY", 400);
  }

  try {
    const pillar = await updateAboutPillar(id, {
      title: typeof body.title === "string" ? body.title : "",
      text: typeof body.text === "string" ? body.text : "",
    });
    return ok({ pillar });
  } catch (e) {
    const msg = (e as Error).message;
    return fail(msg || "ABOUT_PILLAR_UPDATE_FAILED", msg === "ABOUT_PILLAR_NOT_FOUND" ? 404 : 400);
  }
}

export async function DELETE(_req: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  if (!can(user, "showcase")) return fail("FORBIDDEN", 403);

  const { id: rawId } = await context.params;
  const id = parseId(rawId);
  if (id === null) return fail("INVALID_ID", 400);

  try {
    await deleteAboutPillar(id);
    return ok({});
  } catch (e) {
    const msg = (e as Error).message;
    return fail(msg || "ABOUT_PILLAR_DELETE_FAILED", msg === "ABOUT_PILLAR_NOT_FOUND" ? 404 : 400);
  }
}

import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { deleteBureauMember, updateBureauMember } from "@/lib/server/bureau-service";

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

  let body: { name?: unknown; role?: unknown; initials?: unknown; color?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return fail("INVALID_BODY", 400);
  }

  try {
    const member = await updateBureauMember(id, {
      name: typeof body.name === "string" ? body.name : "",
      role: typeof body.role === "string" ? body.role : "",
      initials: typeof body.initials === "string" ? body.initials : undefined,
      color: typeof body.color === "string" ? body.color : undefined,
    });
    return ok({ member });
  } catch (e) {
    const msg = (e as Error).message;
    return fail(msg || "BUREAU_UPDATE_FAILED", msg === "BUREAU_MEMBER_NOT_FOUND" ? 404 : 400);
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
    await deleteBureauMember(id);
    return ok({});
  } catch (e) {
    const msg = (e as Error).message;
    return fail(msg || "BUREAU_DELETE_FAILED", msg === "BUREAU_MEMBER_NOT_FOUND" ? 404 : 400);
  }
}

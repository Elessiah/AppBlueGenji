import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { deleteSponsor, updateSponsor } from "@/lib/server/sponsors-service";

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

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return fail("INVALID_BODY", 400);
  }

  try {
    const sponsor = await updateSponsor(id, {
      name: typeof body.name === "string" ? body.name : "",
      tier: typeof body.tier === "string" ? body.tier : undefined,
      logoUrl: typeof body.logoUrl === "string" ? body.logoUrl : null,
      websiteUrl: typeof body.websiteUrl === "string" ? body.websiteUrl : null,
      description: typeof body.description === "string" ? body.description : null,
      active: typeof body.active === "boolean" ? body.active : undefined,
    });
    return ok({ sponsor });
  } catch (e) {
    const msg = (e as Error).message;
    return fail(msg || "SPONSOR_UPDATE_FAILED", msg === "SPONSOR_NOT_FOUND" ? 404 : 400);
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
    await deleteSponsor(id);
    return ok({});
  } catch (e) {
    const msg = (e as Error).message;
    return fail(msg || "SPONSOR_DELETE_FAILED", msg === "SPONSOR_NOT_FOUND" ? 404 : 400);
  }
}

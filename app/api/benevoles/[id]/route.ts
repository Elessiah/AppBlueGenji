import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { deleteBenevole, updateBenevole } from "@/lib/server/benevoles-service";

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

  let body: {
    firstName?: unknown;
    pseudo?: unknown;
    lastName?: unknown;
    category?: unknown;
    photoUrl?: unknown;
    joinedAt?: unknown;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return fail("INVALID_BODY", 400);
  }

  try {
    const benevole = await updateBenevole(id, {
      firstName: typeof body.firstName === "string" ? body.firstName : "",
      pseudo: typeof body.pseudo === "string" ? body.pseudo : null,
      lastName: typeof body.lastName === "string" ? body.lastName : "",
      category: typeof body.category === "string" ? body.category : "",
      photoUrl: typeof body.photoUrl === "string" ? body.photoUrl : null,
      joinedAt: typeof body.joinedAt === "string" ? body.joinedAt : "",
    });
    return ok({ benevole });
  } catch (e) {
    const msg = (e as Error).message;
    return fail(msg || "BENEVOLE_UPDATE_FAILED", msg === "BENEVOLE_NOT_FOUND" ? 404 : 400);
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
    await deleteBenevole(id);
    return ok({});
  } catch (e) {
    const msg = (e as Error).message;
    return fail(msg || "BENEVOLE_DELETE_FAILED", msg === "BENEVOLE_NOT_FOUND" ? 404 : 400);
  }
}

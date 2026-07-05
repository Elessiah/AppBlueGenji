import { getCurrentUser } from "@/lib/server/auth";
import { can } from "@/lib/shared/permissions";
import { fail, ok } from "@/lib/server/http";
import {
  deleteBenevole,
  getBenevolePhotoUrl,
  updateBenevole,
} from "@/lib/server/benevoles-service";
import { deleteStoredImage } from "@/lib/server/image-upload";
import { toDiskUploadPath } from "@/lib/shared/uploads";

function parseId(raw: string): number | null {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) return null;
  return id;
}

/**
 * Supprime l'ancienne photo si elle était hébergée localement et a changé.
 * Best-effort : un échec de suppression ne doit pas faire échouer une requête
 * dont la mutation en base a déjà réussi.
 */
async function cleanupReplacedPhoto(previous: string | null, next: string | null) {
  if (!previous || previous === next) return;
  const diskPath = toDiskUploadPath(previous);
  if (!diskPath) return;
  try {
    await deleteStoredImage(diskPath);
  } catch (err) {
    console.error("Failed to delete replaced benevole photo:", err);
  }
}

export async function PUT(req: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  if (!can(user, "showcase")) return fail("FORBIDDEN", 403);

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
    const previousPhoto = await getBenevolePhotoUrl(id);
    const benevole = await updateBenevole(id, {
      firstName: typeof body.firstName === "string" ? body.firstName : "",
      pseudo: typeof body.pseudo === "string" ? body.pseudo : null,
      lastName: typeof body.lastName === "string" ? body.lastName : "",
      category: typeof body.category === "string" ? body.category : "",
      photoUrl: typeof body.photoUrl === "string" ? body.photoUrl : null,
      joinedAt: typeof body.joinedAt === "string" ? body.joinedAt : "",
    });
    await cleanupReplacedPhoto(previousPhoto, benevole.photoUrl);
    return ok({ benevole });
  } catch (e) {
    const msg = (e as Error).message;
    return fail(msg || "BENEVOLE_UPDATE_FAILED", msg === "BENEVOLE_NOT_FOUND" ? 404 : 400);
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
    const previousPhoto = await getBenevolePhotoUrl(id);
    await deleteBenevole(id);
    await cleanupReplacedPhoto(previousPhoto, null);
    return ok({});
  } catch (e) {
    const msg = (e as Error).message;
    return fail(msg || "BENEVOLE_DELETE_FAILED", msg === "BENEVOLE_NOT_FOUND" ? 404 : 400);
  }
}

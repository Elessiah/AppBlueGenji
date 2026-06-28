import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { deleteStoredImage } from "@/lib/server/image-upload";
import { deleteSponsor, getSponsorLogoUrl, updateSponsor } from "@/lib/server/sponsors-service";

const UPLOADED_LOGO_PREFIX = "/uploads/sponsors/";

/**
 * Supprime l'ancien fichier logo s'il était hébergé localement et a changé.
 * Best-effort : une erreur de suppression (fichier verrouillé, permissions) ne
 * doit pas faire échouer une requête dont la mutation en base a déjà réussi.
 */
async function cleanupReplacedLogo(previous: string | null, next: string | null) {
  if (previous && previous !== next && previous.startsWith(UPLOADED_LOGO_PREFIX)) {
    try {
      await deleteStoredImage(previous);
    } catch (err) {
      console.error("Failed to delete replaced sponsor logo:", err);
    }
  }
}

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
    const previousLogo = await getSponsorLogoUrl(id);
    const sponsor = await updateSponsor(id, {
      name: typeof body.name === "string" ? body.name : "",
      tier: typeof body.tier === "string" ? body.tier : undefined,
      logoUrl: typeof body.logoUrl === "string" ? body.logoUrl : null,
      websiteUrl: typeof body.websiteUrl === "string" ? body.websiteUrl : null,
      description: typeof body.description === "string" ? body.description : null,
      active: typeof body.active === "boolean" ? body.active : undefined,
    });
    await cleanupReplacedLogo(previousLogo, sponsor.logoUrl);
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
    const previousLogo = await getSponsorLogoUrl(id);
    await deleteSponsor(id);
    await cleanupReplacedLogo(previousLogo, null);
    return ok({});
  } catch (e) {
    const msg = (e as Error).message;
    return fail(msg || "SPONSOR_DELETE_FAILED", msg === "SPONSOR_NOT_FOUND" ? 404 : 400);
  }
}

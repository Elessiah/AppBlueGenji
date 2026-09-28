import { getCurrentUser } from "@/lib/server/auth";
import { can } from "@/lib/shared/permissions";
import { fail, ok } from "@/lib/server/http";
import { deleteSponsor, getSponsorImageUrls, updateSponsor } from "@/lib/server/sponsors-service";
import { deleteUnreferencedUpload } from "@/lib/server/stored-upload-cleanup";
import { readJsonBody } from "@/lib/server/request-body";

/**
 * Supprime l'ancien fichier (logo ou bandeau) s'il a changé, qu'il vit dans le
 * dossier des partenaires et que plus rien ne le désigne — une adresse d'un
 * autre dossier, collée comme logo, ne fait jamais effacer l'image d'autrui.
 * Au mieux : la mutation en base a déjà réussi.
 */
async function cleanupReplacedImage(previous: string | null, next: string | null) {
  if (!previous || previous === next) return;
  await deleteUnreferencedUpload(previous, "sponsors");
}

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

  let body: Record<string, unknown>;
  try {
    body = (await readJsonBody(req)) as Record<string, unknown>;
  } catch {
    return fail("INVALID_BODY", 400);
  }

  try {
    const previous = await getSponsorImageUrls(id);
    const sponsor = await updateSponsor(id, {
      name: typeof body.name === "string" ? body.name : "",
      tier: typeof body.tier === "string" ? body.tier : undefined,
      logoUrl: typeof body.logoUrl === "string" ? body.logoUrl : null,
      bannerUrl: typeof body.bannerUrl === "string" ? body.bannerUrl : null,
      websiteUrl: typeof body.websiteUrl === "string" ? body.websiteUrl : null,
      description: typeof body.description === "string" ? body.description : null,
      active: typeof body.active === "boolean" ? body.active : undefined,
    });
    await cleanupReplacedImage(previous.logoUrl, sponsor.logoUrl);
    await cleanupReplacedImage(previous.bannerUrl, sponsor.bannerUrl);
    return ok({ sponsor });
  } catch (e) {
    const msg = (e as Error).message;
    return fail(msg || "SPONSOR_UPDATE_FAILED", msg === "SPONSOR_NOT_FOUND" ? 404 : 400);
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
    const previous = await getSponsorImageUrls(id);
    await deleteSponsor(id);
    await cleanupReplacedImage(previous.logoUrl, null);
    await cleanupReplacedImage(previous.bannerUrl, null);
    return ok({});
  } catch (e) {
    const msg = (e as Error).message;
    return fail(msg || "SPONSOR_DELETE_FAILED", msg === "SPONSOR_NOT_FOUND" ? 404 : 400);
  }
}

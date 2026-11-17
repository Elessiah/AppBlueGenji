import { getCurrentUser } from "@/lib/server/auth";
import { can } from "@/lib/shared/permissions";
import { serviceErrorCode, failureReason } from "@/lib/server/failure-reason";
import { fail, ok } from "@/lib/server/http";
import { createSponsor, findSponsor, listSponsors } from "@/lib/server/sponsors-service";
import { readJsonObject } from "@/lib/server/request-body";
import { runOnceForBody } from "@/lib/server/idempotency";
import { keptStoredUpload } from "@/lib/server/kept-stored-upload";

export async function GET() {
  try {
    const sponsors = await listSponsors();
    return Response.json({ sponsors });
  } catch (error) {
    console.error("Failed to fetch sponsors:", failureReason(error));
    return Response.json({ sponsors: [] }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  if (!can(user, "showcase")) return fail("FORBIDDEN", 403);

  // Corps illisible, trop lourd (413), non JSON (415), ou JSON qui n'est pas un objet.
  const read = await readJsonObject(req, "INVALID_BODY");
  if ("refusal" in read) return fail(read.refusal, 400);
  const body = read.body;

  try {
    // Un renvoi du même ajout (réponse perdue) rend le partenaire déjà créé au
    // lieu d'en créer un second (`lib/server/idempotency.ts`) — relu d'abord :
    // supprimé entre-temps, il est recréé plutôt que rendu.
    // Un logo ou un bandeau du dossier dont le fichier n'existe plus est laissé :
    // un ajout rejoué après la suppression du partenaire (qui a effacé ses
    // images) le recréerait sur une image absente (`SPONSOR_MANAGEMENT.md`).
    const sponsor = await runOnceForBody(`sponsor-create:${user.id}`, body, async () => {
      const [logoUrl, bannerUrl] = await Promise.all([
        keptStoredUpload(body.logoUrl, "sponsors"),
        keptStoredUpload(body.bannerUrl, "sponsors"),
      ]);
      return createSponsor({
        name: typeof body.name === "string" ? body.name : "",
        tier: typeof body.tier === "string" ? body.tier : undefined,
        logoUrl,
        bannerUrl,
        websiteUrl: typeof body.websiteUrl === "string" ? body.websiteUrl : null,
        description: typeof body.description === "string" ? body.description : null,
        descriptionEn: typeof body.descriptionEn === "string" ? body.descriptionEn : null,
        active: typeof body.active === "boolean" ? body.active : undefined,
      });
    }, { fresh: (created) => findSponsor(created.id) },
    );
    return ok({ sponsor }, 201);
  } catch (e) {
    return fail(serviceErrorCode(e, "SPONSOR_CREATE_FAILED"), 400);
  }
}

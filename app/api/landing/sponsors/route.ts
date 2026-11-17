import { getCurrentUser } from "@/lib/server/auth";
import { can } from "@/lib/shared/permissions";
import { serviceErrorCode, failureReason } from "@/lib/server/failure-reason";
import { fail, ok } from "@/lib/server/http";
import { createSponsor, findSponsor, listSponsors } from "@/lib/server/sponsors-service";
import { readJsonBody } from "@/lib/server/request-body";
import { runOnceForBody } from "@/lib/server/idempotency";

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

  let json: unknown;
  try {
    json = await readJsonBody(req);
  } catch {
    return fail("INVALID_BODY", 400);
  }
  // `null`, un tableau ou un nombre sont du JSON valide, mais pas un partenaire.
  if (typeof json !== "object" || json === null || Array.isArray(json)) return fail("INVALID_BODY", 400);
  const body = json as Record<string, unknown>;

  try {
    // Un renvoi du même ajout (réponse perdue) rend le partenaire déjà créé au
    // lieu d'en créer un second (`lib/server/idempotency.ts`) — relu d'abord :
    // supprimé entre-temps, il est recréé plutôt que rendu.
    const sponsor = await runOnceForBody(`sponsor-create:${user.id}`, body, () =>
      createSponsor({
        name: typeof body.name === "string" ? body.name : "",
        tier: typeof body.tier === "string" ? body.tier : undefined,
        logoUrl: typeof body.logoUrl === "string" ? body.logoUrl : null,
        bannerUrl: typeof body.bannerUrl === "string" ? body.bannerUrl : null,
        websiteUrl: typeof body.websiteUrl === "string" ? body.websiteUrl : null,
        description: typeof body.description === "string" ? body.description : null,
        descriptionEn: typeof body.descriptionEn === "string" ? body.descriptionEn : null,
        active: typeof body.active === "boolean" ? body.active : undefined,
      }),
      { fresh: (created) => findSponsor(created.id) },
    );
    return ok({ sponsor }, 201);
  } catch (e) {
    return fail(serviceErrorCode(e, "SPONSOR_CREATE_FAILED"), 400);
  }
}

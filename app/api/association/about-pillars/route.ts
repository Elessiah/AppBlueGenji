import { getCurrentUser } from "@/lib/server/auth";
import { can } from "@/lib/shared/permissions";
import { serviceErrorCode } from "@/lib/server/failure-reason";
import { fail, ok } from "@/lib/server/http";
import { createAboutPillar, findAboutPillar, listAboutPillars } from "@/lib/server/about-pillars-service";
import { readJsonObject } from "@/lib/server/request-body";
import { runOnceForBody } from "@/lib/server/idempotency";

export async function GET() {
  const pillars = await listAboutPillars();
  return ok({ pillars });
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  if (!can(user, "showcase")) return fail("FORBIDDEN", 403);

  // Corps illisible, trop lourd (413), non JSON (415), ou JSON qui n'est pas un objet.
  const read = await readJsonObject(req, "INVALID_BODY");
  if ("refusal" in read) return fail(read.refusal, 400);
  const body = read.body as { title?: unknown; text?: unknown; titleEn?: unknown; textEn?: unknown; requestKey?: unknown };

  try {
    // Un renvoi du même ajout (réponse perdue) rend la carte déjà créée au
    // lieu d'en créer une seconde (`lib/server/idempotency.ts`) — relue d'abord :
    // supprimée entre-temps, elle est recréée plutôt que rendue.
    const pillar = await runOnceForBody(`about-pillar-create:${user.id}`, body, () =>
      createAboutPillar({
        title: typeof body.title === "string" ? body.title : "",
        text: typeof body.text === "string" ? body.text : "",
        titleEn: typeof body.titleEn === "string" ? body.titleEn : null,
        textEn: typeof body.textEn === "string" ? body.textEn : null,
      }),
      { fresh: (created) => findAboutPillar(created.id) },
    );
    return ok({ pillar }, 201);
  } catch (e) {
    return fail(serviceErrorCode(e, "ABOUT_PILLAR_CREATE_FAILED"), 400);
  }
}

import { getCurrentUser } from "@/lib/server/auth";
import { serviceErrorCode, failureReason } from "@/lib/server/failure-reason";
import { fail, ok } from "@/lib/server/http";
import { createRecruitmentAd, findRecruitmentAd, listRecruitmentAds } from "@/lib/server/recruitment-service";
import { can } from "@/lib/shared/permissions";
import { recruitmentAdInputFromBody } from "@/lib/shared/recruitment";
import { readJsonObject } from "@/lib/server/request-body";
import { runOnceForBody } from "@/lib/server/idempotency";

export async function GET() {
  const user = await getCurrentUser().catch(() => null);
  try {
    // Les gestionnaires du recrutement voient aussi les annonces inactives (brouillons).
    const ads = await listRecruitmentAds(can(user, "recruitment"));
    return Response.json({ ads });
  } catch (error) {
    console.error("Failed to fetch recruitment ads:", failureReason(error));
    return Response.json({ ads: [] }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  if (!can(user, "recruitment")) return fail("FORBIDDEN", 403);

  // Corps illisible, trop lourd (413), non JSON (415), ou JSON qui n'est pas un objet.
  const read = await readJsonObject(req, "INVALID_BODY");
  if ("refusal" in read) return fail(read.refusal, 400);
  const body = read.body;

  try {
    // Un renvoi de la même annonce (réponse perdue) rend celle déjà publiée au
    // lieu d'en publier une seconde (`lib/server/idempotency.ts`) — relue
    // d'abord : supprimée entre-temps, elle est recréée plutôt que rendue.
    const ad = await runOnceForBody(`recruitment-create:${user.id}`, body, () =>
      createRecruitmentAd(recruitmentAdInputFromBody(body)),
      { fresh: (created) => findRecruitmentAd(created.id) },
    );
    return ok({ ad }, 201);
  } catch (e) {
    return fail(serviceErrorCode(e, "RECRUITMENT_CREATE_FAILED"), 400);
  }
}

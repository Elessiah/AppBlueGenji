import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { createRecruitmentAd, listRecruitmentAds } from "@/lib/server/recruitment-service";
import { can } from "@/lib/shared/permissions";

export async function GET() {
  const user = await getCurrentUser().catch(() => null);
  try {
    // Les gestionnaires du recrutement voient aussi les annonces inactives (brouillons).
    const ads = await listRecruitmentAds(can(user, "recruitment"));
    return Response.json({ ads });
  } catch (error) {
    console.error("Failed to fetch recruitment ads:", error);
    return Response.json({ ads: [] }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  if (!can(user, "recruitment")) return fail("FORBIDDEN", 403);

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return fail("INVALID_BODY", 400);
  }

  try {
    const ad = await createRecruitmentAd({
      title: typeof body.title === "string" ? body.title : "",
      teamName: typeof body.teamName === "string" ? body.teamName : null,
      domain: typeof body.domain === "string" ? body.domain : undefined,
      roles: typeof body.roles === "string" ? body.roles : null,
      body: typeof body.body === "string" ? body.body : null,
      contactUrl: typeof body.contactUrl === "string" ? body.contactUrl : null,
      highlight: typeof body.highlight === "string" ? body.highlight : undefined,
      active: typeof body.active === "boolean" ? body.active : undefined,
    });
    return ok({ ad }, 201);
  } catch (e) {
    return fail((e as Error).message || "RECRUITMENT_CREATE_FAILED", 400);
  }
}

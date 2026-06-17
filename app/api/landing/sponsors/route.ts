import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { createSponsor, listSponsors } from "@/lib/server/sponsors-service";

export async function GET() {
  try {
    const sponsors = await listSponsors();
    return Response.json({ sponsors });
  } catch (error) {
    console.error("Failed to fetch sponsors:", error);
    return Response.json({ sponsors: [] }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  if (!user.isAdmin) return fail("FORBIDDEN", 403);

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return fail("INVALID_BODY", 400);
  }

  try {
    const sponsor = await createSponsor({
      name: typeof body.name === "string" ? body.name : "",
      tier: typeof body.tier === "string" ? body.tier : undefined,
      logoUrl: typeof body.logoUrl === "string" ? body.logoUrl : null,
      websiteUrl: typeof body.websiteUrl === "string" ? body.websiteUrl : null,
      description: typeof body.description === "string" ? body.description : null,
      active: typeof body.active === "boolean" ? body.active : undefined,
    });
    return ok({ sponsor }, 201);
  } catch (e) {
    return fail((e as Error).message || "SPONSOR_CREATE_FAILED", 400);
  }
}

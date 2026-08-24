import { getCurrentUser } from "@/lib/server/auth";
import { can } from "@/lib/shared/permissions";
import { fail, ok } from "@/lib/server/http";
import { createAboutPillar, listAboutPillars } from "@/lib/server/about-pillars-service";

export async function GET() {
  const pillars = await listAboutPillars();
  return ok({ pillars });
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  if (!can(user, "showcase")) return fail("FORBIDDEN", 403);

  let body: { title?: unknown; text?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return fail("INVALID_BODY", 400);
  }

  try {
    const pillar = await createAboutPillar({
      title: typeof body.title === "string" ? body.title : "",
      text: typeof body.text === "string" ? body.text : "",
    });
    return ok({ pillar }, 201);
  } catch (e) {
    return fail((e as Error).message || "ABOUT_PILLAR_CREATE_FAILED", 400);
  }
}

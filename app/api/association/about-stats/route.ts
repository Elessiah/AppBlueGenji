import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { createAboutStat, listAboutStats } from "@/lib/server/about-stats-service";

export async function GET() {
  const stats = await listAboutStats();
  return ok({ stats });
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  if (!user.isAdmin) return fail("FORBIDDEN", 403);

  let body: { value?: unknown; label?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return fail("INVALID_BODY", 400);
  }

  try {
    const stat = await createAboutStat({
      value: typeof body.value === "string" ? body.value : "",
      label: typeof body.label === "string" ? body.label : "",
    });
    return ok({ stat }, 201);
  } catch (e) {
    return fail((e as Error).message || "ABOUT_STAT_CREATE_FAILED", 400);
  }
}

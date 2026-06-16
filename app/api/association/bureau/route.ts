import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { createBureauMember, listBureauMembers } from "@/lib/server/bureau-service";

export async function GET() {
  const members = await listBureauMembers();
  return ok({ members });
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  if (!user.isAdmin) return fail("FORBIDDEN", 403);

  let body: { name?: unknown; role?: unknown; initials?: unknown; color?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return fail("INVALID_BODY", 400);
  }

  try {
    const member = await createBureauMember({
      name: typeof body.name === "string" ? body.name : "",
      role: typeof body.role === "string" ? body.role : "",
      initials: typeof body.initials === "string" ? body.initials : undefined,
      color: typeof body.color === "string" ? body.color : undefined,
    });
    return ok({ member }, 201);
  } catch (e) {
    return fail((e as Error).message || "BUREAU_CREATE_FAILED", 400);
  }
}

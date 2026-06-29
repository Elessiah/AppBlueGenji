import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { getPressEmail, setPressEmail } from "@/lib/server/contact-service";

export async function GET() {
  const email = await getPressEmail();
  return ok({ email });
}

export async function PUT(req: Request) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  if (!user.isAdmin) return fail("FORBIDDEN", 403);

  let body: { email?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return fail("INVALID_BODY", 400);
  }

  try {
    const email = await setPressEmail(body.email);
    return ok({ email });
  } catch (e) {
    return fail((e as Error).message || "CONTACT_UPDATE_FAILED", 400);
  }
}

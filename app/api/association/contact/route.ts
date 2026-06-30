import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { getContactInfo, setContactInfo } from "@/lib/server/contact-service";

export async function GET() {
  const contact = await getContactInfo();
  return ok({ contact });
}

export async function PUT(req: Request) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  if (!user.isAdmin) return fail("FORBIDDEN", 403);

  let body: { email?: unknown; discordTag?: unknown; discordUrl?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return fail("INVALID_BODY", 400);
  }

  try {
    const contact = await setContactInfo({
      email: typeof body.email === "string" ? body.email : "",
      discordTag: typeof body.discordTag === "string" ? body.discordTag : "",
      discordUrl: typeof body.discordUrl === "string" ? body.discordUrl : "",
    });
    return ok({ contact });
  } catch (e) {
    return fail((e as Error).message || "CONTACT_UPDATE_FAILED", 400);
  }
}

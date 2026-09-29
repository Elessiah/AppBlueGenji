import { getCurrentUser } from "@/lib/server/auth";
import { can } from "@/lib/shared/permissions";
import { fail, ok } from "@/lib/server/http";
import { getContactInfo, setContactInfo } from "@/lib/server/contact-service";
import { readJsonBody } from "@/lib/server/request-body";
import { toPublicContact } from "@/lib/shared/contact";

/**
 * Lecture publique : le courriel part **encodé**, comme dans le pied de page
 * (`lib/shared/obfuscated-contact.ts`) — une route anonyme qui le rendrait en
 * clair serait le chemin le plus court pour un robot.
 */
export async function GET() {
  const contact = await getContactInfo();
  return ok({ contact: toPublicContact(contact) });
}

export async function PUT(req: Request) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  if (!can(user, "showcase")) return fail("FORBIDDEN", 403);

  let body: { email?: unknown; discordTag?: unknown; discordUrl?: unknown };
  try {
    body = (await readJsonBody(req)) as typeof body;
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

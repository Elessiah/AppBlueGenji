import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { getSiteCopy, resetSiteCopy, setSiteCopy } from "@/lib/server/site-copy-service";
import { can } from "@/lib/shared/permissions";

/** Textes du site vitrine (défauts compris). Lecture publique. */
export async function GET() {
  return ok({ copy: await getSiteCopy() });
}

/** Édite un texte. Réservé à la permission `showcase`. */
export async function PATCH(req: Request) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  if (!can(user, "showcase")) return fail("FORBIDDEN", 403);

  let body: { key?: unknown; value?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return fail("INVALID_BODY", 400);
  }

  if (typeof body.key !== "string") return fail("UNKNOWN_COPY_KEY", 400);

  try {
    const copy = await setSiteCopy(body.key, body.value);
    return ok({ copy });
  } catch (e) {
    const message = (e as Error).message;
    const status = message === "UNKNOWN_COPY_KEY" ? 404 : 400;
    return fail(message || "SITE_COPY_UPDATE_FAILED", status);
  }
}

/** Remet un texte à sa valeur d'origine. Réservé à la permission `showcase`. */
export async function DELETE(req: Request) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  if (!can(user, "showcase")) return fail("FORBIDDEN", 403);

  const key = new URL(req.url).searchParams.get("key");
  if (!key) return fail("UNKNOWN_COPY_KEY", 400);

  try {
    const copy = await resetSiteCopy(key);
    return ok({ copy });
  } catch (e) {
    const message = (e as Error).message;
    return fail(message || "SITE_COPY_RESET_FAILED", message === "UNKNOWN_COPY_KEY" ? 404 : 400);
  }
}

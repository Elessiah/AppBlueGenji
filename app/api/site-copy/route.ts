import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { getSiteCopyBundle, resetSiteCopy, setSiteCopy } from "@/lib/server/site-copy-service";
import { can } from "@/lib/shared/permissions";
import { readJsonBody } from "@/lib/server/request-body";

/**
 * Textes du site vitrine (défauts compris), en français (`copy`) et en anglais
 * (`copyEn`). Lecture publique : ce sont les textes de la page.
 */
export async function GET() {
  const bundle = await getSiteCopyBundle();
  return ok({ copy: bundle.fr, copyEn: bundle.en });
}

/**
 * Édite un texte, **dans les deux langues** : `{ key, value, valueEn }`.
 * Sans anglais, refus `COPY_EN_EMPTY` (D9). Réservé à la permission `showcase`.
 */
export async function PATCH(req: Request) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  if (!can(user, "showcase")) return fail("FORBIDDEN", 403);

  let body: { key?: unknown; value?: unknown; valueEn?: unknown };
  try {
    body = (await readJsonBody(req)) as typeof body;
  } catch {
    return fail("INVALID_BODY", 400);
  }

  if (typeof body.key !== "string") return fail("UNKNOWN_COPY_KEY", 400);

  try {
    const copy = await setSiteCopy(body.key, body.value, body.valueEn);
    return ok({ copy });
  } catch (e) {
    const message = (e as Error).message;
    const status = message === "UNKNOWN_COPY_KEY" ? 404 : 400;
    return fail(message || "SITE_COPY_UPDATE_FAILED", status);
  }
}

/** Remet un texte à sa valeur d'origine, dans les deux langues. Réservé à la permission `showcase`. */
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

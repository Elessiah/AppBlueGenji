import { getCurrentUser } from "@/lib/server/auth";
import { can } from "@/lib/shared/permissions";
import { failureReason, isErrorCode } from "@/lib/server/failure-reason";
import { fail, ok } from "@/lib/server/http";
import { createAboutStat, listAboutStats } from "@/lib/server/about-stats-service";
import { bodyReadRefusal, readJsonBody } from "@/lib/server/request-body";

export async function GET() {
  const stats = await listAboutStats();
  return ok({ stats });
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  if (!can(user, "showcase")) return fail("FORBIDDEN", 403);

  let json: unknown;
  try {
    json = await readJsonBody(req);
  } catch (error) {
    return fail(bodyReadRefusal(error) ?? "INVALID_BODY", 400);
  }
  // `null`, un tableau ou un nombre sont du JSON valide, mais pas une carte :
  // refusés comme le PUT (`readBody`), sans quoi `body.value` lèverait.
  if (typeof json !== "object" || json === null || Array.isArray(json)) return fail("INVALID_BODY", 400);
  const body = json as { value?: unknown; valueEn?: unknown; label?: unknown; labelEn?: unknown };

  try {
    const stat = await createAboutStat({
      value: typeof body.value === "string" ? body.value : "",
      // Un type qui n'est pas un texte est refusé par la validation (`VALUE_EN_INVALID`).
      valueEn: (body.valueEn ?? null) as string | null,
      label: typeof body.label === "string" ? body.label : "",
      labelEn: typeof body.labelEn === "string" ? body.labelEn : null,
    });
    return ok({ stat }, 201);
  } catch (e) {
    // Un refus de validation (`LABEL_TOO_LONG`) passe tel quel ; le texte d'un
    // pilote (hôte, port, valeur en double) jamais : code de repli, journalisé.
    const msg = e instanceof Error ? e.message : "";
    if (isErrorCode(msg)) return fail(msg, 400);
    console.error(`[admin] ABOUT_STAT_CREATE_FAILED : ${failureReason(e)}`);
    return fail("ABOUT_STAT_CREATE_FAILED", 400);
  }
}

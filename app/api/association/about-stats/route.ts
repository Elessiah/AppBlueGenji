import { getCurrentUser } from "@/lib/server/auth";
import { can } from "@/lib/shared/permissions";
import { serviceErrorCode } from "@/lib/server/failure-reason";
import { fail, ok } from "@/lib/server/http";
import { createAboutStat, findAboutStat, listAboutStats } from "@/lib/server/about-stats-service";
import { bodyReadRefusal, readJsonBody } from "@/lib/server/request-body";
import { runOnceForBody } from "@/lib/server/idempotency";

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
  const body = json as { value?: unknown; valueEn?: unknown; label?: unknown; labelEn?: unknown; requestKey?: unknown };

  try {
    // Un renvoi du même ajout (réponse perdue) rend la carte déjà créée au
    // lieu d'en créer une seconde (`lib/server/idempotency.ts`) — relue d'abord :
    // supprimée entre-temps, elle est recréée plutôt que rendue.
    const stat = await runOnceForBody(`about-stat-create:${user.id}`, body, () =>
      createAboutStat({
        value: typeof body.value === "string" ? body.value : "",
        // Un type qui n'est pas un texte est refusé par la validation (`VALUE_EN_INVALID`).
        valueEn: body.valueEn ?? null,
        label: typeof body.label === "string" ? body.label : "",
        labelEn: typeof body.labelEn === "string" ? body.labelEn : null,
      }),
      { fresh: (created) => findAboutStat(created.id) },
    );
    return ok({ stat }, 201);
  } catch (e) {
    return fail(serviceErrorCode(e, "ABOUT_STAT_CREATE_FAILED"), 400);
  }
}

import { getCurrentUser } from "@/lib/server/auth";
import { can } from "@/lib/shared/permissions";
import { serviceErrorCode } from "@/lib/server/failure-reason";
import { fail, ok } from "@/lib/server/http";
import { createBenevole, findBenevole, listBenevoles } from "@/lib/server/benevoles-service";
import { readJsonBody } from "@/lib/server/request-body";
import { runOnceForBody } from "@/lib/server/idempotency";

export async function GET() {
  const benevoles = await listBenevoles();
  return ok({ benevoles });
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  if (!can(user, "showcase")) return fail("FORBIDDEN", 403);

  let json: unknown;
  try {
    json = await readJsonBody(req);
  } catch {
    return fail("INVALID_BODY", 400);
  }
  // `null`, un tableau ou un nombre sont du JSON valide, mais pas un bénévole.
  if (typeof json !== "object" || json === null || Array.isArray(json)) return fail("INVALID_BODY", 400);
  const body = json as {
    firstName?: unknown;
    pseudo?: unknown;
    lastName?: unknown;
    category?: unknown;
    categoryEn?: unknown;
    photoUrl?: unknown;
    joinedAt?: unknown;
    requestKey?: unknown;
  };

  try {
    // Un renvoi du même ajout (réponse perdue) rend le bénévole déjà créé au
    // lieu d'en créer un second (`lib/server/idempotency.ts`) — relu d'abord :
    // supprimé entre-temps, il est recréé plutôt que rendu.
    const benevole = await runOnceForBody(`benevole-create:${user.id}`, body, () =>
      createBenevole({
        firstName: typeof body.firstName === "string" ? body.firstName : "",
        pseudo: typeof body.pseudo === "string" ? body.pseudo : null,
        lastName: typeof body.lastName === "string" ? body.lastName : "",
        category: typeof body.category === "string" ? body.category : "",
        categoryEn: typeof body.categoryEn === "string" ? body.categoryEn : null,
        photoUrl: typeof body.photoUrl === "string" ? body.photoUrl : null,
        joinedAt: typeof body.joinedAt === "string" ? body.joinedAt : "",
      }),
      { fresh: (created) => findBenevole(created.id) },
    );
    return ok({ benevole }, 201);
  } catch (e) {
    return fail(serviceErrorCode(e, "BENEVOLE_CREATE_FAILED"), 400);
  }
}

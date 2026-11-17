import { getCurrentUser } from "@/lib/server/auth";
import { can } from "@/lib/shared/permissions";
import { serviceErrorCode } from "@/lib/server/failure-reason";
import { fail, ok } from "@/lib/server/http";
import { createBureauMember, findBureauMember, listBureauMembers } from "@/lib/server/bureau-service";
import { readJsonObject } from "@/lib/server/request-body";
import { runOnceForBody } from "@/lib/server/idempotency";

export async function GET() {
  const members = await listBureauMembers();
  return ok({ members });
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  if (!can(user, "showcase")) return fail("FORBIDDEN", 403);

  // Corps illisible, trop lourd (413), non JSON (415), ou JSON qui n'est pas un objet.
  const read = await readJsonObject(req, "INVALID_BODY");
  if ("refusal" in read) return fail(read.refusal, 400);
  const body = read.body as {
    name?: unknown;
    role?: unknown;
    roleEn?: unknown;
    initials?: unknown;
    color?: unknown;
    requestKey?: unknown;
  };

  try {
    // Un renvoi du même ajout (réponse perdue) rend le membre déjà créé au
    // lieu d'en créer un second (`lib/server/idempotency.ts`) — relu d'abord :
    // supprimé entre-temps, il est recréé plutôt que rendu.
    const member = await runOnceForBody(`bureau-create:${user.id}`, body, () =>
      createBureauMember({
        name: typeof body.name === "string" ? body.name : "",
        role: typeof body.role === "string" ? body.role : "",
        roleEn: typeof body.roleEn === "string" ? body.roleEn : null,
        initials: typeof body.initials === "string" ? body.initials : undefined,
        color: typeof body.color === "string" ? body.color : undefined,
      }),
      { fresh: (created) => findBureauMember(created.id) },
    );
    return ok({ member }, 201);
  } catch (e) {
    return fail(serviceErrorCode(e, "BUREAU_CREATE_FAILED"), 400);
  }
}

import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { createBenevole, listBenevoles } from "@/lib/server/benevoles-service";

export async function GET() {
  const benevoles = await listBenevoles();
  return ok({ benevoles });
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  if (!user.isAdmin) return fail("FORBIDDEN", 403);

  let body: {
    firstName?: unknown;
    pseudo?: unknown;
    lastName?: unknown;
    category?: unknown;
    photoUrl?: unknown;
    joinedAt?: unknown;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return fail("INVALID_BODY", 400);
  }

  try {
    const benevole = await createBenevole({
      firstName: typeof body.firstName === "string" ? body.firstName : "",
      pseudo: typeof body.pseudo === "string" ? body.pseudo : null,
      lastName: typeof body.lastName === "string" ? body.lastName : "",
      category: typeof body.category === "string" ? body.category : "",
      photoUrl: typeof body.photoUrl === "string" ? body.photoUrl : null,
      joinedAt: typeof body.joinedAt === "string" ? body.joinedAt : "",
    });
    return ok({ benevole }, 201);
  } catch (e) {
    return fail((e as Error).message || "BENEVOLE_CREATE_FAILED", 400);
  }
}

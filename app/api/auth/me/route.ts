import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { publicSessionUser } from "@/lib/server/public-session-user";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return fail("UNAUTHORIZED", 401);
  }

  // Forme publique explicite, jamais `AuthUser` entier (`public-session-user.ts`).
  return ok({ user: publicSessionUser(user) });
}

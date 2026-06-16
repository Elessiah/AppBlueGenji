import { clearSession, getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { anonymizeOwnAccount, getFullProfile, updateOwnProfile } from "@/lib/server/users-service";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);

  const profile = await getFullProfile(user.id, user.id);
  if (!profile) return fail("PROFILE_NOT_FOUND", 404);

  return ok(profile);
}

export async function PATCH(req: Request) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);

  try {
    const body = (await req.json()) as {
      pseudo?: string;
      overwatchBattletag?: string | null;
      marvelRivalsTag?: string | null;
      discordPseudo?: string | null;
      isAdult?: boolean | null;
      visibility?: {
        avatar?: boolean;
        pseudo?: boolean;
        overwatch?: boolean;
        marvel?: boolean;
        major?: boolean;
      };
    };

    await updateOwnProfile(user.id, body);
    const profile = await getFullProfile(user.id, user.id);
    return ok(profile);
  } catch (error) {
    const message = (error as Error).message;
    if (message === "PSEUDO_ALREADY_USED") return fail(message, 409);
    return fail(message || "PROFILE_UPDATE_FAILED", 400);
  }
}

export async function DELETE() {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);

  try {
    await anonymizeOwnAccount(user.id);
    await clearSession();
    return ok({ deleted: true });
  } catch (error) {
    return fail((error as Error).message || "ACCOUNT_DELETE_FAILED", 400);
  }
}

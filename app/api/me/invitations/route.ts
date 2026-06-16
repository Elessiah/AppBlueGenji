import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { listUserInvitations } from "@/lib/server/teams-service";

/** Invitations (INVITE) en attente adressées au joueur connecté. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);

  const invitations = await listUserInvitations(user.id);
  return ok({ invitations });
}

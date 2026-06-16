import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { respondToInvitation } from "@/lib/server/teams-service";

/** Accepte ou refuse une invitation/demande en attente. Body: { accept: boolean }. */
export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);

  const { id } = await context.params;
  const invitationId = Number(id);
  if (!Number.isInteger(invitationId) || invitationId <= 0) return fail("INVALID_INVITATION_ID", 400);

  try {
    const body = (await req.json()) as { accept?: boolean };
    await respondToInvitation(user.id, invitationId, Boolean(body.accept));
    return ok({ ok: true });
  } catch (error) {
    const message = (error as Error).message;
    if (message === "FORBIDDEN") return fail(message, 403);
    if (message === "INVITATION_NOT_FOUND") return fail(message, 404);
    if (message === "INVITATION_NOT_PENDING") return fail(message, 409);
    if (message === "USER_ALREADY_IN_TEAM") return fail(message, 409);
    return fail(message || "INVITATION_RESPOND_FAILED", 400);
  }
}

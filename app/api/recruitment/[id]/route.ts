import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { deleteRecruitmentAd, updateRecruitmentAd } from "@/lib/server/recruitment-service";
import { can } from "@/lib/shared/permissions";

function parseId(raw: string): number | null {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) return null;
  return id;
}

export async function PUT(req: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  if (!can(user, "recruitment")) return fail("FORBIDDEN", 403);

  const { id: rawId } = await context.params;
  const id = parseId(rawId);
  if (id === null) return fail("INVALID_ID", 400);

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return fail("INVALID_BODY", 400);
  }

  try {
    const ad = await updateRecruitmentAd(id, {
      title: typeof body.title === "string" ? body.title : "",
      teamName: typeof body.teamName === "string" ? body.teamName : null,
      domain: typeof body.domain === "string" ? body.domain : undefined,
      roles: typeof body.roles === "string" ? body.roles : null,
      body: typeof body.body === "string" ? body.body : null,
      contactUrl: typeof body.contactUrl === "string" ? body.contactUrl : null,
      contactDiscord: typeof body.contactDiscord === "string" ? body.contactDiscord : null,
      contactDiscordId: typeof body.contactDiscordId === "string" ? body.contactDiscordId : null,
      contactPreferred: typeof body.contactPreferred === "string" ? body.contactPreferred : undefined,
      highlight: typeof body.highlight === "string" ? body.highlight : undefined,
      active: typeof body.active === "boolean" ? body.active : undefined,
    });
    return ok({ ad });
  } catch (e) {
    const msg = (e as Error).message;
    return fail(msg || "RECRUITMENT_UPDATE_FAILED", msg === "RECRUITMENT_NOT_FOUND" ? 404 : 400);
  }
}

export async function DELETE(_req: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  if (!can(user, "recruitment")) return fail("FORBIDDEN", 403);

  const { id: rawId } = await context.params;
  const id = parseId(rawId);
  if (id === null) return fail("INVALID_ID", 400);

  try {
    await deleteRecruitmentAd(id);
    return ok({});
  } catch (e) {
    const msg = (e as Error).message;
    return fail(msg || "RECRUITMENT_DELETE_FAILED", msg === "RECRUITMENT_NOT_FOUND" ? 404 : 400);
  }
}

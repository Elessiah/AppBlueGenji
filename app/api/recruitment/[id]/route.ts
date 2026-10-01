import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { deleteRecruitmentAd, updateRecruitmentAd } from "@/lib/server/recruitment-service";
import { can } from "@/lib/shared/permissions";
import { recruitmentAdInputFromBody } from "@/lib/shared/recruitment";
import { readJsonBody } from "@/lib/server/request-body";

function parseId(raw: string): number | null {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) return null;
  return id;
}

function recruitmentErrorStatus(message: string): number {
  return message === "RECRUITMENT_NOT_FOUND" ? 404 : 400;
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
    body = (await readJsonBody(req)) as Record<string, unknown>;
  } catch {
    return fail("INVALID_BODY", 400);
  }

  try {
    const ad = await updateRecruitmentAd(id, recruitmentAdInputFromBody(body));
    return ok({ ad });
  } catch (e) {
    const msg = (e as Error).message;
    return fail(msg || "RECRUITMENT_UPDATE_FAILED", recruitmentErrorStatus(msg));
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
    return fail(msg || "RECRUITMENT_DELETE_FAILED", recruitmentErrorStatus(msg));
  }
}

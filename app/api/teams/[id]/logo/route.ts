import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { deleteStoredImage, processAndStoreImage } from "@/lib/server/image-upload";
import { canManageTeam, getTeamLogoUrl, updateTeamLogo } from "@/lib/server/teams-service";

export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);

  const { id } = await context.params;
  const teamId = Number(id);
  if (!Number.isInteger(teamId) || teamId <= 0) {
    return fail("INVALID_TEAM_ID", 400);
  }

  if (!(await canManageTeam(teamId, user.id))) {
    return fail("FORBIDDEN", 403);
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail("FILE_MISSING", 400);
  }

  const file = form.get("file");
  if (!(file instanceof File)) return fail("FILE_MISSING", 400);

  try {
    const currentLogo = await getTeamLogoUrl(teamId);
    const newPath = await processAndStoreImage(file, "team-logo", teamId);
    await updateTeamLogo(user.id, teamId, newPath);
    if (currentLogo?.startsWith("/uploads/teams/")) {
      await deleteStoredImage(currentLogo);
    }
    return ok({ logoUrl: newPath });
  } catch (error) {
    const message = (error as Error).message;
    if (message === "FORBIDDEN") return fail(message, 403);
    return fail(message || "LOGO_UPLOAD_FAILED", 400);
  }
}

export async function DELETE(_: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);

  const { id } = await context.params;
  const teamId = Number(id);
  if (!Number.isInteger(teamId) || teamId <= 0) {
    return fail("INVALID_TEAM_ID", 400);
  }

  try {
    const currentLogo = await getTeamLogoUrl(teamId);
    await updateTeamLogo(user.id, teamId, null);
    if (currentLogo?.startsWith("/uploads/teams/")) {
      await deleteStoredImage(currentLogo);
    }
    return ok({ logoUrl: null });
  } catch (error) {
    const message = (error as Error).message;
    if (message === "FORBIDDEN") return fail(message, 403);
    return fail(message || "LOGO_DELETE_FAILED", 400);
  }
}

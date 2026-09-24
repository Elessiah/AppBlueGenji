import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { deleteStoredImage, processAndStoreImage } from "@/lib/server/image-upload";
import { canManageTeam, getTeamLogoUrl, isGhostTeam, updateTeamLogo } from "@/lib/server/teams-service";
import { toDiskUploadPath, toServedUploadUrl } from "@/lib/shared/uploads";
import { can } from "@/lib/shared/permissions";
import {
  LOGO_RIGHTS_FIELD,
  LOGO_RIGHTS_NOT_CERTIFIED,
  TERMS_ACCEPTANCE_REQUIRED,
} from "@/lib/shared/terms-of-use";

export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);

  const { id } = await context.params;
  const teamId = Number(id);
  if (!Number.isInteger(teamId) || teamId <= 0) {
    return fail("INVALID_TEAM_ID", 400);
  }

  const managesGhostTeams = can(user, "tournaments");
  if (!(await canManageTeam(teamId, user.id)) && !(managesGhostTeams && (await isGhostTeam(teamId)))) {
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

  // La garantie des droits passe **avant** le traitement du fichier : c'est une
  // saisie du formulaire, rien à convertir pour la refuser. Les conditions
  // d'utilisation, elles, sont jugées par `updateTeamLogo` (règle unique des
  // gestes de gestion) ; un refus y efface le fichier tout juste écrit.
  if (form.get(LOGO_RIGHTS_FIELD) !== "1") return fail(LOGO_RIGHTS_NOT_CERTIFIED, 400);

  try {
    const currentLogo = await getTeamLogoUrl(teamId);
    const diskPath = await processAndStoreImage(file, "team-logo", teamId);
    const servedUrl = toServedUploadUrl(diskPath);
    try {
      await updateTeamLogo(user.id, teamId, servedUrl, managesGhostTeams);
    } catch (error) {
      // Refusé entre-temps (rôle retiré, course) : le fichier neuf ne désigne
      // rien, il part.
      try {
        await deleteStoredImage(diskPath);
      } catch {
        // Résidu sur le disque, que rien ne désigne : le refus d'origine prime.
      }
      throw error;
    }
    await deleteStoredImage(toDiskUploadPath(currentLogo));
    return ok({ logoUrl: servedUrl });
  } catch (error) {
    const message = (error as Error).message;
    if (message === "FORBIDDEN") return fail(message, 403);
    if (message === TERMS_ACCEPTANCE_REQUIRED) return fail(message, 409);
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
    await updateTeamLogo(user.id, teamId, null, can(user, "tournaments"));
    await deleteStoredImage(toDiskUploadPath(currentLogo));
    return ok({ logoUrl: null });
  } catch (error) {
    const message = (error as Error).message;
    if (message === "FORBIDDEN") return fail(message, 403);
    if (message === TERMS_ACCEPTANCE_REQUIRED) return fail(message, 409);
    return fail(message || "LOGO_DELETE_FAILED", 400);
  }
}

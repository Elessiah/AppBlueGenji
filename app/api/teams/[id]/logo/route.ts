import { getCurrentUser } from "@/lib/server/auth";
import { reserveTeamIdentityWrite } from "@/lib/server/api-guard";
import { fail, ok } from "@/lib/server/http";
import { deleteUnreferencedUpload } from "@/lib/server/stored-upload-cleanup";
import { TEAM_LOGO_ERROR_STATUS, isRightsRefusal, parseTeamId, teamErrorStatus } from "@/lib/server/team-route-errors";
import { deleteStoredImage, processAndStoreImage } from "@/lib/server/image-upload";
import { canManageTeam, isGhostTeam } from "@/lib/server/teams/access";
import { updateTeamLogo } from "@/lib/server/teams/identity";
import { toServedUploadUrl } from "@/lib/shared/uploads";
import { can } from "@/lib/shared/permissions";
import { IMAGE_CROP_FIELD, IMAGE_CROP_INVALID, parseImageCropField } from "@/lib/shared/image-crop";
import {
  LOGO_RIGHTS_FIELD,
  LOGO_RIGHTS_NOT_CERTIFIED,
} from "@/lib/shared/terms-of-use";
import { readImageUploadForm } from "@/lib/server/request-body";

type LogoWriter = { userId: number; teamId: number; managesGhostTeams: boolean };

/**
 * Écrit le fichier puis le désigne sous verrou. Rend la place du plafond sur
 * tout échec, sauf un refus de droits (un compte sans qualité reste plafonné) ;
 * un fichier neuf que l'écriture n'a pas adopté part.
 */
async function storeAndApplyLogo(
  writer: LogoWriter,
  file: File,
  crop: Parameters<typeof processAndStoreImage>[3],
  refund: () => void,
): Promise<{ servedUrl: string; previousLogoUrl: string | null }> {
  let diskPath: string;
  try {
    diskPath = await processAndStoreImage(file, "team-logo", writer.teamId, crop);
  } catch (error) {
    refund();
    throw error;
  }
  const servedUrl = toServedUploadUrl(diskPath);
  try {
    // L'ancien logo est celui que l'écriture a remplacé, relu sous son verrou.
    const { previousLogoUrl } = await updateTeamLogo(writer.userId, writer.teamId, servedUrl, writer.managesGhostTeams);
    return { servedUrl, previousLogoUrl };
  } catch (error) {
    if (!isRightsRefusal(error)) refund();
    // Refusé entre-temps (rôle retiré, course) : le fichier neuf ne désigne
    // rien, il part.
    try {
      await deleteStoredImage(diskPath);
    } catch {
      // Résidu sur le disque, que rien ne désigne : le refus d'origine prime.
    }
    throw error;
  }
}

export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);

  const { id } = await context.params;
  const teamId = parseTeamId(id);
  if (teamId === null) return fail("INVALID_TEAM_ID", 400);

  const managesGhostTeams = can(user, "tournaments");
  if (!(await canManageTeam(teamId, user.id)) && !(managesGhostTeams && (await isGhostTeam(teamId)))) {
    return fail("FORBIDDEN", 403);
  }
  // Un dépôt refusé avant l'écriture (formulaire, fichier, garantie, droit
  // retiré) rend sa place : seule une écriture faite compte.
  const reservation = reserveTeamIdentityWrite(user.id, managesGhostTeams);
  if (reservation.refused) return reservation.refused;
  const refused = (response: Response) => {
    reservation.refund();
    return response;
  };

  const form = await readImageUploadForm(req, user.id);
  if (form instanceof Response) return refused(form);

  const file = form.get("file");
  if (!(file instanceof File)) return refused(fail("FILE_MISSING", 400));

  // La zone choisie dans la modale de recadrage ; absente, le gabarit seul.
  const crop = parseImageCropField(form.get(IMAGE_CROP_FIELD));
  if (!crop.ok) return refused(fail(IMAGE_CROP_INVALID, 400));

  // La garantie des droits passe **avant** le traitement du fichier : c'est une
  // saisie du formulaire, rien à convertir pour la refuser. Les conditions
  // d'utilisation, elles, sont jugées par `updateTeamLogo` (règle unique des
  // gestes de gestion) ; un refus y efface le fichier tout juste écrit.
  if (form.get(LOGO_RIGHTS_FIELD) !== "1") return refused(fail(LOGO_RIGHTS_NOT_CERTIFIED, 400));

  try {
    const { servedUrl, previousLogoUrl } = await storeAndApplyLogo(
      { userId: user.id, teamId, managesGhostTeams },
      file,
      crop.crop,
      reservation.refund,
    );
    // L'ancien fichier part s'il vit dans `teams/` et que plus aucune ligne ne
    // le désigne — un logo partagé par une autre équipe lui reste (même règle
    // que la dissolution).
    await deleteUnreferencedUpload(previousLogoUrl, "teams");
    return ok({ logoUrl: servedUrl });
  } catch (error) {
    const message = (error as Error).message;
    return fail(message || "LOGO_UPLOAD_FAILED", teamErrorStatus(TEAM_LOGO_ERROR_STATUS, message));
  }
}

export async function DELETE(_: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);

  const { id } = await context.params;
  const teamId = parseTeamId(id);
  if (teamId === null) return fail("INVALID_TEAM_ID", 400);

  const managesGhostTeams = can(user, "tournaments");
  const reservation = reserveTeamIdentityWrite(user.id, managesGhostTeams);
  if (reservation.refused) return reservation.refused;

  try {
    let previousLogoUrl: string | null;
    try {
      ({ previousLogoUrl } = await updateTeamLogo(user.id, teamId, null, managesGhostTeams));
    } catch (error) {
      // Refusé : rien n'a été écrit. Un refus de droit garde sa place (un
      // compte sans qualité qui boucle reste plafonné).
      if (!isRightsRefusal(error)) reservation.refund();
      throw error;
    }
    await deleteUnreferencedUpload(previousLogoUrl, "teams");
    return ok({ logoUrl: null });
  } catch (error) {
    const message = (error as Error).message;
    return fail(message || "LOGO_DELETE_FAILED", teamErrorStatus(TEAM_LOGO_ERROR_STATUS, message));
  }
}

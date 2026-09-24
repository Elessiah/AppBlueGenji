import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { deleteStoredImage } from "@/lib/server/image-upload";
import { notifyTeamLogoRemoved } from "@/lib/server/logo-quarantine";
import { publishStaffAction } from "@/lib/server/staff-audit";
import { removeTeamLogoAsModerator } from "@/lib/server/teams-service";
import { can } from "@/lib/shared/permissions";
import { toDiskUploadPath } from "@/lib/shared/uploads";

/**
 * Retire le logo d'une équipe, pour la modération (permission `moderation`) :
 * le geste qui éteint la responsabilité d'hébergeur de l'association après un
 * signalement de droit d'auteur. L'équipe garde tout le reste ; sa carte
 * retombe sur l'initiale de son nom.
 *
 * L'équipe en est prévenue en message privé (`notifyTeamLogoRemoved`). Depuis
 * le panneau des signalements, la suppression passe plutôt par
 * `/api/admin/reports/[id]/logo-removal`, qui la rattache au signalement.
 *
 * Le fichier est effacé du disque, donc du miroir des images au passage
 * suivant de sa synchronisation (`rclone sync`, suppression définitive).
 */
export async function DELETE(_: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  if (!can(user, "moderation")) return fail("FORBIDDEN", 403);

  const { id } = await context.params;
  const teamId = Number(id);
  if (!Number.isSafeInteger(teamId) || teamId <= 0) return fail("INVALID_TEAM_ID", 400);

  try {
    const { teamName, removedLogoUrl, sharedWithOtherTeams } = await removeTeamLogoAsModerator(teamId);
    // Désigné par d'autres équipes, le fichier reste : il est aussi le leur.
    const toDelete = sharedWithOtherTeams ? null : toDiskUploadPath(removedLogoUrl);
    await deleteStoredImage(toDelete).catch((error) => {
      // La ligne ne désigne plus le fichier : il n'est plus servi par le site.
      // Un disque récalcitrant laisse un résidu, que l'on signale sans défaire
      // un retrait déjà effectif.
      console.error("[moderation] fichier du logo non effacé", error);
    });
    publishStaffAction(`🧹 Logo de l'équipe « ${teamName} » retiré par le staff (modération).`, {
      id: user.id,
      pseudo: user.pseudo,
    });
    // L'équipe apprend la décision et le moyen d'y répondre (DSA art. 17) ;
    // hors de tout signalement, le message renvoie vers l'association.
    notifyTeamLogoRemoved(teamId, teamName, null);
    return ok({ success: true });
  } catch (error) {
    const message = (error as Error).message;
    if (message === "TEAM_NOT_FOUND") return fail(message, 404);
    if (message === "TEAM_HAS_NO_LOGO") return fail(message, 409);
    console.error("[moderation] retrait du logo impossible", error);
    return fail("TEAM_LOGO_REMOVE_FAILED", 500);
  }
}

import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { deleteStoredImage } from "@/lib/server/image-upload";
import { notifyUserAvatarRemoved } from "@/lib/server/logo-quarantine";
import { publishStaffAction } from "@/lib/server/staff-audit";
import { removeUserAvatarAsModerator } from "@/lib/server/users-service";
import { can } from "@/lib/shared/permissions";
import { toDiskUploadPath } from "@/lib/shared/uploads";

/**
 * Retire l'avatar d'un joueur, pour la modération (permission `moderation`) —
 * même geste que `DELETE /api/admin/teams/[id]/logo`, appliqué à un compte : le
 * geste qui éteint la responsabilité d'hébergeur de l'association après un
 * signalement de droit d'auteur. Le joueur garde tout le reste ; sa fiche
 * retombe sur la pastille à initiale.
 *
 * Le joueur en est prévenu en message privé (`notifyUserAvatarRemoved`).
 * Depuis le panneau des signalements, la suppression passe plutôt par
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
  const userId = Number(id);
  if (!Number.isSafeInteger(userId) || userId <= 0) return fail("INVALID_USER_ID", 400);

  try {
    const { pseudo, removedAvatarUrl } = await removeUserAvatarAsModerator(userId);
    await deleteStoredImage(toDiskUploadPath(removedAvatarUrl)).catch((error) => {
      // La ligne ne désigne plus le fichier : il n'est plus servi par le site.
      // Un disque récalcitrant laisse un résidu, que l'on signale sans défaire
      // un retrait déjà effectif.
      console.error("[moderation] fichier de l'avatar non effacé", error);
    });
    publishStaffAction(`🧹 Avatar de ${pseudo} retiré par le staff (modération).`, {
      id: user.id,
      pseudo: user.pseudo,
    });
    // Le joueur apprend la décision et le moyen d'y répondre (DSA art. 17) ;
    // hors de tout signalement, le message renvoie vers l'association.
    notifyUserAvatarRemoved(userId, null);
    return ok({ success: true });
  } catch (error) {
    const message = (error as Error).message;
    if (message === "USER_NOT_FOUND") return fail(message, 404);
    if (message === "USER_HAS_NO_AVATAR") return fail(message, 409);
    console.error("[moderation] retrait de l'avatar impossible", error);
    return fail("USER_AVATAR_REMOVE_FAILED", 500);
  }
}

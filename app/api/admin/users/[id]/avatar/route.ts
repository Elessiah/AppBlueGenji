import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { notifyUserAvatarRemoved, removeModeratedAvatarFile } from "@/lib/server/logo-quarantine";
import { readJsonBodyOrFallback } from "@/lib/server/request-body";
import { validateModerationReasonBody } from "@/lib/shared/logo-quarantine";
import { publishStaffAction } from "@/lib/server/staff-audit";
import { removeUserAvatarAsModerator } from "@/lib/server/users/avatar";
import { ANONYMOUS_PLAYER_LABEL } from "@/lib/shared/log-privacy";
import { can } from "@/lib/shared/permissions";
import { unexpectedFailureCode } from "@/lib/server/failure-reason";

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
export async function DELETE(req: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  if (!can(user, "moderation")) return fail("FORBIDDEN", 403);

  const { id } = await context.params;
  const userId = Number(id);
  if (!Number.isSafeInteger(userId) || userId <= 0) return fail("INVALID_USER_ID", 400);

  // Hors signalement, le motif saisi est le seul fait que le message puisse
  // exposer au joueur (DSA, art. 17.3.b) : il est exigé, avant toute écriture.
  const read = await readJsonBodyOrFallback(req, null);
  if ("refusal" in read) return read.refusal;
  const reason = validateModerationReasonBody(read.body);
  if (!reason.ok) return fail(reason.error, 400);

  try {
    const { removedAvatarUrl } = await removeUserAvatarAsModerator(userId);
    // Supprimé par la modération : empreinte bloquée avant que le fichier ne
    // parte (décision D6) ; un résidu sur le disque se consigne sans défaire
    // un retrait déjà effectif (la ligne ne désigne plus le fichier).
    await removeModeratedAvatarFile(removedAvatarUrl);
    // Jamais le pseudo du joueur sur Discord (lib/shared/log-privacy.ts) : ce
    // canal est un tiers hébergé hors de l'Union européenne, purgé au bout d'un an.
    publishStaffAction(`🧹 Avatar d'${ANONYMOUS_PLAYER_LABEL} retiré par le staff (modération).`, {
      id: user.id,
      pseudo: user.pseudo,
    }, { category: "moderation" });
    // Le joueur apprend la décision et le moyen d'y répondre (DSA art. 17) ;
    // hors de tout signalement, le message renvoie vers l'association.
    notifyUserAvatarRemoved(userId, null, reason.reason);
    return ok({ success: true });
  } catch (error) {
    const message = (error as Error).message;
    if (message === "USER_NOT_FOUND") return fail(message, 404);
    if (message === "USER_HAS_NO_AVATAR") return fail(message, 409);
    return fail(unexpectedFailureCode(error, "USER_AVATAR_REMOVE_FAILED", "[moderation] retrait de l'avatar impossible"), 500);
  }
}

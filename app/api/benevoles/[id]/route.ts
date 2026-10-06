import { itemRoutes } from "@/lib/server/admin-collection-routes";
import {
  deleteBenevole,
  getBenevolePhotoUrl,
  updateBenevole,
} from "@/lib/server/benevoles-service";
import { deleteUnreferencedUpload } from "@/lib/server/stored-upload-cleanup";

/**
 * Supprime l'ancienne photo si elle a changé, qu'elle vit dans le dossier des
 * bénévoles et que plus rien ne la désigne. Au mieux : la mutation en base a
 * déjà réussi.
 */
async function cleanupReplacedPhoto(previous: string | null, next: string | null) {
  if (!previous || previous === next) return;
  await deleteUnreferencedUpload(previous, "benevoles");
}

export const { PUT, DELETE } = itemRoutes({
  permission: "showcase",
  notFound: "BENEVOLE_NOT_FOUND",
  updateFailed: "BENEVOLE_UPDATE_FAILED",
  deleteFailed: "BENEVOLE_DELETE_FAILED",
  update: async (id, body) => {
    const previousPhoto = await getBenevolePhotoUrl(id);
    const benevole = await updateBenevole(id, {
      firstName: typeof body.firstName === "string" ? body.firstName : "",
      pseudo: typeof body.pseudo === "string" ? body.pseudo : null,
      lastName: typeof body.lastName === "string" ? body.lastName : "",
      category: typeof body.category === "string" ? body.category : "",
      categoryEn: typeof body.categoryEn === "string" ? body.categoryEn : null,
      photoUrl: typeof body.photoUrl === "string" ? body.photoUrl : null,
      joinedAt: typeof body.joinedAt === "string" ? body.joinedAt : "",
    });
    await cleanupReplacedPhoto(previousPhoto, benevole.photoUrl);
    return { benevole };
  },
  remove: async (id) => {
    const previousPhoto = await getBenevolePhotoUrl(id);
    await deleteBenevole(id);
    await cleanupReplacedPhoto(previousPhoto, null);
  },
});

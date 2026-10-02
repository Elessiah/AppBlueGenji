import { itemRoutes } from "@/lib/server/admin-collection-routes";
import { deleteSponsor, getSponsorImageUrls, updateSponsor } from "@/lib/server/sponsors-service";
import { deleteUnreferencedUpload } from "@/lib/server/stored-upload-cleanup";

/**
 * Supprime l'ancien fichier (logo ou bandeau) s'il a changé, qu'il vit dans le
 * dossier des partenaires et que plus rien ne le désigne — une adresse d'un
 * autre dossier, collée comme logo, ne fait jamais effacer l'image d'autrui.
 * Au mieux : la mutation en base a déjà réussi.
 */
async function cleanupReplacedImage(previous: string | null, next: string | null) {
  if (!previous || previous === next) return;
  await deleteUnreferencedUpload(previous, "sponsors");
}

export const { PUT, DELETE } = itemRoutes({
  permission: "showcase",
  notFound: "SPONSOR_NOT_FOUND",
  updateFailed: "SPONSOR_UPDATE_FAILED",
  deleteFailed: "SPONSOR_DELETE_FAILED",
  update: async (id, body) => {
    const previous = await getSponsorImageUrls(id);
    const sponsor = await updateSponsor(id, {
      name: typeof body.name === "string" ? body.name : "",
      tier: typeof body.tier === "string" ? body.tier : undefined,
      logoUrl: typeof body.logoUrl === "string" ? body.logoUrl : null,
      bannerUrl: typeof body.bannerUrl === "string" ? body.bannerUrl : null,
      websiteUrl: typeof body.websiteUrl === "string" ? body.websiteUrl : null,
      description: typeof body.description === "string" ? body.description : null,
      active: typeof body.active === "boolean" ? body.active : undefined,
    });
    await cleanupReplacedImage(previous.logoUrl, sponsor.logoUrl);
    await cleanupReplacedImage(previous.bannerUrl, sponsor.bannerUrl);
    return { sponsor };
  },
  remove: async (id) => {
    const previous = await getSponsorImageUrls(id);
    await deleteSponsor(id);
    await cleanupReplacedImage(previous.logoUrl, null);
    await cleanupReplacedImage(previous.bannerUrl, null);
  },
});

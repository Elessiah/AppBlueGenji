import { getCurrentUser } from "@/lib/server/auth";
import { can } from "@/lib/shared/permissions";
import { fail, ok } from "@/lib/server/http";
import { processAndStoreImage } from "@/lib/server/image-upload";
import { toServedUploadUrl } from "@/lib/shared/uploads";
import { IMAGE_CROP_FIELD, IMAGE_CROP_INVALID, parseImageCropField } from "@/lib/shared/image-crop";
import { readImageUploadForm } from "@/lib/server/request-body";

/**
 * Reçoit un fichier image (multipart) et le stocke comme bandeau de carte
 * partenaire (WebP 1200×400, recadré au centre). Renvoie l'URL servie
 * (`/api/uploads/...`) à enregistrer ensuite via POST/PUT `/api/landing/sponsors`.
 * Permission `showcase`.
 *
 * Contrairement au logo, un bandeau ne se pose **que** par téléversement : la
 * validation refuse toute autre adresse (`INVALID_BANNER_URL`).
 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  if (!can(user, "showcase")) return fail("FORBIDDEN", 403);

  const form = await readImageUploadForm(req, user.id);
  if (form instanceof Response) return form;

  const file = form.get("file");
  if (!(file instanceof File)) return fail("FILE_MISSING", 400);

  // La zone choisie dans la modale de recadrage ; absente, le gabarit seul.
  const crop = parseImageCropField(form.get(IMAGE_CROP_FIELD));
  if (!crop.ok) return fail(IMAGE_CROP_INVALID, 400);

  try {
    const diskPath = await processAndStoreImage(file, "sponsor-banner", user.id, crop.crop);
    return ok({ bannerUrl: toServedUploadUrl(diskPath) });
  } catch (error) {
    return fail((error as Error).message || "BANNER_UPLOAD_FAILED", 400);
  }
}

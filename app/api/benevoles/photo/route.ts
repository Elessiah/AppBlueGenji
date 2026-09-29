import { getCurrentUser } from "@/lib/server/auth";
import { can } from "@/lib/shared/permissions";
import { fail, ok } from "@/lib/server/http";
import { processAndStoreImage } from "@/lib/server/image-upload";
import { toServedUploadUrl } from "@/lib/shared/uploads";
import { IMAGE_CROP_FIELD, IMAGE_CROP_INVALID, parseImageCropField } from "@/lib/shared/image-crop";
import { readImageUploadForm } from "@/lib/server/request-body";

/**
 * Reçoit un fichier image (multipart) et le stocke sous forme de photo de
 * bénévole normalisée (WebP 256×256, recadrage « cover »). Renvoie l'URL servie
 * (`/api/uploads/...`) à enregistrer ensuite via POST/PUT `/api/benevoles`.
 * Admin uniquement.
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
    const diskPath = await processAndStoreImage(file, "benevole-photo", user.id, crop.crop);
    return ok({ photoUrl: toServedUploadUrl(diskPath) });
  } catch (error) {
    return fail((error as Error).message || "PHOTO_UPLOAD_FAILED", 400);
  }
}

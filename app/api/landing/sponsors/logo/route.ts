import { getCurrentUser } from "@/lib/server/auth";
import { can } from "@/lib/shared/permissions";
import { fail, ok } from "@/lib/server/http";
import { processAndStoreImage } from "@/lib/server/image-upload";
import { toServedUploadUrl } from "@/lib/shared/uploads";
import { IMAGE_CROP_FIELD, IMAGE_CROP_INVALID, parseImageCropField } from "@/lib/shared/image-crop";

/**
 * Reçoit un fichier image (multipart) et le stocke sous forme de logo
 * partenaire normalisé (WebP 600×200, fond transparent). Renvoie l'URL servie
 * (`/api/uploads/...`) à enregistrer ensuite via POST/PUT `/api/landing/sponsors`.
 * Admin uniquement.
 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  if (!can(user, "showcase")) return fail("FORBIDDEN", 403);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail("FILE_MISSING", 400);
  }

  const file = form.get("file");
  if (!(file instanceof File)) return fail("FILE_MISSING", 400);

  // La zone choisie dans la modale de recadrage ; absente, le gabarit seul.
  const crop = parseImageCropField(form.get(IMAGE_CROP_FIELD));
  if (!crop.ok) return fail(IMAGE_CROP_INVALID, 400);

  try {
    const diskPath = await processAndStoreImage(file, "sponsor-logo", user.id, crop.crop);
    return ok({ logoUrl: toServedUploadUrl(diskPath) });
  } catch (error) {
    return fail((error as Error).message || "LOGO_UPLOAD_FAILED", 400);
  }
}

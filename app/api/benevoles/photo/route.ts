import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { processAndStoreImage } from "@/lib/server/image-upload";
import { toServedUploadUrl } from "@/lib/shared/uploads";

/**
 * Reçoit un fichier image (multipart) et le stocke sous forme de photo de
 * bénévole normalisée (WebP 256×256, recadrage « cover »). Renvoie l'URL servie
 * (`/api/uploads/...`) à enregistrer ensuite via POST/PUT `/api/benevoles`.
 * Admin uniquement.
 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);
  if (!user.isAdmin) return fail("FORBIDDEN", 403);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail("FILE_MISSING", 400);
  }

  const file = form.get("file");
  if (!(file instanceof File)) return fail("FILE_MISSING", 400);

  try {
    const diskPath = await processAndStoreImage(file, "benevole-photo", user.id);
    return ok({ photoUrl: toServedUploadUrl(diskPath) });
  } catch (error) {
    return fail((error as Error).message || "PHOTO_UPLOAD_FAILED", 400);
  }
}

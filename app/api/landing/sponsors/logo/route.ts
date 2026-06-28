import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { processAndStoreImage } from "@/lib/server/image-upload";

/**
 * Reçoit un fichier image (multipart) et le stocke sous forme de logo
 * partenaire normalisé (WebP 600×200, fond transparent). Renvoie l'URL relative
 * à enregistrer ensuite via POST/PUT `/api/landing/sponsors`. Admin uniquement.
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
    const logoUrl = await processAndStoreImage(file, "sponsor-logo", user.id);
    return ok({ logoUrl });
  } catch (error) {
    return fail((error as Error).message || "LOGO_UPLOAD_FAILED", 400);
  }
}

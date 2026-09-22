import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { deleteStoredImage, processAndStoreImage } from "@/lib/server/image-upload";
import { getUserById, updateUserAvatar } from "@/lib/server/users-service";
import { ACCOUNT_DELETED_ERROR } from "@/lib/shared/account-deletion";
import { toDiskUploadPath, toServedUploadUrl } from "@/lib/shared/uploads";

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail("FILE_MISSING", 400);
  }

  const file = form.get("file");
  if (!(file instanceof File)) return fail("FILE_MISSING", 400);

  try {
    const current = await getUserById(user.id);
    const diskPath = await processAndStoreImage(file, "avatar", user.id);
    const servedUrl = toServedUploadUrl(diskPath);
    // Un téléversement parti avant une suppression de compte reprend **après**
    // son commit, bloqué jusque-là sur le verrou de la ligne : l'écriture est
    // alors refusée, et c'est le fichier déjà posé sur le disque qu'il faut
    // reprendre — servi par `/api/uploads/avatars/…`, il survivrait seul à un
    // compte effacé dont on vient de promettre qu'il ne resterait rien.
    if (!(await updateUserAvatar(user.id, servedUrl))) {
      await deleteStoredImage(diskPath);
      return fail(ACCOUNT_DELETED_ERROR, 409);
    }
    await deleteStoredImage(toDiskUploadPath(current?.avatarUrl));
    return ok({ avatarUrl: servedUrl });
  } catch (error) {
    return fail((error as Error).message || "AVATAR_UPLOAD_FAILED", 400);
  }
}

export async function DELETE() {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);

  const current = await getUserById(user.id);
  // **La base d'abord, le fichier ensuite.** L'ordre inverse effaçait l'image
  // avant l'écriture qui la déréférence : `updateUserAvatar` peut échouer (la
  // route n'a pas de `try/catch`, contrairement au POST) et `avatar_url`
  // pointait alors sur un fichier disparu — une image cassée, définitivement.
  //
  // Le refus est le même qu'au téléversement : une ligne supprimée n'accepte
  // plus rien, et annoncer « avatar supprimé » sur une écriture qui n'a rien
  // apparié serait faux. Ici, rien à reprendre — le fichier est encore là,
  // c'est le mode « anonymisation » qui l'emporte de son côté.
  if (!(await updateUserAvatar(user.id, null))) return fail(ACCOUNT_DELETED_ERROR, 409);
  await deleteStoredImage(toDiskUploadPath(current?.avatarUrl));
  return ok({ avatarUrl: null });
}

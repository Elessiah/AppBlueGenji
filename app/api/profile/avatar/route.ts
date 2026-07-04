import { getCurrentUser } from "@/lib/server/auth";
import { fail, ok } from "@/lib/server/http";
import { deleteStoredImage, processAndStoreImage } from "@/lib/server/image-upload";
import { getUserById, updateUserAvatar } from "@/lib/server/users-service";
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
    await updateUserAvatar(user.id, servedUrl);
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
  await deleteStoredImage(toDiskUploadPath(current?.avatarUrl));
  await updateUserAvatar(user.id, null);
  return ok({ avatarUrl: null });
}

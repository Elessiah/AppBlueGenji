/**
 * Retrait d'un moyen de connexion.
 *
 * Le refus qui compte — « c'est ton dernier » — vient du module pur
 * (`lib/shared/account-connections.ts`), celui-là même qui grise le bouton côté
 * écran : le bouton et la route disent donc la même chose, et aucun des deux ne
 * mène à un mur.
 *
 * **409 et non 403** sur `LAST_CONNECTION` : la demande est légitime et
 * l'appelant est bien chez lui, c'est l'état du compte qui s'y oppose — et il
 * nomme le geste qui le lève (rattacher un autre fournisseur d'abord).
 */
import { getCurrentUser } from "@/lib/server/auth";
import { unlinkOAuthIdentity } from "@/lib/server/account-identities";
import { fail, ok } from "@/lib/server/http";
import { oauthProviderFromSlug } from "@/lib/shared/oauth-providers";

function statusFor(message: string): number {
  switch (message) {
    case "NOT_LINKED":
      return 404;
    case "LAST_CONNECTION":
      return 409;
    case "PROFILE_NOT_FOUND":
      return 404;
    default:
      return 500;
  }
}

export async function DELETE(
  _: Request,
  context: { params: Promise<{ provider: string }> },
): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHORIZED", 401);

  const { provider: slug } = await context.params;
  const provider = oauthProviderFromSlug(slug);
  if (!provider) return fail("UNKNOWN_PROVIDER", 404);

  try {
    await unlinkOAuthIdentity(user.id, provider);
    return ok({ success: true });
  } catch (error) {
    const message = (error as Error).message || "CONNECTION_UNLINK_FAILED";
    return fail(message, statusFor(message));
  }
}

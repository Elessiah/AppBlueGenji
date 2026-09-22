/**
 * Réception du jeton d'identité (`credential`) rendu par Google One Tap.
 *
 * Contrairement à `/api/auth/google/{start,callback}`, il n'y a ici ni cookie
 * d'état ni redirection : le script client a déjà obtenu le jeton directement
 * de Google, et le pose au serveur pour vérification. Une fois signé,
 * l'identité qu'il porte rejoint le même aiguillage que les trois autres
 * portes (`createOrGetOAuthUser`) — One Tap n'est qu'une quatrième façon
 * d'obtenir une identité Google, pas un chemin de compte à part.
 */
import { createSession } from "@/lib/server/auth";
import { GOOGLE_ONE_TAP_RULE, enforceRateLimit, requestClientIp } from "@/lib/server/api-guard";
import { fail, ok } from "@/lib/server/http";
import { createOrGetOAuthUser } from "@/lib/server/account-identities";
import { verifyGoogleOneTapCredential } from "@/lib/server/google-one-tap";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { credential?: string };
    const credential = (body.credential ?? "").trim();
    if (!credential) return fail("MISSING_CREDENTIAL", 400);

    // Après la validation de forme, comme les autres routes de connexion : un
    // corps vide ne doit pas consommer le quota d'une IP dont quelqu'un
    // d'autre a besoin.
    const throttled = enforceRateLimit(GOOGLE_ONE_TAP_RULE, requestClientIp(req));
    if (throttled) return throttled;

    let profile;
    try {
      profile = await verifyGoogleOneTapCredential(credential);
    } catch {
      return fail("GOOGLE_ONE_TAP_INVALID", 401);
    }

    const userId = await createOrGetOAuthUser({
      provider: "GOOGLE",
      subject: profile.sub,
      handle: null,
      avatarUrl: profile.picture ?? null,
      displayName: profile.name ?? null,
    });
    await createSession(userId);

    return ok({ success: true });
  } catch (error) {
    return fail((error as Error).message || "GOOGLE_ONE_TAP_FAILED", 500);
  }
}

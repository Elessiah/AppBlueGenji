import { NextRequest, NextResponse } from "next/server";
import { consumeGoogleOAuthState, createSession } from "@/lib/server/auth";
import { fetchGoogleUser, getAppBaseUrl } from "@/lib/server/google-oauth";
import { createOrGetGoogleUser } from "@/lib/server/users-service";
import { safeRedirectPath } from "@/lib/shared/safe-redirect";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const base = getAppBaseUrl(req.url);
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");

  if (!code || !state) {
    return NextResponse.redirect(new URL("/connexion?error=google", base));
  }

  const cookieState = await consumeGoogleOAuthState();
  if (!cookieState || cookieState.state !== state) {
    return NextResponse.redirect(new URL("/connexion?error=state", base));
  }

  try {
    const profile = await fetchGoogleUser(code);
    // `email_verified` traverse explicitement : `createOrGetGoogleUser` s'en
    // sert pour decider s'il a le droit de rattacher ce `sub` a un compte qui
    // existe deja, et le nom du champ change de casse en passant du protocole
    // au vocabulaire du projet.
    const userId = await createOrGetGoogleUser({
      sub: profile.sub,
      email: profile.email,
      emailVerified: profile.email_verified === true,
      name: profile.name,
      picture: profile.picture,
    });
    await createSession(userId);

    // Filtrée de nouveau à la sortie : le cookie d'état n'est pas signé, il ne
    // fait pas foi — et `new URL` **ignore sa base** dès que la valeur est une
    // URL absolue, si bien que la base ne borne rien.
    return NextResponse.redirect(new URL(safeRedirectPath(cookieState.redirectTo), base));
  } catch {
    return NextResponse.redirect(new URL("/connexion?error=oauth", base));
  }
}

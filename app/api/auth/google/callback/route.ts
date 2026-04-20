import { NextRequest, NextResponse } from "next/server";
import { consumeGoogleOAuthState, createSession } from "@/lib/server/auth";
import { fetchGoogleUser } from "@/lib/server/google-oauth";
import { createOrGetGoogleUser } from "@/lib/server/users-service";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");

  if (!code || !state) {
    return NextResponse.redirect(new URL("/connexion?error=google", req.url));
  }

  const cookieState = await consumeGoogleOAuthState();
  if (!cookieState || cookieState.state !== state) {
    return NextResponse.redirect(new URL("/connexion?error=state", req.url));
  }

  try {
    const profile = await fetchGoogleUser(code);
    const userId = await createOrGetGoogleUser(profile);
    await createSession(userId);

    return NextResponse.redirect(new URL(cookieState.redirectTo || "/tournois", req.url));
  } catch {
    return NextResponse.redirect(new URL("/connexion?error=oauth", req.url));
  }
}

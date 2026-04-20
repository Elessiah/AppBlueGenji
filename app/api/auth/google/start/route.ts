import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { buildGoogleAuthorizationUrl } from "@/lib/server/google-oauth";
import { saveGoogleOAuthState } from "@/lib/server/auth";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const redirectTo = req.nextUrl.searchParams.get("redirect") || "/tournois";
  const state = crypto.randomBytes(24).toString("hex");

  try {
    const googleUrl = buildGoogleAuthorizationUrl(state);
    await saveGoogleOAuthState(state, redirectTo);
    return NextResponse.redirect(googleUrl);
  } catch (error) {
    const message = (error as Error).message || "";
    const missingConfig =
      message.startsWith("Missing GOOGLE_") || message.includes("Missing GOOGLE_REDIRECT_URI or APP_URL");

    if (missingConfig) {
      return NextResponse.redirect(new URL("/connexion?error=google_not_configured", req.url));
    }

    return NextResponse.redirect(new URL("/connexion?error=google_unavailable", req.url));
  }
}

import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { buildGoogleAuthorizationUrl, getAppBaseUrl } from "@/lib/server/google-oauth";
import { saveGoogleOAuthState } from "@/lib/server/auth";
import { safeRedirectPath } from "@/lib/shared/safe-redirect";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const base = getAppBaseUrl(req.url);
  // Filtrée dès l'aller : rien d'étranger au site n'entre dans le cookie d'état.
  const redirectTo = safeRedirectPath(req.nextUrl.searchParams.get("redirect"));
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
      return NextResponse.redirect(new URL("/connexion?error=google_not_configured", base));
    }

    return NextResponse.redirect(new URL("/connexion?error=google_unavailable", base));
  }
}

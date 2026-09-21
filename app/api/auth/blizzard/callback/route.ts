/**
 * Retour de l'aller-retour OAuth Blizzard (Battle.net).
 *
 * Toute la mécanique vit dans `lib/server/oauth-flow.ts`, partagée par les trois
 * fournisseurs : jeton anti-CSRF, cookie d'état, filtrage de la destination,
 * distinction entre se connecter et rattacher. La route ne fait que nommer sa
 * porte.
 */
import { NextRequest, NextResponse } from "next/server";
import { completeOAuth } from "@/lib/server/oauth-flow";

export async function GET(req: NextRequest): Promise<NextResponse> {
  return completeOAuth(req, "BLIZZARD");
}

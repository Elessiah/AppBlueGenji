/**
 * Départ de l'aller-retour OAuth Discord.
 *
 * **À ne pas confondre avec `../request`**, qui envoie le code à six chiffres en
 * message privé. Les deux ouvrent le même compte, et les deux certifient le tag ;
 * celle-ci ne demande rien au bot, donc fonctionne pour qui n'est pas sur le
 * serveur BlueGenji.
 *
 * Toute la mécanique vit dans `lib/server/oauth-flow.ts`, partagée par les trois
 * fournisseurs : jeton anti-CSRF, cookie d'état, filtrage de la destination,
 * distinction entre se connecter et rattacher. La route ne fait que nommer sa
 * porte.
 */
import { NextRequest, NextResponse } from "next/server";
import { startOAuth } from "@/lib/server/oauth-flow";

export async function GET(req: NextRequest): Promise<NextResponse> {
  return startOAuth(req, "DISCORD");
}

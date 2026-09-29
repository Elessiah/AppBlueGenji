import { NextResponse } from "next/server";

import { publicErrorCode } from "@/lib/shared/api-error-code";

export type ApiError = { error: string };

export function ok<T>(data: T, status = 200): NextResponse<T> {
  return NextResponse.json(data, { status });
}

/**
 * Réponse de refus : `{ error: <code> }`.
 *
 * **Seul un code sort** (`publicErrorCode`). Une cinquantaine de routes
 * écrivent `fail(error.message || "…")`, si bien que tout message d'exception
 * *imprévu* partait tel quel dans le corps — y compris sur des routes anonymes :
 * une erreur mysql2 nomme base, table et contrainte, un `connect ECONNREFUSED`
 * dit où écoute la base, un `SyntaxError` de `req.json()` décrit le corps reçu.
 * Le défaut se corrigeait au cas par cas ; il est fermé ici, pour les routes
 * existantes comme pour celle qu'on écrira demain. Le message écarté est
 * journalisé côté serveur, où il sert encore au diagnostic.
 */
export function fail<T extends object = Record<string, never>>(
  message: string,
  status = 400,
  /**
   * Complément joint au corps de l'erreur. Sert aux refus qui savent où mener
   * l'appelant — un identifiant d'équipe qui désigne en fait une entrée solo
   * rend le profil du joueur, plutôt que de laisser la page sur un cul-de-sac.
   */
  details?: T,
): NextResponse<ApiError & Partial<T>> {
  // Un corps refusé par la lecture bornée (`PAYLOAD_TOO_LARGE`,
  // `lib/server/request-body.ts`) remonte souvent par le `catch` générique
  // d'une route, qui l'aurait rendu en 400 ou 500 : c'est un 413 partout.
  if (message === "PAYLOAD_TOO_LARGE") status = 413;
  const code = publicErrorCode(message, status);
  if (code !== message) {
    console.error(`[api] message d'erreur non public remplacé par ${code} (${status}) :`, message);
  }
  return NextResponse.json({ ...details, error: code } as ApiError & Partial<T>, { status });
}

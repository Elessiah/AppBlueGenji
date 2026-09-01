import { NextResponse } from "next/server";

export type ApiError = { error: string };

export function ok<T>(data: T, status = 200): NextResponse<T> {
  return NextResponse.json(data, { status });
}

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
  return NextResponse.json({ error: message, ...details } as ApiError & Partial<T>, { status });
}

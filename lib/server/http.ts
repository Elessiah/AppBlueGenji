import { NextResponse } from "next/server";

import { isDeadlockMessage } from "@/lib/server/mysql-errors";
import { CONCURRENT_UPDATE_RETRY, publicErrorCode } from "@/lib/shared/api-error-code";

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
  // Même chemin pour un corps non déclaré JSON (`readJsonBody`) : c'est un
  // refus de la requête, jamais une panne du serveur.
  if (message === "UNSUPPORTED_CONTENT_TYPE") status = 415;
  // Interblocage : InnoDB a défait la transaction de cette requête au profit
  // d'une écriture concurrente (saisie de score contre réordonnancement du
  // seeding, par exemple). Rien n'est écrit, et ce n'est ni une panne ni une
  // requête fautive : un conflit (409) que l'interface traduit en « réessaie ».
  // Posé ici, il vaut pour toute route d'écriture, présente ou à venir.
  if (isDeadlockMessage(message)) {
    console.warn(`[api] écriture annulée par un interblocage, rendue en ${CONCURRENT_UPDATE_RETRY} :`, message);
    return NextResponse.json({ ...details, error: CONCURRENT_UPDATE_RETRY } as ApiError & Partial<T>, {
      status: 409,
    });
  }

  const code = publicErrorCode(message, status);
  if (code !== message) {
    console.error(`[api] message d'erreur non public remplacé par ${code} (${status}) :`, message);
  }
  return NextResponse.json({ ...details, error: code } as ApiError & Partial<T>, { status });
}

/**
 * Ce qu'une ligne d'échec de pm2 dit d'une erreur : son code (`ER_…`,
 * `ECONNREFUSED`) ou la première ligne de son message (200 caractères au
 * plus), **jamais l'objet entier** — pile, requête et `sqlMessage` de mysql2
 * pourraient porter des valeurs lues (un `ER_DUP_ENTRY` cite la valeur en
 * double), alors que le registre (T05) et /rgpd décrivent ces lignes comme le
 * geste et le numéro, sans plus. Une seule règle pour tous les journaux
 * d'échec (journal du staff, avis de cast, rafales regroupées).
 */
export function failureReason(error: unknown): string {
  if (error && typeof error === "object") {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && code !== "") return code;
  }
  if (error instanceof Error) return error.message.split("\n")[0].slice(0, 200);
  return "erreur inconnue";
}

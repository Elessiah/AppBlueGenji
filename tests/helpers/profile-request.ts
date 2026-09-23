/**
 * Requête `PATCH /api/profile` portant `body` en JSON — la forme que l'écran
 * `/profil` envoie, partagée par les tests de la route.
 */
export function profilePatchRequest(body: unknown): Request {
  return new Request("http://localhost/api/profile", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

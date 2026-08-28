/**
 * Cache de l'aperçu du plateau avant lancement.
 *
 * L'aperçu est **gaté par une permission, pas propre à une personne** : deux
 * arbitres et un caster qui regardent le même tournoi voient rigoureusement la
 * même chose. Le recalculer par lecteur reviendrait à refaire, à chaque
 * connexion SSE et à chaque lecture REST du détail, la requête de classement du
 * site sur toutes les équipes — la faute de découpage que cette fonctionnalité
 * corrige partout ailleurs.
 *
 * Il ne peut pas pour autant rejoindre l'instantané partagé : celui-là part tel
 * quel à **tous** les abonnés du flux, y compris ceux qui n'ont pas le droit de
 * le voir. D'où ce cache à part : calculé une fois par tournoi, servi à ceux qui
 * y ont droit, et oublié dès qu'une écriture le rend faux.
 *
 * Module séparé de `./index` pour que `./notifications` puisse invalider sans
 * créer de cycle d'import.
 */
import type { TournamentPreview } from "@/lib/shared/tournament-preview";
import { cached, invalidateCached } from "@/lib/server/cache";
import { withConnection } from "@/lib/server/database";
import { loadTournamentRow } from "./repository";

/**
 * Durée de vie d'un aperçu. Courte comme celle de l'instantané : elle n'absorbe
 * que les pointes, l'invalidation à l'écriture se chargeant de la justesse — une
 * inscription publie `updated`, et l'aperçu suit dans la seconde.
 */
export const PREVIEW_TTL_MS = 3_000;

function cacheKey(tournamentId: number): string {
  return `tournament-preview:${tournamentId}`;
}

/** Oublie l'aperçu d'un tournoi. Appelé à chaque publication d'événement. */
export function invalidateTournamentPreview(tournamentId: number): void {
  invalidateCached(cacheKey(tournamentId));
}

/**
 * Aperçu du tournoi, mutualisé entre tous les lecteurs autorisés.
 *
 * **Ne contrôle aucun droit** : l'appelant doit avoir vérifié `tournaments` ou
 * `casting` avant d'appeler. C'est pourquoi cette fonction n'est pas réexportée
 * par `./index` — le seul chemin public vers l'aperçu est
 * `getTournamentViewerContext`, qui exige ce droit en paramètre.
 *
 * Renvoie `null` quand le tournoi n'existe pas ou qu'il n'est plus prévisible
 * (déjà lancé) — c'est `loadTournamentPreview` qui en décide.
 */
export function getTournamentPreview(tournamentId: number): Promise<TournamentPreview | null> {
  return cached(cacheKey(tournamentId), PREVIEW_TTL_MS, async () =>
    withConnection(async (connection) => {
      const row = await loadTournamentRow(connection, tournamentId);
      if (!row) return null;

      const { loadTournamentPreview } = await import("./preview");
      return loadTournamentPreview(connection, row);
    }),
  );
}

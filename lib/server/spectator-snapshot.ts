/**
 * Réponse publique d'un tournoi, mutualisée entre tous ses visiteurs sans
 * compte (`docs/features/SPECTATOR_VIEW.md`).
 *
 * Elle passe par la même porte gardée que l'espace connecté
 * (`getVisibleTournamentSnapshot`, **sans aucun droit**) : un tournoi pas encore
 * publié n'existe pas ici non plus. L'instantané en sort allégé de ce que la
 * politique de confidentialité réserve aux membres (`spectatorSnapshot`), puis
 * sérialisé **une fois** pour tous.
 *
 * Aucune invalidation n'est branchée : une écriture ne réveille pas les
 * visiteurs sans compte, qui relisent à la cadence que la charge leur accorde.
 * La durée de vie borne leur retard, et le nombre de reconstructions — au plus
 * une par tournoi et par durée de vie, quel que soit leur nombre.
 */
import { cached } from "@/lib/server/cache";
import { getVisibleTournamentSnapshot } from "@/lib/server/tournaments-service";
import { spectatorSnapshot } from "@/lib/shared/spectator-view";
import type { TournamentState } from "@/lib/shared/types";

/** Ce que la route sert : l'empreinte, l'état (pour la cadence) et le corps prêt à écrire. */
export type SpectatorPayload = {
  version: string;
  state: TournamentState;
  body: string;
};

function cacheKey(tournamentId: number): string {
  return `spectator-snapshot:${tournamentId}`;
}

/**
 * Réponse publique du tournoi, ou `null` : il n'existe pas, ou pas encore pour
 * le public — les deux cas se confondent, comme partout ailleurs.
 *
 * @param ttlMs Durée de vie d'une réponse **nouvellement** calculée
 *   (`spectatorCacheTtlMs`, selon la charge). Une réponse déjà en cache garde
 *   la sienne.
 */
export function getSpectatorPayload(tournamentId: number, ttlMs: number): Promise<SpectatorPayload | null> {
  return cached(cacheKey(tournamentId), ttlMs, async () => {
    const snapshot = await getVisibleTournamentSnapshot(tournamentId);
    if (!snapshot) return null;
    return {
      version: snapshot.version,
      state: snapshot.card.state,
      body: JSON.stringify(spectatorSnapshot(snapshot)),
    };
  });
}

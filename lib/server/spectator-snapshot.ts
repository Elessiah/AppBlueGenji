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
 * Une écriture ne réveille pas les visiteurs sans compte et n'invalide pas cette
 * réponse : sa durée de vie, allongée sous la charge, est ce qui protège la
 * machine d'un tournoi animé — au plus une reconstruction par tournoi et par
 * durée de vie, quel que soit le nombre de visiteurs. Seule la suppression du
 * tournoi la retire (`invalidateSpectatorSnapshot`).
 */
import { createHash } from "node:crypto";
import { cached } from "@/lib/server/cache";
import { getVisibleTournamentCard, getVisibleTournamentSnapshot } from "@/lib/server/tournaments-service";
import { spectatorSnapshotCacheKey } from "@/lib/server/tournaments/snapshot";
import { spectatorSnapshot } from "@/lib/shared/spectator-view";
import type { TournamentState } from "@/lib/shared/types";

/**
 * Ce que la route sert : l'empreinte, l'état (pour la cadence) et le corps prêt
 * à écrire. L'empreinte est celle du **corps public**, et non la version de
 * l'instantané des membres : un code de replay corrigé ne change rien de ce que
 * lit le visiteur, il garde son `304`.
 */
export type SpectatorPayload = {
  version: string;
  state: TournamentState;
  body: string;
  /** Durée de vie reçue à la construction : l'âge maximal annoncé en dépend. */
  ttlMs: number;
};

/** Refus du chargeur : rien à servir, et rien à mettre en cache. */
class SpectatorNotFound extends Error {}

/**
 * Réponse publique du tournoi, ou `null` : il n'existe pas, ou pas encore pour
 * le public — les deux cas se confondent, comme partout ailleurs.
 *
 * @param ttlMs Durée de vie d'une réponse **nouvellement** calculée
 *   (`spectatorCacheTtlMs`, selon la charge). Une réponse déjà en cache garde
 *   la sienne.
 */
export async function getSpectatorPayload(tournamentId: number, ttlMs: number): Promise<SpectatorPayload | null> {
  // Choix assumé (décision de l'auteur, `SPECTATOR_VIEW.md`) : seule la
  // suppression du tournoi retire cette réponse. Un renommage, un avatar retiré
  // ou un compte supprimé attendent son expiration (15 s au calme, 150 s sous
  // la charge) — c'est elle qui protège la machine d'un tournoi animé. Un
  // tournoi publié ne redevient jamais invisible : `startVisibilityAt` ne
  // change que dans la fenêtre `FULL`, celle d'un tournoi encore caché.
  try {
    return await cached(spectatorSnapshotCacheKey(tournamentId), ttlMs, async () => {
      // La carte d'abord : une requête indexée, sans écriture. Un tournoi
      // inconnu ou pas encore publié s'arrête là, sans faire construire son
      // instantané entier (matchs, classements, entretien) par un visiteur
      // anonyme qui parcourt les identifiants. Pour un tournoi visible, c'est
      // une requête de plus par durée de vie (4 par minute au plus) : voulu.
      const visible = await getVisibleTournamentCard(tournamentId);
      const snapshot = visible ? await getVisibleTournamentSnapshot(tournamentId) : null;
      // Un « introuvable » **n'entre pas** dans le cache : `cached` ne garde
      // jamais un échec. Des identifiants parcourus au hasard n'y chassent donc
      // pas les clés chaudes (500 entrées, partagées avec tout le site), et un
      // tournoi publié une seconde plus tard s'ouvre aussitôt.
      if (!snapshot) throw new SpectatorNotFound();
      // Une seule sérialisation. La version des membres en sort (elle bouge avec
      // les champs retirés) : l'empreinte du corps public la remplace, et ne
      // voyage que dans l'en-tête `ETag` — le relecteur ne lit pas `version`.
      const body = JSON.stringify({ ...spectatorSnapshot(snapshot), version: "" });
      return {
        version: createHash("sha256").update(body).digest("base64url").slice(0, 22),
        state: snapshot.card.state,
        body,
        ttlMs,
      };
    });
  } catch (error) {
    if (error instanceof SpectatorNotFound) return null;
    throw error;
  }
}

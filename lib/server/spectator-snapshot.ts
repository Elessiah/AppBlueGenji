/**
 * Réponse publique d'un tournoi, mutualisée entre tous ses visiteurs sans
 * compte (`docs/features/SPECTATOR_VIEW.md`).
 *
 * Elle passe par la même porte gardée que l'espace connecté
 * (`getVisibleTournamentSnapshot`, **sans aucun droit**) : un tournoi pas encore
 * publié n'existe pas ici non plus. L'instantané en sort allégé de ce que la
 * politique de confidentialité réserve aux membres (`spectatorSnapshot`), puis
 * sérialisé **une fois** pour tous — et compressé une fois, à la première
 * lecture qui l'accepte.
 *
 * Une écriture ne réveille pas les visiteurs sans compte et n'invalide pas cette
 * réponse : sa durée de vie, allongée sous la charge, est ce qui protège la
 * machine d'un tournoi animé — au plus une reconstruction par tournoi et par
 * durée de vie, quel que soit le nombre de visiteurs. Seule la suppression du
 * tournoi la retire (`invalidateSpectatorSnapshot`).
 *
 * **Ce que coûte une reconstruction, et qui la paie** — tout se décide ici, sur
 * le chemin même où `cached` lance le chargeur (`beforeLoad`), jamais par un
 * contrôle « chaud » fait à part :
 * - l'instantané des membres est chaud (salon SSE ouvert) : filtrage et
 *   sérialisation seulement — ni carte relue, ni jeton, ni place ;
 * - sinon : un jeton du réseau qui la provoque (`SPECTATOR_REBUILD_RULE`, pris
 *   avant toute lecture en base et **rendu** si rien n'a été construit :
 *   introuvable, panne, machine occupée), la carte (un identifiant inconnu
 *   s'arrête là), puis une des {@link SPECTATOR_MAX_CONCURRENT_REBUILDS} places
 *   de construction, toutes adresses confondues.
 */
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { refundRateToken, SPECTATOR_REBUILD_RULE, takeRateToken } from "@/lib/server/api-guard";
import { cached, cachedStale } from "@/lib/server/cache";
import { getVisibleTournamentCard, getVisibleTournamentSnapshot } from "@/lib/server/tournaments-service";
import { isTournamentSnapshotWarm, spectatorSnapshotCacheKey } from "@/lib/server/tournaments/snapshot";
import {
  SPECTATOR_MAX_COPY_AGE_MS,
  spectatorCacheTtlMs,
  spectatorSnapshot,
  type SpectatorLoadLevel,
} from "@/lib/shared/spectator-view";
import type { TournamentSnapshot, TournamentState } from "@/lib/shared/types";

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
  /** L'instantané public que `body` sérialise (réglages, encart) — jamais celui des membres. */
  snapshot: TournamentSnapshot;
};

/**
 * Constructions simultanées au plus, toutes adresses confondues. Le plafond par
 * réseau fait l'équité ; celui-ci borne le travail froid total : quelques
 * dizaines d'adresses à leur plein débit ne font plus reconstruire tous les
 * tournois publiés à chaque durée de vie, et le pool MySQL garde ses
 * connexions pour les membres.
 */
export const SPECTATOR_MAX_CONCURRENT_REBUILDS = 4;
let rebuildsInFlight = 0;

/**
 * Reconstruction refusée : `rate` = le réseau n'a plus de jeton (le `429` à
 * servir l'accompagne), `busy` = toutes les places sont prises. La route sert
 * alors la dernière réponse si elle a moins de {@link SPECTATOR_MAX_COPY_AGE_MS}
 * ({@link staleSpectatorPayload}), sinon le refus.
 */
export class SpectatorRebuildRefused extends Error {
  constructor(
    readonly kind: "rate" | "busy",
    readonly response: Response | null = null,
  ) {
    super(`spectator rebuild refused (${kind})`);
  }
}

/**
 * Le tournoi est-il visible du public ? Une seule requête indexée (sa carte),
 * sans écriture : c'est ce qu'une lecture d'un identifiant inconnu ou pas encore
 * publié coûte.
 *
 * Mutualisée **en vol** (rien n'est gardé : un tournoi publié une seconde plus
 * tard s'ouvre aussitôt) : cent onglets qui arrivent ensemble sur une réponse
 * froide ne font qu'une lecture de la carte.
 */
export function isSpectatorTournamentPublic(tournamentId: number): Promise<boolean> {
  return cached(`spectator-public:${tournamentId}`, 0, async () => (await getVisibleTournamentCard(tournamentId)) !== null);
}

/** Refus du chargeur : rien à servir, et rien à mettre en cache. */
class SpectatorNotFound extends Error {}

/** Corps compressés, un par réponse construite (une fois pour tous ses lecteurs). */
const gzippedBodies = new WeakMap<SpectatorPayload, Uint8Array<ArrayBuffer>>();

/**
 * Le corps compressé (gzip), calculé à la première lecture qui l'accepte puis
 * resservi : Next ne recompresse pas une réponse déjà encodée, et un gros
 * tournoi suivi par des centaines d'onglets ne coûte plus un gzip par `200`.
 */
export function gzippedSpectatorBody(payload: SpectatorPayload): Uint8Array<ArrayBuffer> {
  let bytes = gzippedBodies.get(payload);
  if (!bytes) {
    bytes = new Uint8Array(gzipSync(payload.body));
    gzippedBodies.set(payload, bytes);
  }
  return bytes;
}

/**
 * La dernière réponse publique du tournoi, **même échue**, tant qu'elle a moins
 * de {@link SPECTATOR_MAX_COPY_AGE_MS} — l'âge que `/rgpd` déclare. Pour servir
 * une reconstruction refusée sans refuser la lecture : une salle derrière une
 * adresse partagée garde son plateau, et la réponse ne dit plus si quelqu'un
 * d'autre vient de lire ce tournoi. La suppression du tournoi l'efface aussi.
 */
export function staleSpectatorPayload(tournamentId: number): SpectatorPayload | null {
  return cachedStale<SpectatorPayload>(spectatorSnapshotCacheKey(tournamentId)) ?? null;
}

/**
 * Réponse publique du tournoi, ou `null` : il n'existe pas, ou pas encore pour
 * le public — les deux cas se confondent, comme partout ailleurs.
 *
 * @param level Niveau de charge du moment : la durée de vie d'une réponse
 *   **nouvellement** construite en dépend (`spectatorCacheTtlMs`, avec l'état
 *   du tournoi). Une réponse déjà en cache garde la sienne.
 * @param client Réseau qui provoque la lecture (`clientNetworkKey`) : c'est lui
 *   qui paie une reconstruction. `null` : inconnu, jamais plafonné.
 * @throws {SpectatorRebuildRefused} reconstruction refusée (plafond, places).
 */
export async function getSpectatorPayload(
  tournamentId: number,
  level: SpectatorLoadLevel,
  client: string | null,
): Promise<SpectatorPayload | null> {
  // Choix assumé (décision de l'auteur, `SPECTATOR_VIEW.md`) : seule la
  // suppression du tournoi retire cette réponse. Un renommage, un avatar retiré
  // ou un compte supprimé attendent son expiration (15 s au calme, 150 s sous
  // la charge ou pour un tournoi terminé) — c'est elle qui protège la machine
  // d'un tournoi animé. Un tournoi publié ne redevient jamais invisible :
  // `startVisibilityAt` ne change que dans la fenêtre `FULL`, celle d'un
  // tournoi encore caché.
  let membersWarm = false;
  let charged = false;
  try {
    return await cached(
      spectatorSnapshotCacheKey(tournamentId),
      (payload: SpectatorPayload) => payload.ttlMs,
      async () => {
        let slot = false;
        if (!membersWarm) {
          // La carte d'abord : une requête indexée, sans écriture. Un tournoi
          // inconnu ou pas encore publié s'arrête là, sans faire construire son
          // instantané entier par un visiteur qui parcourt les identifiants.
          if (!(await isSpectatorTournamentPublic(tournamentId))) throw new SpectatorNotFound();
          // Un salon SSE a pu remplir l'instantané pendant cette attente.
          if (!isTournamentSnapshotWarm(tournamentId)) {
            if (rebuildsInFlight >= SPECTATOR_MAX_CONCURRENT_REBUILDS) throw new SpectatorRebuildRefused("busy");
            rebuildsInFlight += 1;
            slot = true;
          }
        }
        let snapshot: TournamentSnapshot | null;
        try {
          // L'instantané repasse de toute façon par la porte de visibilité :
          // chaud ou froid, un tournoi non publié rend `null`.
          snapshot = await getVisibleTournamentSnapshot(tournamentId);
        } finally {
          if (slot) rebuildsInFlight -= 1;
        }
        // Un « introuvable » **n'entre pas** dans le cache : `cached` ne garde
        // jamais un échec. Des identifiants parcourus au hasard n'y chassent donc
        // pas les clés chaudes (500 entrées, partagées avec tout le site), et un
        // tournoi publié une seconde plus tard s'ouvre aussitôt.
        if (!snapshot) throw new SpectatorNotFound();
        // Une seule sérialisation. La version des membres en sort (elle bouge avec
        // les champs retirés) : l'empreinte du corps public la remplace, et ne
        // voyage que dans l'en-tête `ETag` — le relecteur ne lit pas `version`.
        const publicSnapshot = { ...spectatorSnapshot(snapshot), version: "" };
        const body = JSON.stringify(publicSnapshot);
        return {
          version: createHash("sha256").update(body).digest("base64url").slice(0, 22),
          state: snapshot.card.state,
          body,
          ttlMs: spectatorCacheTtlMs(level, snapshot.card.state),
          snapshot: publicSnapshot,
        };
      },
      {
        retainMs: SPECTATOR_MAX_COPY_AGE_MS,
        // Seulement quand cet appel lance le calcul : qui le rejoint en vol ne
        // paie rien, et le jeton est pris sans écart avec le lancement.
        beforeLoad: () => {
          membersWarm = isTournamentSnapshotWarm(tournamentId);
          if (membersWarm) return;
          const refused = takeRateToken(SPECTATOR_REBUILD_RULE, client);
          if (refused) throw new SpectatorRebuildRefused("rate", refused);
          charged = true;
        },
      },
    );
  } catch (error) {
    // Rien n'a été construit (introuvable, panne, places prises) : le jeton
    // revient — seule une reconstruction réussie se paie.
    if (charged) refundRateToken(SPECTATOR_REBUILD_RULE, client);
    if (error instanceof SpectatorNotFound) return null;
    throw error;
  }
}

/**
 * Le tournoi tel que le voit le public, pour une page rendue sans session
 * (encart d'un lien, réglages de la page des règles) : la même réponse
 * mutualisée, au même prix pour le réseau qui la demande. `null` : introuvable,
 * reconstruction refusée sans copie récente, ou base injoignable — l'appelant
 * se rabat sur sa version générale.
 */
export async function publicTournamentSnapshot(
  tournamentId: number,
  level: SpectatorLoadLevel,
  client: string | null,
): Promise<TournamentSnapshot | null> {
  try {
    return (await getSpectatorPayload(tournamentId, level, client))?.snapshot ?? null;
  } catch (error) {
    if (error instanceof SpectatorRebuildRefused) return staleSpectatorPayload(tournamentId)?.snapshot ?? null;
    return null;
  }
}

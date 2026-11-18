/**
 * Mode de synchronisation affiché sur la fiche d'un tournoi.
 *
 * Il ne **décide** rien : la cadence se décide dans `refresh-tiers.ts` (palier
 * accordé par le serveur) et le régime de charge dans `client-power.ts`. Ce
 * module les range en **un seul** libellé pour le lecteur, selon l'ordre de ce
 * qui compte le plus :
 *
 * 1. échec définitif (session expirée, tournoi supprimé) : aucun mode — le
 *    témoin de flux dit déjà « Hors ligne » ;
 * 2. flux non établi : `POLLING`, la page relit seule (sondage de secours) ;
 * 3. onglet caché : `SLEEP` ;
 * 4. rencontre du lecteur en cours : `MATCH` ;
 * 5. page sans animation (sans focus, machine à la peine, mouvement réduit) :
 *    `ECO` ;
 * 6. sinon le palier : `PRIORITY` (staff, cast, engagés hors match) ou
 *    `STANDARD` (spectateurs).
 *
 * `ECO` ne change pas la cadence reçue, seulement ce que la page peint : le
 * palier garde sa cadence, que le texte du mode énonce.
 *
 * Module pur : aucune dépendance au navigateur ni au serveur.
 */
import type { ClientPowerMode } from "./client-power";
import type { RefreshTier } from "./refresh-tiers";

export type SyncMode = "PRIORITY" | "STANDARD" | "MATCH" | "ECO" | "SLEEP" | "POLLING";

/** Tous les modes, dans l'ordre où l'aide les énumère. */
export const SYNC_MODES: readonly SyncMode[] = ["PRIORITY", "STANDARD", "MATCH", "ECO", "SLEEP", "POLLING"];

export type SyncModeInput = {
  /** Palier accordé par le serveur (`useTournamentLive`). */
  tier: RefreshTier;
  /** Régime de charge du navigateur (`resolvePowerMode`). */
  power: ClientPowerMode;
  /** Le flux est établi (ou, sans compte, la dernière lecture a réussi). */
  isLive: boolean;
  /** Échec définitif : la page a cessé de réessayer. */
  fatal: boolean;
};

/** Mode courant, `null` après un échec définitif. */
export function resolveSyncMode(input: SyncModeInput): SyncMode | null {
  if (input.fatal) return null;
  if (!input.isLive) return "POLLING";
  if (input.power === "SLEEP") return "SLEEP";
  if (input.power === "MATCH") return "MATCH";
  if (input.power === "ECO") return "ECO";
  return input.tier === "PRIORITY" ? "PRIORITY" : "STANDARD";
}

/** Les modes autres que `mode`, dans l'ordre de {@link SYNC_MODES}. */
export function otherSyncModes(mode: SyncMode): SyncMode[] {
  return SYNC_MODES.filter((candidate) => candidate !== mode);
}

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
 * 2. flux non établi (page avec compte) : `POLLING`, la page relit seule
 *    (sondage de secours) ;
 * 3. onglet caché : `SLEEP` ;
 * 4. rencontre en cours ou imminente du lecteur (dans cet onglet ou un autre) :
 *    `MATCH` ;
 * 5. page sans animation (sans focus, machine à la peine, mouvement réduit) :
 *    `ECO` ;
 * 6. sinon le palier : `PRIORITY` (staff, cast, engagés hors match) ou
 *    `STANDARD` (spectateurs).
 *
 * La page sans compte (`POLL`) n'a pas de flux : elle relit le tournoi à
 * cadence fixe, et un échec passager n'y change pas de mode (le témoin dit
 * « Hors ligne »). Elle ne connaît ni `PRIORITY` ni `POLLING`.
 *
 * `ECO` et `MATCH` ne changent pas le palier reçu, seulement ce que la page
 * peint : le texte du mode le dit (`syncModeTierNote`).
 *
 * Module pur : aucune dépendance au navigateur ni au serveur.
 */
import type { ClientPowerMode } from "./client-power";
import type { RefreshTier } from "./refresh-tiers";

export type SyncMode = "PRIORITY" | "STANDARD" | "MATCH" | "ECO" | "SLEEP" | "POLLING";

/** Tous les modes, dans l'ordre où l'aide les énumère. */
export const SYNC_MODES: readonly SyncMode[] = ["PRIORITY", "STANDARD", "MATCH", "ECO", "SLEEP", "POLLING"];

/**
 * Modes que l'aide de la page sans compte énumère. `MATCH` n'y vient que d'un
 * autre onglet (bail partagé) : il se dit quand il est là, sans s'annoncer.
 */
export const POLL_SYNC_MODES: readonly SyncMode[] = ["STANDARD", "ECO", "SLEEP"];

/**
 * D'où vient la donnée : le flux SSE de l'espace connecté (`useTournamentLive`)
 * ou la relecture périodique de la page sans compte (`useSpectatorTournament`).
 */
export type SyncSource = "STREAM" | "POLL";

export type SyncModeInput = {
  /** Palier accordé par le serveur au lecteur (hors flux calmé, `useTournamentLive`). */
  tier: RefreshTier;
  /** Régime de charge du navigateur (`resolvePowerMode`). */
  power: ClientPowerMode;
  /** Le flux est établi (ou, sans compte, la dernière lecture a réussi). */
  isLive: boolean;
  /** Échec définitif : la page a cessé de réessayer. */
  fatal: boolean;
  source: SyncSource;
  /**
   * Le lecteur a une rencontre en cours ou imminente **dans ce tournoi**
   * (`viewerMatchFocus`). Le régime `MATCH` peut aussi venir d'un autre onglet
   * (bail partagé) : le texte le dit alors.
   */
  viewerMatch: boolean;
};

/** Mode courant, `null` après un échec définitif. */
export function resolveSyncMode(input: SyncModeInput): SyncMode | null {
  if (input.fatal) return null;
  if (input.source === "STREAM" && !input.isLive) return "POLLING";
  if (input.power === "SLEEP") return "SLEEP";
  if (input.power === "MATCH") return "MATCH";
  if (input.power === "ECO") return "ECO";
  return input.source === "STREAM" && input.tier === "PRIORITY" ? "PRIORITY" : "STANDARD";
}

/** Variante du texte « mode courant » (`live.sync.modes.<mode>.<variante>`). */
export type SyncModeTextKey = "now" | "nowPoll" | "nowElsewhere";

/** Le texte qui dit vrai pour ce lecteur, sur cette page. */
export function syncModeTextKey(mode: SyncMode, input: Pick<SyncModeInput, "source" | "viewerMatch">): SyncModeTextKey {
  if (mode === "MATCH" && !input.viewerMatch) return "nowElsewhere";
  if (input.source === "POLL" && (mode === "STANDARD" || mode === "SLEEP")) return "nowPoll";
  return "now";
}

/**
 * Le régime `MATCH` regroupe, sans focus, l'affichage de ce que le flux apporte
 * (`MATCH_BACKGROUND_RENDER_DELAY_MS`), sauf le match du lecteur : à dire sur la
 * page avec compte. La page sans compte n'a pas de flux, rien n'y est regroupé.
 */
export function syncModeBatchNote(mode: SyncMode, source: SyncSource): boolean {
  return mode === "MATCH" && source === "STREAM";
}

/** Variante du texte d'un autre mode, dans la liste de l'aide. */
export type SyncModeOtherKey = "other" | "otherPoll";

export function syncModeOtherKey(mode: SyncMode, source: SyncSource): SyncModeOtherKey {
  return source === "POLL" && (mode === "STANDARD" || mode === "SLEEP") ? "otherPoll" : "other";
}

/**
 * Palier conservé sous un régime qui ne touche que la peinture (`MATCH`, `ECO`),
 * sur la page avec compte ; `null` sinon (la veille calme le flux, la relecture
 * et les paliers se disent eux-mêmes).
 */
export function syncModeTierNote(mode: SyncMode, input: Pick<SyncModeInput, "source" | "tier">): RefreshTier | null {
  if (input.source !== "STREAM") return null;
  return mode === "MATCH" || mode === "ECO" ? input.tier : null;
}

/**
 * Les autres modes que ce lecteur peut rencontrer sur cette page, dans l'ordre
 * de {@link SYNC_MODES} : sans le mode courant, ni le palier qu'il conserve
 * (`syncModeTierNote` le dit déjà) ; la page sans compte ne liste que les siens.
 */
export function otherSyncModes(mode: SyncMode, input: Pick<SyncModeInput, "source" | "tier">): SyncMode[] {
  const kept = syncModeTierNote(mode, input);
  const reachable = input.source === "POLL" ? POLL_SYNC_MODES : SYNC_MODES;
  return reachable.filter((candidate) => candidate !== mode && candidate !== kept);
}

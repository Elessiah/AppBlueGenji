/**
 * BlueGenji Survie — barème d'endurance d'un tournoi et sa normalisation
 * (`docs/features/BG_SURVIE_MODE.md`).
 *
 * Module pur : aucune dépendance base de données.
 */

/** Barème d'endurance d'un tournoi. */
export type EnduranceConfig = {
  /** Capital de départ (défaut 9). */
  startPoints: number;
  /** Points gagnés par **map** gagnée (défaut 1). */
  winDelta: number;
  /** Points perdus par **map** perdue (défaut 1). */
  lossDelta: number;
  /** Effectif de la phase éliminatoire (défaut 8). */
  playoffSize: number;
  /**
   * Nombre maximal de manches qualificatives. `null` = aucune limite : la
   * phase court jusqu'à ce que l'effectif retombe à `playoffSize`, seul
   * comportement qu'aient connu les tournois d'avant ce réglage.
   *
   * Fixé, il change la nature de la phase : elle s'arrête à la manche dite, et
   * les `playoffSize` premières du classement sont qualifiées — même si elles
   * sont encore trente.
   */
  maxRounds: number | null;
  /**
   * Sortie « hors course » anticipée (`OUT_OF_CONTENTION`) : sous plafond de
   * manches, écarter avant la fin une équipe qui ne peut plus mathématiquement
   * rejoindre le plateau. **Désactivée par défaut** — option du tournoi
   * (`endurance_early_exit`). Désactivée, les équipes restent en lice jusqu'à
   * la fin normale de la phase (capital à zéro, effectif retombé à la cible ou
   * dernière manche du plafond, où le trait sous la cible tombe comme avant).
   * Sans plafond, l'option n'a aucun effet.
   */
  earlyExit: boolean;
};

export const DEFAULT_ENDURANCE_CONFIG: EnduranceConfig = {
  startPoints: 9,
  winDelta: 1,
  lossDelta: 1,
  playoffSize: 8,
  maxRounds: null,
  earlyExit: false,
};

/** Normalise un barème partiel (valeurs manquantes ou absurdes → défauts). */
export function resolveEnduranceConfig(input?: Partial<EnduranceConfig> | null): EnduranceConfig {
  const start = Number(input?.startPoints);
  const win = Number(input?.winDelta);
  const loss = Number(input?.lossDelta);
  const playoff = Number(input?.playoffSize);
  const maxRounds = Number(input?.maxRounds);

  return {
    startPoints: Number.isFinite(start) && start > 0 ? Math.floor(start) : DEFAULT_ENDURANCE_CONFIG.startPoints,
    winDelta: Number.isFinite(win) && win > 0 ? Math.floor(win) : DEFAULT_ENDURANCE_CONFIG.winDelta,
    lossDelta: Number.isFinite(loss) && loss > 0 ? Math.floor(loss) : DEFAULT_ENDURANCE_CONFIG.lossDelta,
    playoffSize:
      Number.isFinite(playoff) && playoff >= 2 ? Math.floor(playoff) : DEFAULT_ENDURANCE_CONFIG.playoffSize,
    // Une limite absurde (0, négative, absente) n'est pas une limite : le mode
    // retombe alors sur la phase à durée libre, son comportement d'origine.
    maxRounds: Number.isFinite(maxRounds) && maxRounds >= 1 ? Math.floor(maxRounds) : null,
    // Seul `true` active la sortie anticipée : une valeur absente ou douteuse
    // retombe sur le défaut, l'option décochée.
    earlyExit: input?.earlyExit === true,
  };
}

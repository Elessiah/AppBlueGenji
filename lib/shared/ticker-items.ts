/**
 * Entrées du bandeau défilant (`components/cyber/Ticker.tsx`).
 *
 * Une entrée est une phrase toute faite, ou un **résultat** dont le bandeau
 * habille chaque camp : le vainqueur et le perdant n'ont pas la même teinte,
 * le score ressort, et un texte masqué dit qui a gagné aux lecteurs d'écran
 * (la couleur n'est jamais le seul repère). Les textes arrivent rédigés dans
 * la langue de la page : le composant n'en connaît aucun.
 * Détail : `docs/features/TICKER_RESULTS.md`.
 */

import { forfeitMapCount, type MatchFormat } from "./match-format";
import { isMatchDoubleForfeit, isMatchDrawn } from "./match-outcome";

/**
 * Issue d'un camp : `win` / `loss` d'un match tranché sur le jeu, `forfeit`
 * pour un camp forfait (un forfait n'est pas une défaite : teinte neutre),
 * `none` quand le match n'a pas de vainqueur (nul).
 */
export type TickerOutcome = "win" | "loss" | "forfeit" | "none";

/** Un camp d'un résultat : son nom affiché, son score, son issue. */
export type TickerResultSide = {
  readonly name: string;
  /** Score enregistré ; `null` pour un double forfait, qui n'en a pas (`DOUBLE_FORFEIT.md`). */
  readonly score: string | null;
  readonly outcome: TickerOutcome;
  /** Issue dite au lecteur d'écran (« vainqueur », « forfait »…), `null` sans issue propre ; « forfait » se lit aussi à l'écran. */
  readonly sr: string | null;
};

/** Un résultat de match : « RÉSULTAT · Tournoi · » puis les deux camps, dans l'ordre du match. */
export type TickerResultItem = {
  readonly kind: "result";
  readonly lead: string;
  readonly sides: readonly [TickerResultSide, TickerResultSide];
  /** Note de fin pour un match sans vainqueur (« sans vainqueur »), dite au lecteur d'écran seul. */
  readonly sr: string | null;
};

/** Le champion d'un tournoi terminé : « VAINQUEUR · Tournoi · » puis son nom. */
export type TickerChampionItem = {
  readonly kind: "champion";
  readonly lead: string;
  readonly name: string;
  /** Faux pour « Champion inconnu » : rien à mettre en valeur. */
  readonly known: boolean;
};

export type TickerItem = string | TickerResultItem | TickerChampionItem;

/** Ce qu'un match terminé dit de son issue (colonnes de `bg_matches`). */
export type TickerMatchOutcomeInput = {
  readonly team1Id: number | null;
  readonly team2Id: number | null;
  readonly winnerTeamId: number | null;
  readonly forfeitTeamId: number | null;
  readonly doubleForfeit: boolean;
};

/**
 * Issue de chaque camp, lue sur le **résultat enregistré** (`winner_team_id`,
 * `forfeit_team_id`, `double_forfeit`) — jamais devinée d'après les scores.
 * Bâtie sur `lib/shared/match-outcome.ts` (double forfait, nul), comme les
 * fiches : une seule règle d'issue. La requête du bandeau ne retient que des
 * matchs entre deux engagés (`team1_id` et `team2_id` non nuls).
 *
 * - double forfait : deux camps forfaits ;
 * - **vainqueur enregistré** désignant un camp : il est suivi, l'arbre et le
 *   classement le suivent aussi ; le forfait nominatif ne sert alors qu'à
 *   marquer l'*autre* camp « forfait » (et non « perdant ») ;
 * - donnée incohérente, forfait nominatif **sur le camp vainqueur** : un camp
 *   forfait n'a pas gagné — il est dit « forfait », la victoire va à l'autre
 *   (sans quoi le forfaitaire s'affichait « ✓ » et l'autre « perdant ») ;
 * - sans vainqueur propre au match, un forfait nominatif donne la victoire à
 *   son adversaire ;
 * - sinon (nul, vainqueur étranger au match) : deux `none`.
 */
export function tickerOutcomes(match: TickerMatchOutcomeInput): readonly [TickerOutcome, TickerOutcome] {
  const shape = { status: "COMPLETED" as const, ...match };
  if (isMatchDoubleForfeit(shape)) return ["forfeit", "forfeit"];
  if (isMatchDrawn(shape)) return ["none", "none"];
  const sideOf = (teamId: number | null): 0 | 1 | null => {
    if (teamId === null) return null;
    if (teamId === match.team1Id) return 0;
    return teamId === match.team2Id ? 1 : null;
  };
  const winnerSide = sideOf(match.winnerTeamId);
  const forfeitSide = sideOf(match.forfeitTeamId);
  const outcomes: [TickerOutcome, TickerOutcome] = ["none", "none"];
  // Un forfait nominatif l'emporte sur un vainqueur qui désigne le même camp, ou
  // sur l'absence de vainqueur propre au match : son adversaire gagne.
  if (forfeitSide !== null && (winnerSide === null || winnerSide === forfeitSide)) {
    outcomes[forfeitSide] = "forfeit";
    outcomes[forfeitSide === 0 ? 1 : 0] = "win";
  } else if (winnerSide !== null) {
    const other = winnerSide === 0 ? 1 : 0;
    outcomes[winnerSide] = "win";
    outcomes[other] = forfeitSide === other ? "forfeit" : "loss";
  }
  return outcomes;
}

/** Scores enregistrés d'un match terminé, avec le format de son tournoi. */
export type TickerMatchScoreInput = TickerMatchOutcomeInput & {
  readonly score1: number | null;
  readonly score2: number | null;
  /** Format du tournoi (`parseMatchFormat`), `null` en saisie libre. */
  readonly format: MatchFormat | null;
};

/**
 * Scores affichés : un double forfait n'a **aucun** score
 * (`DOUBLE_FORFEIT.md` — pas de « 0 — 0 », même si une ancienne ligne en garde
 * un) ; un forfait se chiffre au score plein du format du tournoi (FT3 → 3-0,
 * `forfeitMapCount`) quand les colonnes sont vides ou à 0-0 (forfaits
 * antérieurs à la règle) ; un score de forfait déjà écrit, qui suit le format
 * de sa phase (play-offs d'une BG Survie), est gardé tel quel — le bandeau
 * affiche donc 2-0 là où la fiche, qui recalcule toujours le score plein du
 * format du tournoi (`forfeitAwareMapScore`), dit 3-0. Sinon, les colonnes.
 */
export function tickerScores(match: TickerMatchScoreInput): readonly [number | null, number | null] {
  if (match.doubleForfeit) return [null, null];
  const [left, right] = tickerOutcomes(match);
  if (left === "forfeit" || right === "forfeit") {
    // Score de forfait déjà écrit (`adminResolveMatch`, format de la phase) :
    // on le garde. Le format du tournoi ne chiffre que les anciennes lignes vides.
    const written = match.score1 !== null && match.score2 !== null && (match.score1 > 0 || match.score2 > 0);
    if (written) return [Number(match.score1), Number(match.score2)];
    const maps = forfeitMapCount(match.format);
    return left === "forfeit" ? [0, maps] : [maps, 0];
  }
  return [Number(match.score1 ?? 0), Number(match.score2 ?? 0)];
}

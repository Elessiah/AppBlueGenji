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
 * Double forfait : deux camps forfaits. Un forfait nominatif se lit **avant**
 * le vainqueur : son adversaire l'emporte, même si la colonne du vainqueur est
 * vide ou fausse. Sans vainqueur enregistré : nul.
 */
export function tickerOutcomes(match: TickerMatchOutcomeInput): readonly [TickerOutcome, TickerOutcome] {
  if (match.doubleForfeit) return ["forfeit", "forfeit"];
  if (match.forfeitTeamId !== null) {
    if (match.forfeitTeamId === match.team1Id) return ["forfeit", "win"];
    if (match.forfeitTeamId === match.team2Id) return ["win", "forfeit"];
  }
  const winner = match.winnerTeamId;
  if (winner === null || (winner !== match.team1Id && winner !== match.team2Id)) return ["none", "none"];
  const side = (teamId: number | null): TickerOutcome => {
    // Case vide (exemption, engagé retiré) : personne n'y a perdu.
    if (teamId === null) return "none";
    return teamId === winner ? "win" : "loss";
  };
  return [side(match.team1Id), side(match.team2Id)];
}

/** Scores enregistrés d'un match terminé, avec le format de son tournoi. */
export type TickerMatchScoreInput = TickerMatchOutcomeInput & {
  readonly score1: number | null;
  readonly score2: number | null;
  /** Format du tournoi (`parseMatchFormat`), `null` en saisie libre. */
  readonly format: MatchFormat | null;
};

/**
 * Scores affichés, comme sur les fiches (`forfeitAwareMapScore`) : un double
 * forfait n'a **aucun** score (`DOUBLE_FORFEIT.md` — pas de « 0 — 0 », même si
 * une ancienne ligne en garde un) ; un forfait se chiffre au score plein du
 * format (FT3 → 3-0, `forfeitMapCount`) quand les colonnes sont vides ou à
 * 0-0 (forfaits antérieurs à la règle) ; un score de forfait déjà écrit, qui
 * suit le format de sa phase (play-offs d'une BG Survie), est gardé. Sinon,
 * les colonnes.
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

/** Texte brut d'une entrée (tests) : amorce, noms et scores, sans les repères « ▲ » / « ▼ » ni les mots d'issue. */
export function tickerItemText(item: TickerItem): string {
  if (typeof item === "string") return item;
  if (item.kind === "champion") return `${item.lead} ${item.name}`;
  const [left, right] = item.sides;
  const side = (s: TickerResultSide) => (s.score === null ? s.name : `${s.name} ${s.score}`);
  return `${item.lead} ${side(left)} — ${side(right)}`;
}

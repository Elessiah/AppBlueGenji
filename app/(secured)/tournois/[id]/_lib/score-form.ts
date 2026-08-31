import type { BracketMatch } from "@/lib/shared/types";
import {
  checkMatchScores,
  matchScoreViolationMessage,
  type MatchFormat,
} from "@/lib/shared/match-format";

export interface ScoreFormState {
  score1: string;
  score2: string;
  forfeitTeamId?: number;
}

/**
 * Valeurs d'ouverture du dialogue d'édition : le score **du match ouvert**, et
 * des champs **vides** quand il n'a jamais été saisi.
 *
 * Le vide n'est pas cosmétique. Un match jamais joué n'a pas de score, et
 * afficher « 0 – 0 » en inventait un : le bouton d'enregistrement s'activait
 * seul, et un clic malheureux écrivait un vrai 0-0 en base. Or `hasScoreInput`
 * (`lib/shared/match-lock.ts`) compte « un score même nul » comme une saisie —
 * ce 0-0 accidentel **verrouillait définitivement la manche précédente**. Un
 * champ vide ne peut pas être envoyé par mégarde : `decideScoreForm` le refuse.
 *
 * Isolé du hook pour rester testable — c'est la source du remplissage, le hook
 * se chargeant de le rejouer à chaque changement de match.
 */
export function scoreFormStateFor(match: BracketMatch | null): ScoreFormState {
  return {
    score1: match?.team1Score !== null && match?.team1Score !== undefined ? String(match.team1Score) : "",
    score2: match?.team2Score !== null && match?.team2Score !== undefined ? String(match.team2Score) : "",
    forfeitTeamId: match?.forfeitTeamId ?? undefined,
  };
}

/**
 * Lecture d'un champ de score. `null` couvre les trois refus — champ vide, texte
 * non numérique (un `input[type=number]` laisse passer « e » et « + »), entier
 * négatif ou décimal — parce qu'ils appellent tous la même réponse : il n'y a
 * pas de score à envoyer.
 */
export function parseScoreInput(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  if (!/^\d+$/.test(trimmed)) return null;

  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

/**
 * Empreinte du résultat **enregistré** d'un match. Sert à repérer qu'il a bougé
 * sous les doigts du lecteur — un autre membre du staff a saisi le score
 * pendant que le dialogue était ouvert, et le flux SSE vient de l'apporter.
 *
 * On y met tout ce que le dialogue édite ou affiche, statut compris : un report
 * d'équipe passé en attente de confirmation change ce qui se joue à l'écran
 * sans toucher aux scores.
 */
export function storedResultSignature(match: BracketMatch | null): string {
  if (!match) return "";
  return [
    match.id,
    match.team1Score ?? "∅",
    match.team2Score ?? "∅",
    match.forfeitTeamId ?? "∅",
    match.winnerTeamId ?? "∅",
    match.status,
  ].join("|");
}

/** Le formulaire est-il resté sur les valeurs du match, sans une saisie ? */
export function isUntouched(state: ScoreFormState, match: BracketMatch | null): boolean {
  const pristine = scoreFormStateFor(match);
  return (
    state.score1 === pristine.score1 &&
    state.score2 === pristine.score2 &&
    state.forfeitTeamId === pristine.forfeitTeamId
  );
}

/**
 * Pourquoi une action est refusée. Un code plutôt qu'une phrase : le module
 * reste pur et testable, `scoreBlockerMessage` habille ensuite avec les
 * chiffres du format du tournoi.
 */
export type ScoreFormBlocker =
  | "INCOMPLETE"
  | "EXCEEDS_FORMAT"
  | "BELOW_FORMAT"
  | "DRAW"
  | "ALREADY_DECIDED";

export interface ScoreFormDecision {
  /** Scores prêts à envoyer, ou `null` quand la saisie n'est pas exploitable. */
  scores: { team1: number; team2: number } | null;
  /** Enregistrer sans trancher — l'arbitrage note un 1-0 en cours de rencontre. */
  canSave: boolean;
  /** Trancher : désigner le vainqueur et propager dans le plateau. */
  canResolve: boolean;
  saveBlocker: ScoreFormBlocker | null;
  resolveBlocker: ScoreFormBlocker | null;
}

/**
 * Ce que le formulaire autorise, dans son état courant.
 *
 * Deux règles portent tout le reste :
 *
 * · **Le plafond suffit pour enregistrer, l'objectif est exigé pour trancher.**
 *   C'est la règle du serveur (`checkMatchScores`, option `decisive`) : noter un
 *   1-0 pendant que le match se joue est légitime, désigner un vainqueur à 1-0
 *   en BO5 ne l'est pas.
 *
 * · **Un match déjà tranché ne s'enregistre plus, il se re-tranche.** La route
 *   d'enregistrement n'écrit que `team1_score`/`team2_score` : appliquée à un
 *   match terminé, elle laissait `winner_team_id` sur l'ancienne gagnante et le
 *   plateau sur l'ancienne qualifiée — un match affiché 2-1 pour l'équipe qui
 *   perd. La correction d'un résultat acquis passe donc par « Valider le
 *   résultat », qui recalcule le vainqueur et repropage. Même refus côté
 *   serveur (`MATCH_ALREADY_COMPLETED`).
 */
export function decideScoreForm(
  state: ScoreFormState,
  options: { format: MatchFormat | null; decided: boolean },
): ScoreFormDecision {
  const { format, decided } = options;

  // Le forfait remplace le score : il désigne le vainqueur à lui seul, sans
  // manche jouée, et n'a donc rien à respecter du format.
  if (state.forfeitTeamId !== undefined) {
    return {
      scores: null,
      canSave: !decided,
      canResolve: true,
      saveBlocker: decided ? "ALREADY_DECIDED" : null,
      resolveBlocker: null,
    };
  }

  const team1 = parseScoreInput(state.score1);
  const team2 = parseScoreInput(state.score2);

  if (team1 === null || team2 === null) {
    return {
      scores: null,
      canSave: false,
      canResolve: false,
      saveBlocker: "INCOMPLETE",
      resolveBlocker: "INCOMPLETE",
    };
  }

  const scores = { team1, team2 };
  const overCap = checkMatchScores(format, team1, team2, { decisive: false });

  if (overCap) {
    return {
      scores,
      canSave: false,
      canResolve: false,
      saveBlocker: "EXCEEDS_FORMAT",
      resolveBlocker: "EXCEEDS_FORMAT",
    };
  }

  const decisive = checkMatchScores(format, team1, team2, { decisive: true });
  const resolveBlocker: ScoreFormBlocker | null =
    team1 === team2 ? "DRAW" : decisive ? "BELOW_FORMAT" : null;

  return {
    scores,
    canSave: !decided,
    canResolve: resolveBlocker === null,
    saveBlocker: decided ? "ALREADY_DECIDED" : null,
    resolveBlocker,
  };
}

/**
 * Phrase affichée sous le bouton refusé. Les deux violations de format
 * réutilisent le message chiffré partagé avec le report d'équipe, pour que
 * l'arbitrage et les engagés lisent exactement la même règle.
 */
export function scoreBlockerMessage(
  blocker: ScoreFormBlocker,
  format: MatchFormat | null,
): string {
  switch (blocker) {
    case "INCOMPLETE":
      return "Renseigne les deux scores.";
    case "EXCEEDS_FORMAT":
      return matchScoreViolationMessage(format, "SCORE_EXCEEDS_MATCH_FORMAT");
    case "BELOW_FORMAT":
      return matchScoreViolationMessage(format, "SCORE_BELOW_MATCH_FORMAT");
    case "DRAW":
      return "Les scores ne peuvent pas être égaux : il faut un vainqueur.";
    case "ALREADY_DECIDED":
      return "Ce match est déjà tranché. Corrige-le avec « Valider le résultat » pour que le vainqueur et la suite du plateau suivent.";
  }
}

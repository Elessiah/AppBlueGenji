import type { BracketMatch } from "@/lib/shared/types";
import {
  checkMatchScores,
  matchScoreViolationMessage,
  type MatchFormat,
} from "@/lib/shared/match-format";
import { isMatchPlayed } from "@/lib/shared/match-outcome";

export interface ScoreFormState {
  score1: string;
  score2: string;
  forfeitTeamId?: number;
  /**
   * Les deux engagées déclarent forfait (`lib/shared/double-forfeit.ts`).
   * Exclusif de `forfeitTeamId` et des scores : le hook garde les deux
   * sélections mutuellement exclusives.
   */
  doubleForfeit?: boolean;
}

/**
 * Proposition de score d'une engagée, restée **seule** en attente de l'autre.
 *
 * Le cas type est la rencontre contre une **équipe fantôme** : personne ne s'y
 * connecte, la confirmation n'arrive donc jamais et c'est l'arbitrage qui doit
 * trancher. Ouvrir le dialogue sur des champs vides l'obligeait à recopier un
 * score déjà saisi par les joueurs ; il s'ouvre désormais sur la proposition,
 * qu'un clic sur « Valider le résultat » confirme.
 *
 * `null` dès que la proposition ne peut pas servir de point de départ :
 * · match déjà tranché, score déjà enregistré par l'arbitrage, forfait posé —
 *   ce qui est en base prime sur ce qu'une équipe a proposé ;
 * · **deux** propositions (un désaccord) — pré-remplir avec l'une donnerait
 *   raison à une équipe sans que l'arbitre l'ait décidé ;
 * · aucune proposition.
 *
 * Le pré-remplissage ne vaut pas validation : rien n'est écrit tant que
 * l'arbitre n'a pas cliqué, et le dialogue dit d'où viennent les chiffres.
 */
export interface PendingScoreProposal {
  team1Score: number;
  team2Score: number;
  /** Engagée qui a proposé le score, dans l'orientation du plateau. */
  proposedBy: "team1" | "team2";
}

export function pendingScoreProposal(match: BracketMatch | null): PendingScoreProposal | null {
  if (!match) return null;
  if (isMatchPlayed(match)) return null;
  if (match.team1Score !== null || match.team2Score !== null) return null;
  if (match.forfeitTeamId !== null || match.doubleForfeit === true) return null;

  const team1Report = match.team1Report ?? null;
  const team2Report = match.team2Report ?? null;
  if ((team1Report === null) === (team2Report === null)) return null;

  const report = team1Report ?? team2Report;
  if (!report) return null;
  return {
    team1Score: report.team1Score,
    team2Score: report.team2Score,
    proposedBy: team1Report ? "team1" : "team2",
  };
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
  const proposal = pendingScoreProposal(match);
  if (proposal) {
    return {
      score1: String(proposal.team1Score),
      score2: String(proposal.team2Score),
      forfeitTeamId: undefined,
      doubleForfeit: undefined,
    };
  }
  return {
    score1: match?.team1Score !== null && match?.team1Score !== undefined ? String(match.team1Score) : "",
    score2: match?.team2Score !== null && match?.team2Score !== undefined ? String(match.team2Score) : "",
    forfeitTeamId: match?.forfeitTeamId ?? undefined,
    doubleForfeit: match?.doubleForfeit === true ? true : undefined,
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
    match.doubleForfeit ? "FF2" : "∅",
    match.winnerTeamId ?? "∅",
    match.status,
  ].join("|");
}

/**
 * Empreinte des **propositions d'équipe** en attente. Distincte du résultat
 * enregistré : une proposition arrivée pendant que le dialogue est ouvert
 * change ses valeurs d'ouverture, mais n'écrit rien — elle ne doit pas lever
 * l'alerte « un autre arbitre a enregistré un résultat ».
 */
export function pendingProposalSignature(match: BracketMatch | null): string {
  if (!match) return "";
  return [reportSignature(match.team1Report), reportSignature(match.team2Report)].join("|");
}

function reportSignature(report: BracketMatch["team1Report"] | undefined): string {
  return report ? `${report.team1Score}-${report.team2Score}` : "∅";
}

/** Le formulaire est-il resté sur les valeurs du match, sans une saisie ? */
export function isUntouched(state: ScoreFormState, match: BracketMatch | null): boolean {
  const pristine = scoreFormStateFor(match);
  return (
    state.score1 === pristine.score1 &&
    state.score2 === pristine.score2 &&
    state.forfeitTeamId === pristine.forfeitTeamId &&
    (state.doubleForfeit === true) === (pristine.doubleForfeit === true)
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
  | "ALREADY_DECIDED"
  | "DOUBLE_FORFEIT";

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

  // Le double forfait tranche la rencontre à lui seul — sans score ni
  // vainqueur —, il n'y a donc rien à « enregistrer en cours de match » : seule
  // la validation l'écrit, et elle seule propage dans le plateau.
  if (state.doubleForfeit === true) {
    return {
      scores: null,
      canSave: false,
      canResolve: true,
      saveBlocker: "DOUBLE_FORFEIT",
      resolveBlocker: null,
    };
  }

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

  // `checkMatchScores` porte **toute** la règle, égalité comprise : c'est lui
  // qui sait qu'une qualification de « BlueGenji Survie » peut se clore sur un
  // 2-2, et un second test `team1 === team2` posé ici aurait rouvert le refus
  // que le format vient d'ouvrir — l'interface et le serveur auraient divergé.
  const decisive = checkMatchScores(format, team1, team2, { decisive: true });
  const resolveBlocker: ScoreFormBlocker | null =
    decisive === "DRAW_NOT_ALLOWED"
      ? "DRAW"
      : decisive === "SCORE_BELOW_MATCH_FORMAT"
        ? "BELOW_FORMAT"
        : decisive
          ? "EXCEEDS_FORMAT"
          : null;

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
    case "DOUBLE_FORFEIT":
      return "Un double forfait tranche le match : il s'écrit avec « Valider le résultat ».";
    case "ALREADY_DECIDED":
      return "Ce match est déjà tranché. Corrige-le avec « Valider le résultat » pour que le vainqueur et la suite du plateau suivent.";
  }
}

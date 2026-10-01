"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Pill } from "@/components/cyber";
import { useToast } from "@/components/ui/toast";
import type { BracketMatch, MatchScoreReport } from "@/lib/shared/types";
import { useBackdropDismiss } from "@/lib/shared/hooks/useBackdropDismiss";
import { useDialogBehavior } from "@/lib/shared/hooks/useDialogBehavior";
import {
  forfeitMapCount,
  matchFormatDescription,
  matchFormatLabel,
  matchWinsRequired,
} from "@/lib/shared/match-format";
import { isMyTeamTeam1, scoreSubmittedMessage, teamLabel } from "@/lib/shared/match-card-viewer";
import {
  playerReportInitialScores,
  enteredScoreRelation,
  playerReportView,
  toReporterScores,
} from "@/lib/shared/player-score-report";
import { decideScoreForm, parseScoreInput, scoreBlockerMessage } from "../_lib/score-form";
import { useMatchFormat } from "../_lib/match-format-context";
import { useLiveControls } from "../_lib/live-context";
import { useMatchLaunchPhase } from "@/lib/shared/hooks/useMatchLaunchPhase";
import { playerScoreClosedNotice } from "@/lib/shared/match-planning";
import { formatMatchStartAtFull } from "@/lib/shared/match-schedule";
import { mapError } from "../_lib/error-map";
import { ScoreStepper } from "./ScoreStepper";
import styles from "./ScoreDialog.module.css";

interface PlayerScoreDialogProps {
  tournamentId: number;
  /** Match **résolu à chaque rendu** depuis la liste rafraîchie par le flux. */
  match: BracketMatch;
  /** Engagé du lecteur — son équipe, ou son entrée solo. */
  myTeamId: number;
  /** Le match est lancé : le score peut se saisir (`canPlayersReportScore`). */
  canReportScore: boolean;
  /** Qualité pour déclarer forfait au nom de l'engagé (`OWNER` / `MANAGER`). */
  canForfeit: boolean;
  onClose: () => void;
  onSubmitted: () => void;
}

/** Empreinte des propositions en attente : ce que le flux peut changer sous la saisie. */
function reportsSignature(match: BracketMatch): string {
  const one = (r: MatchScoreReport | null) => (r ? `${r.team1Score}-${r.team2Score}` : "∅");
  return `${match.id}|${one(match.team1Report)}|${one(match.team2Report)}`;
}

function scoreText(report: MatchScoreReport): string {
  return `${report.team1Score} – ${report.team2Score}`;
}

/** Heure d'échéance du délai de confirmation, dans le fuseau du lecteur. */
function deadlineText(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

/**
 * Saisie du score d'un match **par un engagé** — le pendant joueur
 * d'`AdminScoreDialog`, avec lequel il partage la mise en page, le stepper et
 * la règle de format (`decideScoreForm`).
 *
 * Ce que l'arbitrage n'a pas, et qui fait tout le cycle : les **propositions**.
 * Un score envoyé ici n'écrit pas le résultat, il le propose ; l'adversaire le
 * confirme d'un clic (la modale s'ouvre sur sa proposition), ou en saisit un
 * autre — ce qui alerte l'arbitrage. Sans réponse, la proposition fait foi à
 * l'échéance du délai. La modale dit donc toujours **où en est le cycle**, ce
 * que l'ancien formulaire en ligne taisait : un score envoyé n'y laissait
 * aucune trace, ni chez qui l'avait envoyé, ni chez qui devait le confirmer.
 *
 * Le **forfait** sur cette manche vit ici aussi, replié : c'est la seule porte
 * joueur vers ce geste. Il s'offre avant même le lancement — l'équipe qui ne
 * pourra pas se présenter le sait avant le coup d'envoi.
 */
export function PlayerScoreDialog({
  tournamentId,
  match,
  myTeamId,
  canReportScore,
  canForfeit,
  onClose,
  onSubmitted,
}: Readonly<PlayerScoreDialogProps>) {
  const { showError, showSuccess } = useToast();
  const matchFormat = useMatchFormat(match);
  // Phase de lancement, pour dire **pourquoi** le score n'est pas encore
  // saisissable (à planifier, en attente de départ, en lancement).
  const { refereeScheduling } = useLiveControls();
  const launchPhase = useMatchLaunchPhase({ ...match, refereeScheduling });
  const [submitting, setSubmitting] = useState(false);
  const dialogRef = useDialogBehavior({ open: true, onClose, locked: submitting });
  const backdrop = useBackdropDismiss(onClose, submitting);
  const [forfeitOpen, setForfeitOpen] = useState(false);

  const view = playerReportView(match, myTeamId);
  const myTeamIsTeam1 = isMyTeamTeam1(myTeamId, match.team1Id);
  const team1 = teamLabel(match.team1Name, match.team1Placeholder, "Équipe 1");
  const team2 = teamLabel(match.team2Name, match.team2Placeholder, "Équipe 2");
  const [myName, opponentName] = myTeamIsTeam1 ? [team1, team2] : [team2, team1];

  const [scores, setScores] = useState(() => playerReportInitialScores(view));
  // Réalignement sur le flux : tant que le lecteur n'a rien touché, une
  // proposition qui arrive (l'adversaire vient d'envoyer la sienne) remplit les
  // champs. Une saisie en cours, elle, n'est jamais écrasée en silence.
  const baseline = useRef(scores);
  const signature = reportsSignature(match);
  useEffect(() => {
    const next = playerReportInitialScores(playerReportView(match, myTeamId));
    setScores((current) =>
      current.score1 === baseline.current.score1 && current.score2 === baseline.current.score2
        ? next
        : current,
    );
    baseline.current = next;
    // `signature` résume exactement ce qui change la valeur d'ouverture.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  const decision = decideScoreForm(scores, { format: matchFormat, decided: false });
  const entered =
    decision.scores === null
      ? null
      : { team1Score: decision.scores.team1, team2Score: decision.scores.team2 };
  // Renvoyer à l'identique la proposition déjà envoyée ne change rien : le
  // bouton le dit plutôt que de réécrire la même ligne.
  const { unchangedMine, confirmsTheirs } = enteredScoreRelation(entered, view);

  const maxScore = matchFormat ? matchWinsRequired(matchFormat) : 99;
  const forfeitMaps = forfeitMapCount(matchFormat);
  const deadline = deadlineText(match.scoreDeadlineAt);

  const submitScore = async () => {
    if (!decision.canResolve || decision.scores === null || submitting || unchangedMine) return;
    const entered1 = decision.scores.team1;
    const entered2 = decision.scores.team2;
    const body = toReporterScores(myTeamIsTeam1, entered1, entered2);
    setSubmitting(true);
    try {
      const response = await fetch(
        `/api/tournaments/${tournamentId}/matches/${match.id}/report`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "SCORE_SUBMIT_FAILED");
      showSuccess(
        confirmsTheirs
          ? `Score confirmé : ${team1} ${entered1} – ${entered2} ${team2}`
          : scoreSubmittedMessage(myTeamIsTeam1, body.myScore, body.opponentScore, team1, team2),
      );
      onSubmitted();
      onClose();
    } catch (error) {
      showError(mapError((error as Error).message));
    } finally {
      setSubmitting(false);
    }
  };

  const submitForfeit = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const response = await fetch(
        `/api/tournaments/${tournamentId}/matches/${match.id}/forfeit`,
        { method: "POST" },
      );
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "MATCH_FORFEIT_FAILED");
      showSuccess(`Forfait enregistré : ${opponentName} remporte le match.`);
      onSubmitted();
      onClose();
    } catch (error) {
      showError(mapError((error as Error).message));
    } finally {
      setSubmitting(false);
    }
  };

  const onSubmitForm = (event: FormEvent) => {
    event.preventDefault();
    void submitScore();
  };

  // État du cycle, en une phrase : c'est ce que le formulaire d'avant ne disait
  // jamais, et la raison pour laquelle un score envoyé semblait « sans effet ».
  const status = (() => {
    if (!view) return null;
    switch (view.phase) {
      case "MINE_PENDING":
        return `Tu as proposé ${scoreText(view.mine!)}. En attente de la confirmation de ${opponentName}${
          deadline ? ` — sans réponse, ce score sera validé à ${deadline}` : ""
        }.`;
      case "THEIRS_PENDING":
        return `${opponentName} propose ${scoreText(view.theirs!)}. Confirme-le, ou saisis le score constaté : un désaccord alerte l'arbitrage.`;
      case "CONFLICT":
        return `Les scores se contredisent — toi : ${scoreText(view.mine!)}, ${opponentName} : ${scoreText(view.theirs!)}. L'arbitrage est alerté ; tu peux encore corriger ta proposition.`;
      default:
        return canReportScore
          ? `${opponentName} devra confirmer le score que tu envoies.`
          : null;
    }
  })();

  const submitLabel = confirmsTheirs ? "Confirmer le score" : "Envoyer le score";
  const blocker = unchangedMine
    ? `Score déjà envoyé : en attente de ${opponentName}.`
    : decision.resolveBlocker
      ? scoreBlockerMessage(decision.resolveBlocker, matchFormat)
      : null;
  // Une saisie partielle n'est pas un refus : la raison ne s'affiche qu'une
  // fois un champ rempli, pour ne pas ouvrir la modale sur un reproche.
  const showBlocker =
    blocker !== null &&
    (unchangedMine ||
      parseScoreInput(scores.score1) !== null ||
      parseScoreInput(scores.score2) !== null);

  return createPortal(
    <div /* NOSONAR S6819 — voile de modale, sans équivalent natif */ className={styles.backdrop} role="presentation" {...backdrop}>
      <div /* NOSONAR S6819 — modale portée dans body (useDialogBehavior) : `<dialog>` changerait couche, Échap et ::backdrop */
        ref={dialogRef}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="player-score-title"
        tabIndex={-1}
      >
        <form onSubmit={onSubmitForm}>
          <div className={styles.head}>
            <div className={styles.headText}>
              <h3 id="player-score-title" className={styles.title}>
                Score de mon match
              </h3>
              <p className={styles.opponents}>
                Manche {match.roundNumber} · {team1} vs {team2}
              </p>
            </div>
            {matchFormat && <Pill variant="blue">{matchFormatLabel(matchFormat)}</Pill>}
          </div>

          {/* `<output>` (région d'état native) : l'adversaire peut répondre pendant que la modale
              est ouverte, et le flux change alors cette phrase. */}
          {status && (
            <output className={`${styles.stored} ${styles.notice}`}>
              {status}
            </output>
          )}

          {canReportScore ? (
            <>
              <div className={styles.scores}>
                <ScoreStepper
                  id="player-score-team1"
                  teamId={match.team1Id}
                  teamName={team1}
                  value={scores.score1}
                  max={maxScore}
                  disabled={submitting}
                  onChange={(value) => setScores((s) => ({ ...s, score1: value }))}
                />
                <span className={styles.versus} aria-hidden="true">
                  VS
                </span>
                <ScoreStepper
                  id="player-score-team2"
                  teamId={match.team2Id}
                  teamName={team2}
                  value={scores.score2}
                  max={maxScore}
                  disabled={submitting}
                  onChange={(value) => setScores((s) => ({ ...s, score2: value }))}
                />
              </div>
              {matchFormat && (
                <p className={styles.formatHint}>{matchFormatDescription(matchFormat)}</p>
              )}
            </>
          ) : (
            <p className={styles.formatHint}>
              {playerScoreClosedNotice(launchPhase, formatMatchStartAtFull(match.startAt))}
            </p>
          )}

          {canForfeit ? (
            <div className={styles.forfeitZone}>
              <button
                type="button"
                className={styles.link}
                onClick={() => setForfeitOpen(!forfeitOpen)}
                aria-expanded={forfeitOpen}
                aria-controls="player-score-forfeit"
                disabled={submitting}
              >
                {forfeitOpen ? "Ne pas déclarer forfait" : "Déclarer forfait sur ce match"}
              </button>
              {forfeitOpen && (
                <div id="player-score-forfeit" className={styles.forfeitPanel}>
                  <p id="player-score-forfeit-hint" className={styles.forfeitHint}>
                    {myName} déclare forfait sur ce match : {opponentName} l&apos;emporte{" "}
                    {forfeitMaps}-0, sans manche jouée. Le résultat est immédiat — seul
                    l&apos;arbitrage peut revenir dessus.
                  </p>
                  <div className={styles.forfeitRow}>
                    <button
                      type="button"
                      className={styles.forfeit}
                      aria-describedby="player-score-forfeit-hint"
                      onClick={() => void submitForfeit()}
                      disabled={submitting}
                    >
                      {submitting ? "…" : `Confirmer le forfait de ${myName}`}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <p className={styles.formatHint}>
              Un forfait se déclare par le propriétaire ou un manager de l&apos;équipe.
            </p>
          )}

          {canReportScore && showBlocker && (
            <output className={`${styles.blocker} ${styles.notice}`}>
              {blocker}
            </output>
          )}

          <div className={styles.actions}>
            <button
              type="button"
              className={`${styles.link} ${styles.close}`}
              onClick={onClose}
              disabled={submitting}
            >
              Fermer
            </button>
            {canReportScore && (
              <button
                type="submit"
                className="btn"
                disabled={!decision.canResolve || unchangedMine || submitting}
              >
                {submitting ? "…" : submitLabel}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}

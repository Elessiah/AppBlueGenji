"use client";

import { FormEvent } from "react";
import type { BracketMatch } from "@/lib/shared/types";
import { useDialogBehavior } from "@/lib/shared/hooks/useDialogBehavior";
import {
  matchFormatDescription,
  matchFormatLabel,
  matchWinsRequired,
} from "@/lib/shared/match-format";
import { useScoreForm } from "../_hooks/useScoreForm";
import { parseScoreInput, scoreBlockerMessage } from "../_lib/score-form";
import { useMatchFormat } from "../_lib/match-format-context";
import styles from "./AdminScoreDialog.module.css";

interface AdminScoreDialogProps {
  /** Match **résolu à chaque rendu** depuis la liste rafraîchie par le flux. */
  match: BracketMatch;
  onClose: () => void;
  onSubmitted: () => void;
}

interface ScoreStepperProps {
  id: string;
  teamName: string;
  value: string;
  max: number;
  disabled: boolean;
  onChange: (value: string) => void;
}

/**
 * Un côté du score. Les deux équipes partageaient jusqu'ici deux blocs de
 * balises identiques recopiés l'un sous l'autre — une correction sur l'un se
 * perdait sur l'autre.
 */
function ScoreStepper({ id, teamName, value, max, disabled, onChange }: ScoreStepperProps) {
  const parsed = parseScoreInput(value);
  // Un champ vide n'est pas une erreur : c'est un score pas encore saisi. Seule
  // une valeur illisible ou hors plage se signale en rouge.
  const invalid = value.trim() !== "" && (parsed === null || parsed > max);
  const step = (delta: number) => onChange(String(Math.min(max, Math.max(0, (parsed ?? 0) + delta))));

  return (
    <div>
      <label className={styles.sideLabel} htmlFor={id}>
        {teamName}
      </label>
      <div className={styles.stepper}>
        <button
          type="button"
          className={styles.step}
          onClick={() => step(-1)}
          // Désactivé sur un vrai zéro, pas sur un champ vide : depuis le vide,
          // « − » est le seul moyen d'atteindre 0 aux boutons — un 3-0 se saisit
          // autrement au clavier, ce qui n'existe pas sur mobile.
          disabled={disabled || parsed === 0}
          aria-label={`Retirer une manche à ${teamName}`}
        >
          −
        </button>
        <input
          id={id}
          className={styles.field}
          type="number"
          inputMode="numeric"
          min={0}
          max={max}
          step={1}
          value={value}
          placeholder="—"
          aria-invalid={invalid}
          aria-label={`Manches gagnées par ${teamName}`}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
        />
        <button
          type="button"
          className={styles.step}
          onClick={() => step(1)}
          disabled={disabled || (parsed ?? 0) >= max}
          aria-label={`Ajouter une manche à ${teamName}`}
        >
          +
        </button>
      </div>
    </div>
  );
}

/** Résultat déjà enregistré, en une phrase — ou `null` s'il n'y en a pas. */
function storedResultLabel(match: BracketMatch, team1: string, team2: string): string | null {
  if (match.forfeitTeamId !== null) {
    const forfeiting = match.forfeitTeamId === match.team1Id ? team1 : team2;
    return `Forfait enregistré : ${forfeiting} déclare forfait.`;
  }
  if (match.team1Score === null && match.team2Score === null) return null;

  const score = `${match.team1Score ?? 0} – ${match.team2Score ?? 0}`;
  if (match.winnerTeamId === null) return `Score enregistré : ${score}, match non tranché.`;

  const winner = match.winnerTeamId === match.team1Id ? team1 : team2;
  return `Résultat validé : ${score}, ${winner} l'emporte.`;
}

/**
 * Édition d'un score par l'arbitrage (permission `tournaments`).
 *
 * Deux actions, volontairement distinctes — c'est la différence entre les deux
 * routes serveur, et elle n'était lisible ni sur « OK » ni sur « ✓ Gagnant » :
 *
 * · **Enregistrer le score** note l'avancement d'une rencontre en cours. Le
 *   match ne se tranche pas, le plateau ne bouge pas, seul le plafond du format
 *   est contrôlé. Refusé sur un match déjà tranché : cette route n'écrit que les
 *   scores, elle laisserait le vainqueur et la qualifiée sur l'ancien résultat.
 * · **Valider le résultat** désigne la gagnante et propage dans le plateau. Elle
 *   exige un score complet au sens du format (3 manches en BO5).
 *
 * Comportement modal complet via `useDialogBehavior` : `Échap`, piège à focus,
 * arrière-plan figé, focus rendu au déclencheur à la fermeture.
 */
export function AdminScoreDialog({ match, onClose, onSubmitted }: AdminScoreDialogProps) {
  const form = useScoreForm(match);
  const matchFormat = useMatchFormat();
  // `locked` pendant l'envoi : Échap ne doit pas refermer une modale en train
  // d'écrire.
  const dialogRef = useDialogBehavior({ open: true, onClose, locked: form.submitting });

  const team1 = match.team1Name || "Équipe 1";
  const team2 = match.team2Name || "Équipe 2";
  // Borne haute de la saisie : l'objectif du format (3 en BO5 comme en FT3),
  // ou 99 quand le tournoi laisse le score libre.
  const maxScore = matchFormat ? matchWinsRequired(matchFormat) : 99;
  const stored = storedResultLabel(match, team1, team2);
  const forfeiting =
    form.forfeitTeamId === undefined
      ? null
      : form.forfeitTeamId === match.team1Id
        ? { out: team1, through: team2 }
        : { out: team2, through: team1 };

  const run = async (action: "save" | "resolve") => {
    const ok = await form.submit(action);
    if (ok) {
      onSubmitted();
      onClose();
    }
  };

  // `Entrée` dans un champ vaut « valider le résultat » : c'est l'issue
  // attendue d'une saisie de score, l'enregistrement intermédiaire étant un
  // geste délibéré.
  const onSubmitForm = (event: FormEvent) => {
    event.preventDefault();
    if (form.decision.canResolve && !form.submitting) void run("resolve");
  };

  const toggleForfeit = (teamId: number | null) => {
    if (teamId === null) return;
    form.setForfeitTeamId(form.forfeitTeamId === teamId ? undefined : teamId);
  };

  return (
    <div
      className={styles.backdrop}
      role="presentation"
      onClick={() => {
        if (!form.submitting) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-score-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <form onSubmit={onSubmitForm}>
          <h3 id="admin-score-title" className={styles.title}>
            Score du match
          </h3>
          <p className={styles.opponents}>
            Manche {match.roundNumber} · {team1} vs {team2}
          </p>

          <p className={styles.formatHint}>
            <strong>{matchFormatLabel(matchFormat)}</strong> — {matchFormatDescription(matchFormat)}
          </p>

          {/* `role="status"` : le résultat enregistré peut changer sous les yeux
              du lecteur (le flux apporte la saisie d'un autre arbitre), et le
              changement doit s'entendre autant qu'il se voit. */}
          {stored && (
            <p className={`${styles.notice} ${styles.noticeInfo}`} role="status">
              {stored}
            </p>
          )}

          {form.conflict && (
            <div className={`${styles.notice} ${styles.noticeWarn}`} role="alert">
              Ce match a été modifié pendant ta saisie — quelqu&apos;un d&apos;autre a
              enregistré un résultat. Envoyer maintenant écraserait le sien.
              <button
                type="button"
                className={styles.noticeAction}
                onClick={form.adoptStoredResult}
                disabled={form.submitting}
              >
                Reprendre la valeur à jour
              </button>
            </div>
          )}

          <div className={styles.scores}>
            <ScoreStepper
              id="admin-score-team1"
              teamName={team1}
              value={form.score1}
              max={maxScore}
              disabled={form.submitting || form.forfeitTeamId !== undefined}
              onChange={form.setScore1}
            />
            <span className={styles.versus} aria-hidden="true">
              VS
            </span>
            <ScoreStepper
              id="admin-score-team2"
              teamName={team2}
              value={form.score2}
              max={maxScore}
              disabled={form.submitting || form.forfeitTeamId !== undefined}
              onChange={form.setScore2}
            />
          </div>

          <div className={styles.section}>
            <p className={styles.sectionTitle}>Forfait</p>
            <p className={styles.sectionHint}>
              {forfeiting
                ? `${forfeiting.out} déclare forfait : ${forfeiting.through} l'emporte sans manche jouée.`
                : "Désigne l'équipe qui déclare forfait. Son adversaire l'emporte, et les scores ci-dessus sont ignorés."}
            </p>
            <div className={styles.forfeitRow}>
              <button
                type="button"
                className={styles.forfeit}
                aria-pressed={form.forfeitTeamId === match.team1Id}
                onClick={() => toggleForfeit(match.team1Id)}
                disabled={form.submitting || match.team1Id === null}
              >
                {team1}
              </button>
              <button
                type="button"
                className={styles.forfeit}
                aria-pressed={form.forfeitTeamId === match.team2Id}
                onClick={() => toggleForfeit(match.team2Id)}
                disabled={form.submitting || match.team2Id === null}
              >
                {team2}
              </button>
              {form.forfeitTeamId !== undefined && (
                <button
                  type="button"
                  className="btn ghost"
                  style={{ padding: "10px 14px", fontSize: 12 }}
                  onClick={() => form.setForfeitTeamId(undefined)}
                  disabled={form.submitting}
                >
                  Annuler le forfait
                </button>
              )}
            </div>
          </div>

          <div className={styles.actions}>
            <button
              type="button"
              className="btn ghost"
              onClick={onClose}
              disabled={form.submitting}
            >
              Fermer
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => void run("save")}
              disabled={!form.decision.canSave || form.submitting}
              title={
                form.decision.saveBlocker
                  ? scoreBlockerMessage(form.decision.saveBlocker, matchFormat)
                  : "Note l'avancement sans désigner de vainqueur."
              }
            >
              {form.submitting ? "…" : "Enregistrer le score"}
            </button>
            <button
              type="submit"
              className="btn"
              disabled={!form.decision.canResolve || form.submitting}
              title={
                form.decision.resolveBlocker
                  ? scoreBlockerMessage(form.decision.resolveBlocker, matchFormat)
                  : "Désigne la gagnante et met le plateau à jour."
              }
            >
              {form.submitting ? "…" : "Valider le résultat"}
            </button>
          </div>

          {/* Une seule raison affichée : celle qui bloque l'action décisive, ou
              à défaut celle de l'enregistrement. Les empiler ferait répéter deux
              fois la même phrase dans le cas courant. */}
          {form.dirty && !form.decision.resolveBlocker && !form.decision.saveBlocker && (
            <p className={styles.blockers} role="status">
              Saisie non enregistrée.
            </p>
          )}

          {(form.decision.resolveBlocker ?? form.decision.saveBlocker) && (
            <p className={styles.blockers} role="status">
              {scoreBlockerMessage(
                (form.decision.resolveBlocker ?? form.decision.saveBlocker)!,
                matchFormat,
              )}
            </p>
          )}
        </form>
      </div>
    </div>
  );
}

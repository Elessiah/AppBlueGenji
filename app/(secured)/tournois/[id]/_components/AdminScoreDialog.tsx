"use client";

import { FormEvent, useState } from "react";
import { Pill } from "@/components/cyber";
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
    return `Forfait enregistré : ${forfeiting}.`;
  }
  if (match.team1Score === null && match.team2Score === null) return null;

  const score = `${match.team1Score ?? 0} – ${match.team2Score ?? 0}`;
  if (match.winnerTeamId === null) return `Enregistré : ${score}, non tranché.`;

  const winner = match.winnerTeamId === match.team1Id ? team1 : team2;
  return `Tranché : ${score}, ${winner} l'emporte.`;
}

/**
 * Édition d'un score par l'arbitrage (permission `tournaments`).
 *
 * Deux actions, volontairement distinctes — c'est la différence entre les deux
 * routes serveur, et elle n'était lisible ni sur « OK » ni sur « ✓ Gagnant » :
 *
 * · **Enregistrer** note l'avancement d'une rencontre en cours. Le match ne se
 *   tranche pas, le plateau ne bouge pas, seul le plafond du format est
 *   contrôlé. Refusé sur un match déjà tranché : cette route n'écrit que les
 *   scores, elle laisserait le vainqueur et la qualifiée sur l'ancien résultat.
 * · **Valider le résultat** désigne la gagnante et propage dans le plateau. Elle
 *   exige un score complet au sens du format (3 manches en BO5).
 *
 * Ces deux-là sont les seules choses toujours visibles, avec le score. Le geste
 * courant est « je saisis, je valide » : le rappel de format ne s'affiche que
 * s'il y en a un, le résultat déjà en base que s'il ne se lit pas dans les
 * champs, et le forfait — rare — reste replié derrière un lien.
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
  const [forfeitOpen, setForfeitOpen] = useState(false);

  const team1 = match.team1Name || "Équipe 1";
  const team2 = match.team2Name || "Équipe 2";
  // Borne haute de la saisie : l'objectif du format (3 en BO5 comme en FT3),
  // ou 99 quand le tournoi laisse le score libre.
  const maxScore = matchFormat ? matchWinsRequired(matchFormat) : 99;
  const forfeitTeamId = form.forfeitTeamId;
  const forfeiting =
    forfeitTeamId === undefined
      ? null
      : forfeitTeamId === match.team1Id
        ? { out: team1, through: team2 }
        : { out: team2, through: team1 };
  // Un forfait déjà posé ne se cache pas derrière un lien : il commande la
  // rencontre, et le replier laisserait croire à un match encore à jouer.
  const showForfeit = forfeitOpen || forfeitTeamId !== undefined;

  // Ce qui est en base ne se rappelle que s'il ne se lit pas déjà dans les
  // champs : un match tranché (les champs ne disent pas qui a gagné), ou une
  // saisie en cours qui recouvre l'ancienne valeur.
  const stored =
    match.winnerTeamId !== null || form.dirty ? storedResultLabel(match, team1, team2) : null;
  const blocker = form.decision.resolveBlocker ?? form.decision.saveBlocker;

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
    form.setForfeitTeamId(forfeitTeamId === teamId ? undefined : teamId);
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
          <div className={styles.head}>
            <div className={styles.headText}>
              <h3 id="admin-score-title" className={styles.title}>
                Score du match
              </h3>
              <p className={styles.opponents}>
                Manche {match.roundNumber} · {team1} vs {team2}
              </p>
            </div>
            {/* Le format n'apparaît que s'il en existe un : « Score libre —
                aucune limite » occupait une ligne pour ne rien apprendre. */}
            {matchFormat && <Pill variant="blue">{matchFormatLabel(matchFormat)}</Pill>}
          </div>

          {/* `role="status"` : le résultat enregistré peut changer sous les yeux
              du lecteur (le flux apporte la saisie d'un autre arbitre), et le
              changement doit s'entendre autant qu'il se voit. */}
          {stored && (
            <p className={styles.stored} role="status">
              {stored}
            </p>
          )}

          {form.conflict && (
            <div className={styles.conflict} role="alert">
              Ce match a été modifié pendant ta saisie — quelqu&apos;un d&apos;autre a
              enregistré un résultat. Envoyer maintenant écraserait le sien.
              <button
                type="button"
                className={styles.conflictAction}
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
              disabled={form.submitting || forfeitTeamId !== undefined}
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
              disabled={form.submitting || forfeitTeamId !== undefined}
              onChange={form.setScore2}
            />
          </div>

          {/* La règle chiffrée sous les champs plutôt qu'en `title` de la
              pastille : une infobulle sur un `<span>` ne s'atteint ni au clavier
              ni au doigt, et c'est la seule chose qui borne la saisie. */}
          {matchFormat && (
            <p className={styles.formatHint}>{matchFormatDescription(matchFormat)}</p>
          )}

          <div className={styles.forfeitZone}>
            {/* Dépliage en bonne et due forme : le bouton reste en place et
                porte `aria-expanded`. Un bouton qui s'efface au profit du
                panneau annonçait « replié » puis disparaissait, sans jamais
                signaler l'ouverture. Il sert aussi d'annulation, ce qui évite un
                troisième bouton dans la rangée. */}
            <button
              type="button"
              className={styles.link}
              onClick={() => {
                if (showForfeit) form.setForfeitTeamId(undefined);
                setForfeitOpen(!showForfeit);
              }}
              aria-expanded={showForfeit}
              aria-controls="admin-score-forfeit"
              disabled={form.submitting}
            >
              {/* « Annuler le forfait » n'a de sens qu'une fois une équipe
                  désignée : panneau ouvert et vide, il n'y a que le panneau à
                  refermer. */}
              {forfeitTeamId !== undefined
                ? "Annuler le forfait"
                : showForfeit
                  ? "Annuler"
                  : "Déclarer un forfait"}
            </button>

            {showForfeit && (
              <div id="admin-score-forfeit" className={styles.forfeitPanel}>
                <p className={styles.forfeitHint}>
                  {forfeiting
                    ? `${forfeiting.out} déclare forfait : ${forfeiting.through} l'emporte sans manche jouée.`
                    : "Qui déclare forfait ? Son adversaire l'emporte, et les scores saisis sont ignorés."}
                </p>
                <div className={styles.forfeitRow}>
                  <button
                    type="button"
                    className={styles.forfeit}
                    aria-pressed={forfeitTeamId === match.team1Id}
                    onClick={() => toggleForfeit(match.team1Id)}
                    disabled={form.submitting || match.team1Id === null}
                  >
                    {team1}
                  </button>
                  <button
                    type="button"
                    className={styles.forfeit}
                    aria-pressed={forfeitTeamId === match.team2Id}
                    onClick={() => toggleForfeit(match.team2Id)}
                    disabled={form.submitting || match.team2Id === null}
                  >
                    {team2}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Une seule raison affichée : celle qui bloque l'action décisive, ou
              à défaut celle de l'enregistrement. Les empiler ferait répéter deux
              fois la même phrase dans le cas courant. */}
          {blocker && (
            <p className={styles.blocker} role="status">
              {scoreBlockerMessage(blocker, matchFormat)}
            </p>
          )}

          <div className={styles.actions}>
            {/* Trois poids, trois rôles : quitter est un lien, l'enregistrement
                intermédiaire est secondaire, valider est l'action attendue. */}
            <button
              type="button"
              className={`${styles.link} ${styles.close}`}
              onClick={onClose}
              disabled={form.submitting}
            >
              Fermer
            </button>
            <button
              type="button"
              className="btn ghost"
              onClick={() => void run("save")}
              disabled={!form.decision.canSave || form.submitting}
              title={
                form.decision.saveBlocker
                  ? scoreBlockerMessage(form.decision.saveBlocker, matchFormat)
                  : "Note l'avancement sans désigner de vainqueur."
              }
            >
              {form.submitting ? "…" : "Enregistrer"}
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
        </form>
      </div>
    </div>
  );
}

"use client";

import { FormEvent, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Pill } from "@/components/cyber";
import type { BracketMatch } from "@/lib/shared/types";
import { useBackdropDismiss } from "@/lib/shared/hooks/useBackdropDismiss";
import { useDialogBehavior } from "@/lib/shared/hooks/useDialogBehavior";
import { isMatchDoubleForfeit, isMatchDrawn } from "@/lib/shared/match-outcome";
import {
  forfeitMapCount,
  matchFormatDescription,
  matchFormatLabel,
  matchWinsRequired,
} from "@/lib/shared/match-format";
import { useMatchLaunchPhase } from "@/lib/shared/hooks/useMatchLaunchPhase";
import { SCORE_ENTRY_CLOSED_PHASES } from "@/lib/shared/match-launch";
import { useScoreForm } from "../_hooks/useScoreForm";
import { useLiveControls } from "../_lib/live-context";
import {
  adminProposalNotice,
  forfeitParties,
  pendingScoreProposal,
  scoreBlockerMessage,
  scoreCorrectionNeedsConfirmation,
  storedResultSignature,
} from "../_lib/score-form";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";
import { useMatchFormat } from "../_lib/match-format-context";
import { ScoreStepper } from "./ScoreStepper";
import { MapScoreList, mapFieldIds } from "./MapScoreList";
import { mapFieldKey } from "@/lib/shared/match-maps";
import { useFieldErrors } from "@/lib/shared/hooks/useFieldErrors";
import styles from "./ScoreDialog.module.css";

/**
 * Phrase d'aide du forfait, selon ce qui est désigné : les deux engagées, une
 * seule, ou personne encore — et, dans ce dernier cas, sans parler de scores
 * « ignorés » quand aucun ne peut être saisi (match pas encore lancé).
 */
function forfeitHint(input: {
  team1: string;
  team2: string;
  doubleForfeit: boolean;
  forfeiting: { out: string; through: string } | null;
  forfeitMaps: number;
  scoreEntryClosed: boolean;
}): string {
  const { team1, team2, forfeiting, forfeitMaps } = input;
  if (input.doubleForfeit) {
    return `${team1} et ${team2} déclarent toutes les deux forfait : le match est perdu pour les deux, personne ne se qualifie, et dans un tableau leur prochain adversaire passe le tour par exemption.`;
  }
  if (forfeiting) {
    return `${forfeiting.out} déclare forfait sur cette manche : ${forfeiting.through} l'emporte ${forfeitMaps}-0, sans manche jouée.`;
  }
  const question = `Qui déclare forfait sur cette manche ? Son adversaire l'emporte ${forfeitMaps}-0`;
  return input.scoreEntryClosed ? `${question}.` : `${question}, et les scores saisis sont ignorés.`;
}

interface AdminScoreDialogProps {
  /** Match **résolu à chaque rendu** depuis la liste rafraîchie par le flux. */
  match: BracketMatch;
  onClose: () => void;
  onSubmitted: () => void;
}

/** Résultat déjà enregistré, en une phrase — ou `null` s'il n'y en a pas. */
function storedResultLabel(match: BracketMatch, team1: string, team2: string): string | null {
  if (isMatchDoubleForfeit(match)) {
    return `Double forfait enregistré : ${team1} et ${team2} perdent toutes les deux.`;
  }
  if (match.forfeitTeamId !== null) {
    const forfeiting = match.forfeitTeamId === match.team1Id ? team1 : team2;
    const beneficiary = match.forfeitTeamId === match.team1Id ? team2 : team1;
    return `Forfait enregistré : ${forfeiting}, ${beneficiary} l'emporte.`;
  }
  if (match.team1Score === null && match.team2Score === null) return null;

  const score = `${match.team1Score ?? 0} – ${match.team2Score ?? 0}`;
  // Un nul est un résultat, pas une saisie en attente : le dire « non tranché »
  // enverrait l'arbitrage chercher un vainqueur qu'il n'y a pas.
  if (isMatchDrawn(match)) return `Tranché : ${score}, match nul.`;
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
/** Lignes de maps adressables par `useFieldErrors` — au-delà de tout plafond. */
const MAP_FIELD_ID_SLOTS = 32;

export function AdminScoreDialog({ match, onClose, onSubmitted }: Readonly<AdminScoreDialogProps>) {
  // Aucun score avant le lancement, arbitrage compris (`isScoreEntryOpen`) :
  // la phase suit l'horloge, si bien que le dialogue ouvert sur un match « en
  // attente de départ » s'ouvre de lui-même à l'heure dite.
  const { refereeScheduling } = useLiveControls();
  const launchPhase = useMatchLaunchPhase({ ...match, refereeScheduling });
  const scoreEntryClosed = SCORE_ENTRY_CLOSED_PHASES.includes(launchPhase);
  // Déclaré avant le formulaire : un refus de map s'y rattache à son champ.
  // Les `id` couvrent tout plafond de lignes possible (`mapListLimit`).
  const mapFieldErrors = useFieldErrors<string>({}, mapFieldIds("admin-score", MAP_FIELD_ID_SLOTS));
  const form = useScoreForm(match, {
    scoreEntryClosed,
    onMapRefusal: (field, message) => mapFieldErrors.flag(mapFieldKey(field.index, field.field), message),
  });
  const matchFormat = useMatchFormat(match);
  // `locked` pendant l'envoi : Échap ne doit pas refermer une modale en train
  // d'écrire.
  const dialogRef = useDialogBehavior({ open: true, onClose, locked: form.submitting });
  const backdrop = useBackdropDismiss(onClose, form.submitting);
  const [forfeitOpen, setForfeitOpen] = useState(false);

  const team1 = match.team1Name || "Équipe 1";
  const team2 = match.team2Name || "Équipe 2";
  // Borne haute de la saisie : l'objectif du format (3 en BO5 comme en FT3),
  // ou 99 quand le tournoi laisse le score libre.
  const maxScore = matchFormat ? matchWinsRequired(matchFormat) : 99;
  // Score qu'emporte le vainqueur d'un forfait : celui du format, 1 en saisie
  // libre — la même valeur que celle écrite en base par la route.
  const forfeitMaps = forfeitMapCount(matchFormat);
  const forfeitTeamId = form.forfeitTeamId;
  const doubleForfeit = form.doubleForfeit;
  // Un forfait, simple ou double, remplace le score saisi.
  const anyForfeit = forfeitTeamId !== undefined || doubleForfeit;
  const forfeiting = forfeitParties(forfeitTeamId, match.team1Id, team1, team2);
  // Un forfait déjà posé ne se cache pas derrière un lien : il commande la
  // rencontre, et le replier laisserait croire à un match encore à jouer.
  // Avant le lancement, le forfait est le seul geste possible : il s'offre
  // déplié plutôt que derrière un lien.
  const showForfeit = forfeitOpen || anyForfeit || scoreEntryClosed;

  // Ce qui est en base ne se rappelle que s'il ne se lit pas déjà dans les
  // champs : un match tranché (les champs ne disent pas qui a gagné), ou une
  // saisie en cours qui recouvre l'ancienne valeur.
  const stored =
    match.winnerTeamId !== null ||
    isMatchDrawn(match) ||
    isMatchDoubleForfeit(match) ||
    form.dirty
      ? storedResultLabel(match, team1, team2)
      : null;
  // Avant le lancement, la raison est déjà dite en tête du dialogue : la
  // répéter sous les boutons doublerait la même phrase.
  const rawBlocker = form.decision.resolveBlocker ?? form.decision.saveBlocker;
  const blocker = rawBlocker === "NOT_IN_LAUNCH" ? null : rawBlocker;
  // Score proposé par une engagée et jamais confirmé par l'autre — une équipe
  // fantôme ne confirme jamais. Les champs s'ouvrent dessus : il reste à le
  // vérifier puis à le valider, sans le recopier.
  const proposal = pendingScoreProposal(match);
  const proposalNotice = adminProposalNotice(proposal, team1, team2, form.dirty);
  const forfeitToggleLabel = showForfeit ? "Annuler" : "Déclarer un forfait sur cette manche";

  // Correction d'un match déjà tranché : l'écriture attend la confirmation
  // (`scoreCorrectionNeedsConfirmation`), le premier résultat part directement.
  const [confirmingCorrection, setConfirmingCorrection] = useState<"save" | "resolve" | null>(null);
  const storedLabel = storedResultLabel(match, team1, team2);
  // Un autre arbitre écrit pendant qu'on lit la confirmation : l'avertissement
  // de conflit s'affiche dans le dialogue de score, que la confirmation
  // recouvre. On la referme à **chaque** changement du résultat stocké (et non
  // au seul passage de `form.conflict` à vrai, qui ne bouge plus s'il l'était
  // déjà) pour que la nouvelle valeur soit lue avant tout envoi.
  const storedSignature = storedResultSignature(match);
  useEffect(() => {
    setConfirmingCorrection(null);
  }, [storedSignature]);

  const perform = async (action: "save" | "resolve"): Promise<boolean> => {
    const ok = await form.submit(action);
    if (ok) {
      onSubmitted();
      onClose();
    }
    return ok;
  };

  const run = async (action: "save" | "resolve") => {
    if (scoreCorrectionNeedsConfirmation(match)) {
      setConfirmingCorrection(action);
      return;
    }
    await perform(action);
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

  const closeForfeit = () => {
    form.setForfeitTeamId();
    form.setDoubleForfeit(false);
  };

  return createPortal(
    <div /* NOSONAR S6819 — voile de modale, sans équivalent natif */
      className={styles.backdrop}
      role="presentation"
      {...backdrop}
    >
      <div /* NOSONAR S6819 — modale portée dans body (useDialogBehavior) : `<dialog>` changerait couche, Échap et ::backdrop */
        ref={dialogRef}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-score-title"
        tabIndex={-1}
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

          {/* `<output>` (région d'état native) : le résultat enregistré peut changer sous les yeux
              du lecteur (le flux apporte la saisie d'un autre arbitre), et le
              changement doit s'entendre autant qu'il se voit. */}
          {stored && (
            <output className={`${styles.stored} ${styles.notice}`}>
              {stored}
            </output>
          )}

          {/* `<output>` : une région d'état native, que la phase peut changer
              sous les yeux du lecteur (l'heure de départ arrive). */}
          {scoreEntryClosed && (
            <output className={`${styles.stored} ${styles.notice}`}>
              {launchPhase === "TO_PLAN"
                ? "Match à planifier : fixe sa date avant d'en saisir le score. Un forfait peut être prononcé dès maintenant."
                : "Match en attente de départ : le score se saisit à partir de son lancement. Un forfait peut être prononcé dès maintenant."}
            </output>
          )}

          {proposalNotice && (
            <output className={`${styles.stored} ${styles.notice}`}>
              {proposalNotice}
            </output>
          )}

          {form.conflict && (
            <div className={styles.conflict} role="alert">
              Ce match a été modifié pendant ta saisie — quelqu&apos;un d&apos;autre a
              enregistré un résultat. Envoyer maintenant écraserait le sien.
              {/* NOSONAR S6772 — le bouton est en `display: block`, il passe à la ligne */}
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
              teamId={match.team1Id}
              teamName={team1}
              value={form.score1}
              max={maxScore}
              disabled={form.submitting || anyForfeit || scoreEntryClosed || form.maps.length > 0}
              onChange={form.setScore1}
            />
            <span className={styles.versus} aria-hidden="true">
              VS
            </span>
            <ScoreStepper
              id="admin-score-team2"
              teamId={match.team2Id}
              teamName={team2}
              value={form.score2}
              max={maxScore}
              disabled={form.submitting || anyForfeit || scoreEntryClosed || form.maps.length > 0}
              onChange={form.setScore2}
            />
          </div>

          {/* La règle chiffrée sous les champs plutôt qu'en `title` de la
              pastille : une infobulle sur un `<span>` ne s'atteint ni au clavier
              ni au doigt, et c'est la seule chose qui borne la saisie. */}
          {matchFormat && (
            <p className={styles.formatHint}>{matchFormatDescription(matchFormat)}</p>
          )}

          {/* Détail map par map (`MAP_SCORES.md`) : dès qu'une map est saisie,
              le score ci-dessus en découle. Sans map, l'arbitre pose le score
              à la main, comme avant (replay perdu, saisie de secours). */}
          {!anyForfeit && !scoreEntryClosed && (
            <MapScoreList
              idPrefix="admin-score"
              maps={form.maps}
              onChange={form.setMaps}
              format={matchFormat}
              game={form.game}
              team1Name={team1}
              team2Name={team2}
              disabled={form.submitting}
              fieldErrors={mapFieldErrors}
            />
          )}

          <div className={styles.forfeitZone}>
            {/* Dépliage en bonne et due forme : le bouton reste en place et
                porte `aria-expanded`. Un bouton qui s'efface au profit du
                panneau annonçait « replié » puis disparaissait, sans jamais
                signaler l'ouverture. Il sert aussi d'annulation, ce qui évite un
                troisième bouton dans la rangée. Avant le lancement, le
                panneau est toujours ouvert : seul « Annuler le forfait » garde
                un sens. */}
            {(!scoreEntryClosed || anyForfeit) && (
            <button
              type="button"
              className={styles.link}
              onClick={() => {
                if (showForfeit) closeForfeit();
                setForfeitOpen(!showForfeit);
              }}
              aria-expanded={showForfeit}
              aria-controls="admin-score-forfeit"
              disabled={form.submitting}
            >
              {/* « Annuler le forfait » n'a de sens qu'une fois une équipe
                  désignée : panneau ouvert et vide, il n'y a que le panneau à
                  refermer. */}
              {anyForfeit ? "Annuler le forfait" : forfeitToggleLabel}
            </button>
            )}

            {showForfeit && (
              <div id="admin-score-forfeit" className={styles.forfeitPanel}>
                {/* Le forfait n'est pas une rencontre blanche : il se compte
                    au score plein du format (FT3 → 3-0), et c'est ce chiffre
                    qu'il faut annoncer avant le clic — il entre au bilan de
                    maps comme au capital d'endurance d'une BlueGenji Survie.
                    Le geste ne porte que sur **cette** manche : retirer une
                    équipe de tout le reste du tournoi se fait depuis son
                    classement, pas d'ici. */}
                {/* Le double forfait annonce ses conséquences avant le clic :
                    personne ne gagne, et dans un tableau la place laissée vide
                    fait passer l'adversaire suivant par exemption — un effet
                    qui descend l'arbre, et qu'on ne découvre pas après coup. */}
                <p id="admin-score-forfeit-hint" className={styles.forfeitHint}>
                  {forfeitHint({
                    team1,
                    team2,
                    doubleForfeit,
                    forfeiting,
                    forfeitMaps,
                    scoreEntryClosed,
                  })}
                </p>
                <div className={styles.forfeitRow}>
                  <button
                    type="button"
                    className={styles.forfeit}
                    aria-pressed={forfeitTeamId === match.team1Id}
                    aria-describedby="admin-score-forfeit-hint"
                    onClick={() => toggleForfeit(match.team1Id)}
                    disabled={form.submitting || match.team1Id === null}
                  >
                    {team1}
                  </button>
                  <button
                    type="button"
                    className={styles.forfeit}
                    aria-pressed={forfeitTeamId === match.team2Id}
                    aria-describedby="admin-score-forfeit-hint"
                    onClick={() => toggleForfeit(match.team2Id)}
                    disabled={form.submitting || match.team2Id === null}
                  >
                    {team2}
                  </button>
                  <button
                    type="button"
                    className={`${styles.forfeit} ${styles.forfeitBoth}`}
                    aria-pressed={doubleForfeit}
                    aria-describedby="admin-score-forfeit-hint"
                    onClick={() => form.setDoubleForfeit(!doubleForfeit)}
                    disabled={form.submitting || match.team1Id === null || match.team2Id === null}
                  >
                    Les deux (double forfait)
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Une seule raison affichée : celle qui bloque l'action décisive, ou
              à défaut celle de l'enregistrement. Les empiler ferait répéter deux
              fois la même phrase dans le cas courant. */}
          {blocker && (
            <output className={`${styles.blocker} ${styles.notice}`}>
              {scoreBlockerMessage(blocker, matchFormat)}
            </output>
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
      {confirmingCorrection !== null && (
        <ConfirmActionDialog
          title="Corriger un résultat déjà validé ?"
          confirmLabel="Corriger le résultat"
          pendingLabel="Correction…"
          onClose={() => setConfirmingCorrection(null)}
          onConfirm={() => perform(confirmingCorrection)}
        >
          {storedLabel !== null && <p>{storedLabel}</p>}
          <p>Ce résultat publié sera remplacé par la nouvelle saisie.</p>
          <p>
            Si l&apos;issue change, ce qui en découlait est défait : une rencontre suivante encore sans score peut
            changer d&apos;adversaire (son horaire conservé), le classement est recalculé, et un tournoi déjà
            terminé repasse en cours.
          </p>
        </ConfirmActionDialog>
      )}
    </div>,
    document.body,
  );
}

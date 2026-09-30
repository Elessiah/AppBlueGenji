"use client";

import { FormEvent, ReactNode, useState } from "react";
import { createPortal } from "react-dom";
import { useToast } from "@/components/ui/toast";
import { useBackdropDismiss } from "@/lib/shared/hooks/useBackdropDismiss";
import { useDialogBehavior } from "@/lib/shared/hooks/useDialogBehavior";
import { requiresMatchStartAt } from "@/lib/shared/live-streams";
import {
  isValidMatchStartAt,
  matchStartAtInputValue,
} from "@/lib/shared/match-schedule";
import { matchLaunchPhase } from "@/lib/shared/match-launch";
import type { BracketMatch } from "@/lib/shared/types";
import { mapError } from "../_lib/error-map";

/** Aide sous le champ : l'erreur de saisie d'abord, sinon ce que la date va produire. */
function startAtHint(input: {
  incomplete: boolean;
  invalid: boolean;
  refereeScheduling: boolean;
}): string {
  if (input.incomplete) {
    return "Date incomplète : renseigne le jour et l'heure, ou efface tout le champ pour ne pas annoncer d'horaire.";
  }
  if (input.invalid) return "Date non reconnue.";
  if (input.refereeScheduling) {
    return "Le match reste « En attente de départ » jusqu'à cette heure, puis entre en lancement : les deux équipes se déclarent prêtes.";
  }
  return "Laisser vide pour ne pas annoncer d'horaire. À l'heure dite, le match entre en lancement : les deux équipes se déclarent prêtes.";
}

/** Confirmation après enregistrement. */
function savedMessage(touched: boolean, planning: boolean): string {
  if (!touched) return "Date de début effacée.";
  return planning ? "Match planifié." : "Date de début enregistrée.";
}

/** Libellé du bouton d'envoi. */
function submitLabel(busy: boolean, planning: boolean): string {
  if (busy) return "Enregistrement…";
  return planning ? "Planifier" : "Enregistrer";
}

/**
 * Avertissement avant l'envoi. `<output>` : une région d'état native, qui se
 * lit quand elle apparaît au fil de la saisie.
 */
function ScheduleWarning({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <output
      style={{
        display: "block",
        margin: "12px 0 0",
        padding: "8px 10px",
        borderRadius: 8,
        border: "1px solid rgba(255,157,46,0.4)",
        background: "rgba(255,157,46,0.1)",
        fontSize: 12,
        color: "var(--text-1, #c3ccd8)",
      }}
    >
      {children}
    </output>
  );
}

interface MatchScheduleDialogProps {
  match: BracketMatch;
  /**
   * Le tournoi fait planifier ses matchs par l'arbitrage : effacer la date
   * renvoie le match « À planifier » (`lib/shared/match-planning.ts`).
   */
  refereeScheduling: boolean;
  onClose: () => void;
  onSaved: () => void;
}

/**
 * Date de début d'un match, pour la permission `tournaments`.
 *
 * La date ne verrouille rien, mais elle rythme le match : à l'heure dite il
 * entre en **lancement** (`lib/shared/match-launch.ts`), et elle sert de
 * frontière d'antenne aux matchs castés en mode « à la date de début ». Dans un
 * tournoi planifié par l'arbitrage, c'est elle qui fait sortir un match de
 * « À planifier ».
 *
 * Comportement modal complet via `useDialogBehavior` : `Échap`, piège à focus,
 * arrière-plan figé, focus rendu au déclencheur à la fermeture.
 */
export function MatchScheduleDialog({
  match,
  refereeScheduling,
  onClose,
  onSaved,
}: Readonly<MatchScheduleDialogProps>) {
  const { showError, showSuccess } = useToast();
  const [startAt, setStartAt] = useState(() => matchStartAtInputValue(match.startAt));
  // Saisie commencée mais incomplète (« 01/09/____ __:__ »). Le champ
  // `datetime-local` rend alors `value === ""` — indiscernable d'un champ vidé —
  // tout en refusant la soumission par la validation native. Sans cet état, le
  // bouton « Enregistrer » ne ferait donc rien, sans un mot d'explication.
  const [incomplete, setIncomplete] = useState(false);
  const [busy, setBusy] = useState(false);
  // `locked` pendant l'envoi : Échap ne doit pas refermer une modale en train
  // d'écrire.
  const dialogRef = useDialogBehavior({ open: true, onClose, locked: busy });
  const backdrop = useBackdropDismiss(onClose, busy);

  // « Planifier » seulement pour un match réellement **à planifier**, figé à
  // l'ouverture : sur un match terminé ou sans ses deux engagés, poser une date
  // n'en lance aucun.
  const [planning] = useState(
    () => matchLaunchPhase({ ...match, refereeScheduling }, Date.now()) === "TO_PLAN",
  );
  const touched = startAt.trim().length > 0;
  const invalid = incomplete || (touched && !isValidMatchStartAt(startAt));
  // Effacer la date d'un match casté « à la date de début » ne casse rien, mais
  // le laisse programmé sans jamais passer à l'antenne : on le dit plutôt que
  // de refuser l'effacement — le calendrier ne dépend pas de la diffusion.
  // Une saisie seulement incomplète n'est pas un effacement : on n'avertit pas
  // encore, l'utilisateur est en train de taper.
  const clearsLiveTrigger =
    !touched && !incomplete && requiresMatchStartAt(match.liveTrigger);
  // Effacer la date d'un match non lancé d'un tournoi planifié le renvoie à
  // l'arbitrage : on le dit avant l'envoi. Un match lancé ou joué n'est pas
  // concerné (sa phase ne dépend plus de la date).
  const returnsToPlanning =
    refereeScheduling &&
    !touched &&
    !incomplete &&
    match.startAt !== null &&
    match.launchedAt === null &&
    match.status === "READY" &&
    // Déjà noté, il est tenu pour lancé par le serveur, pas renvoyé.
    match.team1Score === null &&
    match.team2Score === null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (invalid) return;

    setBusy(true);
    try {
      const response = await fetch(`/api/admin/matches/${match.id}/schedule`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ startAt: touched ? new Date(startAt).toISOString() : null }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "MATCH_SCHEDULE_UPDATE_FAILED");
      showSuccess(savedMessage(touched, planning));
      onSaved();
      onClose();
    } catch (error) {
      showError(mapError((error as Error).message));
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div
      role="presentation"
      {...backdrop}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 80,
        background: "rgba(6, 8, 12, 0.72)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        className="dialog-bounded"
        aria-labelledby="match-schedule-title"
        tabIndex={-1}
        style={{
          width: "100%",
          maxWidth: 460,
          background: "var(--cyber-bg-2, #14181f)",
          border: "1px solid var(--line-strong-cy, var(--line-soft))",
          borderRadius: "var(--r-cy-md, 12px)",
          boxShadow: "0 24px 64px rgba(0,0,0,0.6)",
          padding: 22,
        }}
      >
        <form onSubmit={submit}>
          <h3 id="match-schedule-title" style={{ margin: 0, fontSize: 18, color: "var(--ink)" }}>
            {planning ? "Planifier le match" : "Date de début du match"}
          </h3>
          <p style={{ marginTop: 6, fontSize: 13, color: "var(--text-2, #9aa4b2)" }}>
            {match.team1Name ?? "TBD"} vs {match.team2Name ?? "TBD"}
          </p>

          <div className="field" style={{ marginTop: 18 }}>
            <label htmlFor="match-start-at">Début programmé</label>
            <input
              id="match-start-at"
              type="datetime-local"
              value={startAt}
              onChange={(e) => {
                setStartAt(e.target.value);
                setIncomplete(e.target.validity.badInput);
              }}
              aria-invalid={invalid}
              aria-describedby="match-start-at-hint"
            />
            <p
              id="match-start-at-hint"
              style={{
                margin: "6px 0 0",
                fontSize: 12,
                color: invalid ? "rgba(255,74,92,0.95)" : "var(--text-2, #9aa4b2)",
              }}
            >
              {startAtHint({ incomplete, invalid, refereeScheduling })}
            </p>
          </div>

          {clearsLiveTrigger && (
            <ScheduleWarning>
              Ce match passe à l&apos;antenne à sa date de début : sans date, il restera
              « programmé » sans jamais démarrer.
            </ScheduleWarning>
          )}

          {returnsToPlanning && (
            <ScheduleWarning>
              Sans date, ce match repasse « À planifier » : il ne se lancera pas tant
              qu&apos;une nouvelle heure n&apos;est pas fixée.
            </ScheduleWarning>
          )}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 20 }}>
            <button
              type="button"
              className="btn ghost"
              onClick={onClose}
              disabled={busy}
              style={{ padding: "8px 18px", fontSize: 13 }}
            >
              Annuler
            </button>
            <button
              type="submit"
              className="btn"
              disabled={busy || invalid}
              style={{ padding: "8px 20px", fontSize: 13 }}
            >
              {submitLabel(busy, planning)}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}

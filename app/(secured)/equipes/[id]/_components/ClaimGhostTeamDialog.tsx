"use client";

import { useState } from "react";
import { useToast } from "@/components/ui/toast";
import { FieldErrorText } from "@/components/ui/field-error-text";
import { PLAYER_PSEUDO_FIELD_ERRORS } from "@/lib/shared/field-errors";
import { useFieldErrors } from "@/lib/shared/hooks/useFieldErrors";
import { teamErrorMessage } from "../../_lib/team-errors";
import { jsonRequest, teamApi } from "../_lib/team-api";
import { TeamDialog } from "./TeamDialog";
import { PlayerPseudoCombobox } from "./PlayerPseudoCombobox";
import styles from "../team.module.css";

const CLAIM_FIELD_IDS = { pseudo: "claim-pseudo" } as const;

interface ClaimGhostTeamDialogProps {
  teamId: number;
  teamName: string;
  onClose: () => void;
  onChanged: () => void;
}

/**
 * Proposition de reprise d'une équipe fantôme à un joueur réel (staff
 * `tournaments`). Le joueur reçoit une invitation : c'est en l'acceptant qu'il
 * devient OWNER et que l'équipe cesse d'être fantôme — elle retrouve alors le
 * fonctionnement normal (invitations, gestion du roster par son propriétaire).
 */
export function ClaimGhostTeamDialog({ teamId, teamName, onClose, onChanged }: Readonly<ClaimGhostTeamDialogProps>) {
  const { showError, showSuccess } = useToast();
  const [pseudo, setPseudo] = useState("");
  const [busy, setBusy] = useState(false);
  const fieldErrors = useFieldErrors(PLAYER_PSEUDO_FIELD_ERRORS, CLAIM_FIELD_IDS);
  const trimmed = pseudo.trim();

  const submit = async () => {
    if (busy || !trimmed) return;
    setBusy(true);
    fieldErrors.clear();
    try {
      await teamApi(`/api/teams/${teamId}/claim`, jsonRequest("POST", { pseudo: trimmed }), "TEAM_CLAIM_FAILED");
      showSuccess(`${trimmed} est invité à reprendre ${teamName}.`);
      onClose();
      onChanged();
    } catch (e) {
      const code = (e as Error).message;
      const message = teamErrorMessage(code);
      showError(message);
      // Pseudo introuvable, joueur déjà dans une équipe : le champ est signalé
      // et reprend le focus, sans rouvrir ses suggestions.
      fieldErrors.report(code, message);
      setBusy(false);
    }
  };

  return (
    <TeamDialog
      title="Proposer l'équipe à un joueur"
      onClose={onClose}
      busy={busy}
      onSubmit={submit}
      footer={
        <>
          <button type="button" className="btn ghost" disabled={busy} onClick={onClose}>
            Annuler
          </button>
          <button type="submit" className={`btn ${styles.primaryButton}`} disabled={busy || !trimmed}>
            {busy ? "Envoi…" : "Envoyer la proposition"}
          </button>
        </>
      }
    >
      <p>
        Le joueur reçoit une invitation. S&apos;il l&apos;accepte, {teamName} cesse d&apos;être une
        équipe fantôme : il en devient propriétaire et gère lui-même son roster, historique de
        tournois compris. Rien ne change tant qu&apos;il n&apos;a pas répondu.
      </p>
      <div className="field">
        <label htmlFor="claim-pseudo">Pseudo du joueur</label>
        <PlayerPseudoCombobox
          id={CLAIM_FIELD_IDS.pseudo}
          value={pseudo}
          onChange={(value) => {
            setPseudo(value);
            fieldErrors.clear("pseudo");
          }}
          placeholder="Commence à taper un pseudo…"
          aria={fieldErrors.aria("pseudo", "claim-pseudo-help")}
        />
        <FieldErrorText fieldId={CLAIM_FIELD_IDS.pseudo} message={fieldErrors.message("pseudo")} />
        <p id="claim-pseudo-help" className={styles.help}>
          Seuls les joueurs sans équipe sont proposés : il ne doit appartenir à aucune autre.
        </p>
      </div>
    </TeamDialog>
  );
}

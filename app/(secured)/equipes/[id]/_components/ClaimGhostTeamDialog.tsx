"use client";

import { useState } from "react";
import { useToast } from "@/components/ui/toast";
import { teamErrorMessage } from "../../_lib/team-errors";
import { jsonRequest, teamApi } from "../_lib/team-api";
import { TeamDialog } from "./TeamDialog";
import { PlayerPseudoCombobox } from "./PlayerPseudoCombobox";
import styles from "../team.module.css";

interface ClaimGhostTeamDialogProps {
  teamId: number;
  teamName: string;
  onClose: () => void;
  onChanged: () => void;
}

/**
 * Attribution d'une équipe fantôme à un joueur réel (staff `tournaments`).
 * Le joueur devient OWNER et l'équipe cesse d'être fantôme : elle retrouve le
 * fonctionnement normal (invitations, gestion du roster par son propriétaire).
 */
export function ClaimGhostTeamDialog({ teamId, teamName, onClose, onChanged }: ClaimGhostTeamDialogProps) {
  const { showError, showSuccess } = useToast();
  const [pseudo, setPseudo] = useState("");
  const [busy, setBusy] = useState(false);
  const trimmed = pseudo.trim();

  const submit = async () => {
    if (busy || !trimmed) return;
    setBusy(true);
    try {
      await teamApi(`/api/teams/${teamId}/claim`, jsonRequest("POST", { pseudo: trimmed }), "TEAM_CLAIM_FAILED");
      showSuccess(`${trimmed} est désormais propriétaire de ${teamName}.`);
      onClose();
      onChanged();
    } catch (e) {
      showError(teamErrorMessage((e as Error).message));
      setBusy(false);
    }
  };

  return (
    <TeamDialog
      title="Attribuer l'équipe à un joueur"
      onClose={onClose}
      busy={busy}
      onSubmit={submit}
      allowOverflow
      footer={
        <>
          <button type="button" className="btn ghost" disabled={busy} onClick={onClose}>
            Annuler
          </button>
          <button type="submit" className={`btn ${styles.primaryButton}`} disabled={busy || !trimmed}>
            {busy ? "Attribution…" : "Attribuer l'équipe"}
          </button>
        </>
      }
    >
      <p>
        {teamName} cessera d&apos;être une équipe fantôme : le joueur en devient propriétaire et
        gère lui-même son roster. L&apos;historique de tournois est conservé.
      </p>
      <div className="field">
        <label htmlFor="claim-pseudo">Pseudo du joueur</label>
        <PlayerPseudoCombobox
          id="claim-pseudo"
          value={pseudo}
          onChange={setPseudo}
          placeholder="Commence à taper un pseudo…"
          describedBy="claim-pseudo-help"
        />
        <p id="claim-pseudo-help" className={styles.help}>
          Seuls les joueurs sans équipe sont proposés : il ne doit appartenir à aucune autre.
        </p>
      </div>
    </TeamDialog>
  );
}

"use client";

import { useState } from "react";
import { useToast } from "@/components/ui/toast";
import type { TeamDetailResponse } from "@/lib/shared/types";
import { teamErrorMessage } from "../../_lib/team-errors";
import { jsonRequest, teamApi } from "../_lib/team-api";
import { ConfirmDialog } from "./ConfirmDialog";
import { ModerationReasonField, isModerationReasonReady } from "@/components/moderation/ModerationReasonField";
import styles from "../team.module.css";

/**
 * Retrait du logo par la modération (permission `moderation`), sans gérer
 * l'équipe : le geste qui suit un signalement de droit d'auteur.
 *
 * Rendu seulement si l'équipe **a** un logo. La gestion de l'équipe garde son
 * propre bouton « Retirer le logo » ; celui-ci passe par la route de
 * modération, qui ne demande ni rôle dans l'équipe ni conditions acceptées, et
 * laisse une trace dans le journal du staff. Hors signalement, le **motif**
 * est exigé : c'est le fait que le message à l'équipe expose (DSA, art. 17).
 */
export function ModerationLogoBar({ team, onChanged }: Readonly<{ team: TeamDetailResponse; onChanged: () => void }>) {
  const { showError, showSuccess } = useToast();
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");

  if (!team.canModerate || !team.team.logoUrl) return null;

  const remove = async (): Promise<boolean> => {
    try {
      await teamApi(`/api/admin/teams/${team.team.id}/logo`, jsonRequest("DELETE", { reason }), "TEAM_LOGO_REMOVE_FAILED");
      showSuccess("Logo retiré. L'équipe s'affiche désormais avec l'initiale de son nom.");
      setConfirming(false);
      setReason("");
      onChanged();
      return true;
    } catch (error) {
      showError(teamErrorMessage((error as Error).message));
      return false;
    }
  };

  return (
    <fieldset className={`native-group ${styles.moderationBar}`} aria-label="Modération">
      <span className={styles.moderationLabel}>MODÉRATION</span>
      <button type="button" className="btn ghost" onClick={() => setConfirming(true)}>
        Retirer le logo
      </button>
      {confirming && (
        <ConfirmDialog
          title="Retirer le logo de l'équipe ?"
          confirmLabel="Retirer le logo"
          pendingLabel="Retrait…"
          disabled={!isModerationReasonReady(reason)}
          onClose={() => setConfirming(false)}
          onConfirm={remove}
        >
          <p>
            Le logo de « {team.team.name} » est effacé du site et de la sauvegarde des images. L&apos;équipe garde
            tout le reste ; sa gestion pourra en envoyer un autre.
          </p>
          <ModerationReasonField value={reason} onChange={setReason} recipient="ses membres" />
        </ConfirmDialog>
      )}
    </fieldset>
  );
}

"use client";

import { useState } from "react";
import type { TeamMember } from "@/lib/shared/types";
import { useToast } from "@/components/ui/toast";
import { sortTeamMembers } from "@/lib/shared/team-role-display";
import { useTeamErrorMessage } from "@/components/i18n/team-errors-text";
import { useTeamPageText } from "@/components/i18n/team-page-text";
import { jsonRequest, teamApi } from "../_lib/team-api";
import { BusyButton } from "@/components/ui/busy-button";
import { BusyLabel } from "@/components/ui/busy-label";
import { useBusyGuard } from "@/lib/shared/hooks/useBusyGuard";
import { TeamDialog } from "./TeamDialog";
import { RolePills } from "./RolePills";
import styles from "../team.module.css";

interface TransferOwnershipDialogProps {
  teamId: number;
  members: TeamMember[];
  onClose: () => void;
  onChanged: () => void;
}

export function TransferOwnershipDialog({ teamId, members, onClose, onChanged }: Readonly<TransferOwnershipDialogProps>) {
  const [targetId, setTargetId] = useState<number | null>(null);
  const [confirmStep, setConfirmStep] = useState(false);
  // Garde synchrone : un double clic au second temps transférait deux fois.
  const { busy: pending, isBusy, run, hold } = useBusyGuard();
  const { showError, showSuccess } = useToast();
  const { t } = useTeamPageText();
  const teamErrorMessage = useTeamErrorMessage();

  // Un compte supprimé reste au roster mais ne peut plus rien conduire : le
  // serveur le refuse (`MEMBER_ACCOUNT_DELETED`), la liste ne le propose pas.
  const candidates = sortTeamMembers(members.filter((m) => !m.roles.includes("OWNER") && !m.isDeleted));
  const owner = members.find((m) => m.roles.includes("OWNER"));
  const target = candidates.find((m) => m.userId === targetId) ?? null;
  // Ce que garde l'ancien propriétaire : ses autres rôles, aucun s'il n'en
  // avait aucun (`transferTeamOwnership`). Sans MANAGER, il perd la gestion.
  const ownerKeepsManagement = owner?.roles.includes("MANAGER") ?? false;

  const submit = () => {
    if (!target || isBusy()) return;
    if (!confirmStep) {
      setConfirmStep(true);
      return;
    }
    void run(async () => {
      try {
        await teamApi(
          `/api/teams/${teamId}/transfer-ownership`,
          jsonRequest("POST", { newOwnerUserId: target.userId }),
          "TEAM_OWNERSHIP_TRANSFER_FAILED",
        );
        showSuccess(t("transfer.done", { pseudo: target.pseudo }));
        hold();
        onClose();
        onChanged();
      } catch (e) {
        showError(teamErrorMessage((e as Error).message));
      }
    });
  };

  const submitLabel = confirmStep ? t("transfer.confirm") : t("transfer.submit");

  return (
    <TeamDialog
      title={t("transfer.title")}
      onClose={onClose}
      busy={pending}
      onSubmit={submit}
      tone={confirmStep ? "danger" : "default"}
      footer={
        <>
          <BusyButton className="btn ghost" busy={false} blocked={pending} onClick={onClose}>
            {t("transfer.cancel")}
          </BusyButton>
          {/* Aucun membre choisi : refusé mais focalisable (`blocked`). */}
          <BusyButton
            type="submit"
            className={`btn ${confirmStep ? "danger" : styles.primaryButton}`}
            busy={pending}
            blocked={!target}
          >
            <BusyLabel busy={pending} idle={submitLabel} pending={t("transfer.pending")} />
          </BusyButton>
        </>
      }
    >
      <p>{ownerKeepsManagement ? t("transfer.bodyKeepsManagement") : t("transfer.bodyLosesManagement")}</p>

      {candidates.length === 0 ? (
        <p>{t("transfer.noCandidate")}</p>
      ) : (
        // Pas de zone défilante : c'est le voile de la modale qui défile. Une
        // `ScrollArea` poserait `tabIndex={0}` — elle prendrait le focus
        // initial et ajouterait un arrêt clavier avant les boutons radio.
        <div role="radiogroup" aria-label={t("transfer.newOwner")} className={styles.choiceList}>
          {candidates.map((m) => (
            <label key={m.userId} className={styles.choice} data-checked={targetId === m.userId}>
              <input
                type="radio"
                name="transfer-target"
                checked={targetId === m.userId}
                // Figé pendant l'envoi (le focus reste, `aria-disabled`) : un
                // autre choix ne change pas le membre qui part.
                aria-disabled={pending || undefined}
                onChange={() => {
                  if (isBusy()) return;
                  setTargetId(m.userId);
                  setConfirmStep(false);
                }}
              />
              <span className={styles.choiceName}>{m.pseudo}</span>
              <span className={styles.choiceRoles}>
                <RolePills roles={m.roles} label={t("transfer.rolesOf", { pseudo: m.pseudo })} />
              </span>
            </label>
          ))}
        </div>
      )}

      {confirmStep && target ? (
        <p /* NOSONAR S6819 — région live d'état, pas le résultat d'un formulaire */ className={styles.help} role="status">
          {t("transfer.lastCheck", { pseudo: target.pseudo })}
        </p>
      ) : null}
    </TeamDialog>
  );
}

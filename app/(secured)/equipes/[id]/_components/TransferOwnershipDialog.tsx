"use client";

import { useState } from "react";
import type { TeamMember } from "@/lib/shared/types";
import { useToast } from "@/components/ui/toast";
import { sortTeamMembers } from "@/lib/shared/team-role-display";
import { teamErrorMessage } from "../../_lib/team-errors";
import { jsonRequest, teamApi } from "../_lib/team-api";
import { TeamDialog } from "./TeamDialog";
import { RolePills } from "./RolePills";
import styles from "../team.module.css";

interface TransferOwnershipDialogProps {
  teamId: number;
  members: TeamMember[];
  onClose: () => void;
  onChanged: () => void;
}

export function TransferOwnershipDialog({ teamId, members, onClose, onChanged }: TransferOwnershipDialogProps) {
  const [targetId, setTargetId] = useState<number | null>(null);
  const [confirmStep, setConfirmStep] = useState(false);
  const [pending, setPending] = useState(false);
  const { showError, showSuccess } = useToast();

  // Un compte supprimé reste au roster mais ne peut plus rien conduire : le
  // serveur le refuse (`MEMBER_ACCOUNT_DELETED`), la liste ne le propose pas.
  const candidates = sortTeamMembers(members.filter((m) => !m.roles.includes("OWNER") && !m.isDeleted));
  const owner = members.find((m) => m.roles.includes("OWNER"));
  const target = candidates.find((m) => m.userId === targetId) ?? null;
  // Ce que garde l'ancien propriétaire : ses autres rôles, ou DPS s'il n'en
  // avait aucun (`transferTeamOwnership`). Sans MANAGER, il perd la gestion.
  const ownerKeepsManagement = owner?.roles.includes("MANAGER") ?? false;

  const submit = async () => {
    if (!target || pending) return;
    if (!confirmStep) {
      setConfirmStep(true);
      return;
    }
    setPending(true);
    try {
      await teamApi(
        `/api/teams/${teamId}/transfer-ownership`,
        jsonRequest("POST", { newOwnerUserId: target.userId }),
        "TEAM_OWNERSHIP_TRANSFER_FAILED",
      );
      showSuccess(`${target.pseudo} est désormais propriétaire de l'équipe.`);
      onClose();
      onChanged();
    } catch (e) {
      showError(teamErrorMessage((e as Error).message));
      setPending(false);
    }
  };

  return (
    <TeamDialog
      title="Transférer la propriété"
      onClose={onClose}
      busy={pending}
      onSubmit={submit}
      tone={confirmStep ? "danger" : "default"}
      footer={
        <>
          <button type="button" className="btn ghost" disabled={pending} onClick={onClose}>
            Annuler
          </button>
          <button
            type="submit"
            className={`btn ${confirmStep ? "danger" : styles.primaryButton}`}
            disabled={!target || pending}
          >
            {pending ? "Transfert…" : confirmStep ? "Confirmer définitivement" : "Transférer"}
          </button>
        </>
      }
    >
      <p>
        Le nouveau propriétaire pourra renommer, transférer et dissoudre l&apos;équipe. Tu perds le
        rôle de propriétaire et gardes tes autres rôles
        {ownerKeepsManagement
          ? " — dont celui de manager : tu continues de gérer le roster."
          : " (DPS si tu n'en as pas d'autre) : sans le rôle de manager, tu ne gères plus l'équipe."}
      </p>

      {candidates.length === 0 ? (
        <p>Aucun autre membre dans l&apos;équipe : invite d&apos;abord le joueur à qui la confier.</p>
      ) : (
        <div className={styles.choiceList} role="radiogroup" aria-label="Nouveau propriétaire">
          {candidates.map((m) => (
            <label key={m.userId} className={styles.choice} data-checked={targetId === m.userId}>
              <input
                type="radio"
                name="transfer-target"
                checked={targetId === m.userId}
                onChange={() => {
                  setTargetId(m.userId);
                  setConfirmStep(false);
                }}
              />
              <span className={styles.choiceName}>{m.pseudo}</span>
              <span className={styles.choiceRoles}>
                <RolePills roles={m.roles} label={`Rôles de ${m.pseudo}`} />
              </span>
            </label>
          ))}
        </div>
      )}

      {confirmStep && target ? (
        <p className={styles.help} role="status">
          Dernière vérification : {target.pseudo} deviendra propriétaire, et sera la seule
          personne à pouvoir te rendre ce rôle.
        </p>
      ) : null}
    </TeamDialog>
  );
}

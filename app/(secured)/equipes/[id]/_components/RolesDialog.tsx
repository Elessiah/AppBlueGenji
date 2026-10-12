"use client";

import { useState } from "react";
import type { TeamRole } from "@/lib/shared/types";
import { useToast } from "@/components/ui/toast";
import { useTeamErrorMessage } from "@/components/i18n/team-errors-text";
import { useTeamPageText } from "@/components/i18n/team-page-text";
import { TeamDialog } from "./TeamDialog";
import { RolePicker } from "./RolePicker";
import styles from "../team.module.css";

export interface RolesDialogTarget {
  userId: number;
  pseudo: string;
  isOwner: boolean;
  /** Rôles actuels, `OWNER` retiré : il ne se coche pas. */
  selected: TeamRole[];
  /** La modale édite les rôles de qui l'a ouverte. */
  isViewer: boolean;
}

interface RolesDialogProps {
  target: RolesDialogTarget;
  onClose: () => void;
  /** Rend `true` si l'enregistrement a réussi — la modale ne se ferme qu'alors. */
  onSave: (selected: TeamRole[]) => Promise<boolean>;
}

export function RolesDialog({ target, onClose, onSave }: Readonly<RolesDialogProps>) {
  const [selected, setSelected] = useState(target.selected);
  const [pending, setPending] = useState(false);
  const { showError } = useToast();
  const { t } = useTeamPageText();
  const teamErrorMessage = useTeamErrorMessage();

  const unchanged =
    selected.length === target.selected.length && selected.every((role) => target.selected.includes(role));
  const empty = selected.length === 0;
  // Se retirer soi-même le rôle de manager, c'est perdre la main sur l'équipe
  // au clic suivant : ça se fait, mais ça se dit avant.
  const dropsOwnManagement =
    target.isViewer &&
    !target.isOwner &&
    target.selected.includes("MANAGER") &&
    !selected.includes("MANAGER");

  const save = async () => {
    if (unchanged || pending) return;
    // Le refus se dit en notification, comme tout message d'erreur du site —
    // et non par un bouton grisé sans explication.
    if (empty) {
      showError(teamErrorMessage("MISSING_ROLE"));
      return;
    }
    setPending(true);
    const ok = await onSave(selected);
    // Refus : la modale reste ouverte avec la sélection, pour corriger.
    if (!ok) setPending(false);
  };

  return (
    <TeamDialog
      title={target.isViewer ? t("roles.myRoles") : t("roles.rolesOf", { pseudo: target.pseudo })}
      onClose={onClose}
      busy={pending}
      onSubmit={save}
      footer={
        <>
          <button type="button" className="btn ghost" onClick={onClose} disabled={pending}>
            {t("roles.cancel")}
          </button>
          <button type="submit" className={`btn ${styles.primaryButton}`} disabled={unchanged || pending}>
            {pending ? t("roles.saving") : t("roles.save")}
          </button>
        </>
      }
    >
      {target.isOwner ? (
        <p>{t("roles.ownerNotice")}</p>
      ) : null}
      <RolePicker selected={selected} onChange={setSelected} />
      {dropsOwnManagement ? (
        <p className={styles.help}>{t("roles.dropsManagement")}</p>
      ) : null}
    </TeamDialog>
  );
}

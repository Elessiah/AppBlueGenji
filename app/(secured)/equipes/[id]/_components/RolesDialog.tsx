"use client";

import { useState } from "react";
import type { TeamRole } from "@/lib/shared/types";
import { MANAGER_ASSIGNABLE_ROLES } from "@/lib/shared/team-role-display";
import { useTeamPageText } from "@/components/i18n/team-page-text";
import { TeamDialog } from "./TeamDialog";
import { RoleTable } from "./RoleTable";
import { memberRolesToSave } from "../_lib/member-roles";
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
  const { t } = useTeamPageText();

  const toSave = memberRolesToSave(target.selected, selected);
  const unchanged = toSave === null;
  // Se retirer soi-même le rôle de manager, c'est perdre la main sur l'équipe
  // au clic suivant : ça se fait, mais ça se dit avant.
  const dropsOwnManagement =
    target.isViewer &&
    !target.isOwner &&
    target.selected.includes("MANAGER") &&
    !selected.includes("MANAGER");

  const save = async () => {
    // Une sélection vide est permise : un membre peut n'avoir aucun rôle
    // (décision D71, il choisit lui-même ses rôles de jeu).
    if (toSave === null || pending) return;
    setPending(true);
    const ok = await onSave(toSave);
    // Refus : la modale reste ouverte avec la sélection, pour corriger.
    if (!ok) setPending(false);
  };

  return (
    <TeamDialog
      title={target.isViewer ? t("roles.myRoles") : t("roles.rolesOf", { pseudo: target.pseudo })}
      onClose={onClose}
      busy={pending}
      onSubmit={save}
      wide
      footer={
        <>
          <button
            type="button"
            className="btn ghost"
            onClick={pending ? undefined : onClose}
            aria-disabled={pending || undefined}
          >
            {t("roles.cancel")}
          </button>
          <button
            type="submit"
            className={`btn ${styles.primaryButton}`}
            disabled={unchanged && !pending}
            aria-disabled={pending || undefined}
            aria-busy={pending || undefined}
          >
            {pending ? t("roles.saving") : t("roles.save")}
          </button>
        </>
      }
    >
      {target.isOwner ? (
        <p>{t("roles.ownerNotice")}</p>
      ) : null}
      <RoleTable selected={selected} onChange={setSelected} checkable={MANAGER_ASSIGNABLE_ROLES} />
      {dropsOwnManagement ? (
        <p className={styles.help}>{t("roles.dropsManagement")}</p>
      ) : null}
    </TeamDialog>
  );
}

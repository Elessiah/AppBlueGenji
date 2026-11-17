"use client";

import { useState } from "react";
import type { TeamRole } from "@/lib/shared/types";
import { MANAGER_ASSIGNABLE_ROLES } from "@/lib/shared/team-role-display";
import { useTeamPageText } from "@/components/i18n/team-page-text";
import { useToast } from "@/components/ui/toast";
import { BusyButton } from "@/components/ui/busy-button";
import { BusyLabel } from "@/components/ui/busy-label";
import { useBusyGuard } from "@/lib/shared/hooks/useBusyGuard";
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
  // Garde synchrone : un double clic (ou Entrée répétée) enregistrait deux fois.
  const { busy: pending, isBusy, run, hold } = useBusyGuard();
  const { t } = useTeamPageText();
  const { showError } = useToast();

  const toSave = memberRolesToSave(target.selected, selected);
  const unchanged = toSave === null;
  // Se retirer soi-même le rôle de manager, c'est perdre la main sur l'équipe
  // au clic suivant : ça se fait, mais ça se dit avant.
  const dropsOwnManagement =
    target.isViewer &&
    !target.isOwner &&
    target.selected.includes("MANAGER") &&
    !selected.includes("MANAGER");

  const save = () => {
    // Une sélection vide est permise : un membre peut n'avoir aucun rôle
    // (décision D71, il choisit lui-même ses rôles de jeu).
    if (toSave === null) return;
    void run(async () => {
      const ok = await onSave(toSave);
      // Succès : en attente jusqu'à la fermeture par l'appelant. Refus : la
      // modale se rend avec la sélection, pour corriger.
      if (ok) hold();
    });
  };
  // Cocher pendant l'envoi changerait l'écran sous la requête : ignoré.
  const change = (roles: TeamRole[]) => {
    if (!isBusy()) setSelected(roles);
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
          <BusyButton className="btn ghost" busy={false} blocked={pending} onClick={onClose}>
            {t("roles.cancel")}
          </BusyButton>
          {/* Rien à enregistrer : refusé mais focalisable (`blocked`). */}
          <BusyButton type="submit" className={`btn ${styles.primaryButton}`} busy={pending}
            blocked={unchanged}
            // Désarmé mais focalisable : activé, il dit pourquoi rien ne part.
            onBlockedClick={() => showError(t("roles.unchanged"), { once: true })}
          >
            <BusyLabel busy={pending} idle={t("roles.save")} pending={t("roles.saving")} />
          </BusyButton>
        </>
      }
    >
      {target.isOwner ? (
        <p>{t("roles.ownerNotice")}</p>
      ) : null}
      <RoleTable selected={selected} onChange={change} checkable={MANAGER_ASSIGNABLE_ROLES} readOnly={pending} />
      {dropsOwnManagement ? (
        <p className={styles.help}>{t("roles.dropsManagement")}</p>
      ) : null}
    </TeamDialog>
  );
}

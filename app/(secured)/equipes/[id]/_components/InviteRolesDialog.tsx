"use client";

import { useState } from "react";
import type { TeamRole } from "@/lib/shared/types";
import { MANAGER_ASSIGNABLE_ROLES } from "@/lib/shared/team-role-display";
import { useTeamPageText } from "@/components/i18n/team-page-text";
import { InfoHint, InfoHintRow } from "@/components/ui/info-hint";
import { TeamDialog } from "./TeamDialog";
import { RoleTable } from "./RoleTable";
import styles from "../team.module.css";

interface InviteRolesDialogProps {
  /** Pseudo saisi, tel qu'il partira. */
  pseudo: string;
  /** Rôles déjà cochés : ceux d'une tentative dont le pseudo a été refusé. */
  initialRoles?: readonly TeamRole[];
  onClose: () => void;
  /** Rend `true` si l'invitation est partie — la modale ne se ferme qu'alors (ou sur un refus du pseudo, que l'appelant gère). */
  onConfirm: (roles: TeamRole[]) => Promise<boolean>;
}

/**
 * Deuxième temps de l'invitation : les rôles à donner au joueur à son arrivée.
 *
 * Le formulaire de la page ne garde que le pseudo : ses pastilles de rôles,
 * posées à côté du roster, se lisaient comme les rôles **du lecteur** — un
 * joueur les a cochées pour se donner les siens, et rien n'a été enregistré.
 * Ici, rien n'est coché d'avance (décision D71) : inviter sans rôle est permis,
 * le joueur choisira ses rôles de jeu lui-même (« Mes rôles »).
 */
export function InviteRolesDialog({ pseudo, initialRoles = [], onClose, onConfirm }: Readonly<InviteRolesDialogProps>) {
  const [selected, setSelected] = useState<TeamRole[]>([...initialRoles]);
  const [pending, setPending] = useState(false);
  const { t } = useTeamPageText();

  const send = async () => {
    if (pending) return;
    setPending(true);
    const ok = await onConfirm(selected);
    // Refus : la modale reste ouverte avec la sélection (si l'appelant ne l'a
    // pas fermée pour montrer le refus sur le champ du pseudo).
    if (!ok) setPending(false);
  };

  return (
    <TeamDialog
      title={t("inviteDialog.title", { pseudo })}
      onClose={onClose}
      busy={pending}
      onSubmit={() => void send()}
      wide
      footer={
        <>
          <button
            type="button"
            className="btn ghost"
            onClick={pending ? undefined : onClose}
            aria-disabled={pending || undefined}
          >
            {t("inviteDialog.cancel")}
          </button>
          <button
            type="submit"
            className={`btn ${styles.primaryButton}`}
            aria-disabled={pending || undefined}
            aria-busy={pending || undefined}
          >
            {pending ? t("inviteDialog.sending") : t("inviteDialog.confirm")}
          </button>
        </>
      }
    >
      <InfoHintRow>
        <span className={styles.roleTableLead}>{t("inviteDialog.lead")}</span>
        <InfoHint id="team-invite-roles-help" subject={t("inviteDialog.lead")}>
          <p>{t("inviteDialog.intro")}</p>
        </InfoHint>
      </InfoHintRow>
      <RoleTable selected={selected} onChange={setSelected} checkable={MANAGER_ASSIGNABLE_ROLES} />
    </TeamDialog>
  );
}

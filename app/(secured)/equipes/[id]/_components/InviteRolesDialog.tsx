"use client";

import { useState } from "react";
import type { TeamRole } from "@/lib/shared/types";
import { MANAGER_ASSIGNABLE_ROLES } from "@/lib/shared/team-role-display";
import { useTeamPageText } from "@/components/i18n/team-page-text";
import { InfoHint, InfoHintRow } from "@/components/ui/info-hint";
import { BusyButton } from "@/components/ui/busy-button";
import { BusyLabel } from "@/components/ui/busy-label";
import { useBusyGuard } from "@/lib/shared/hooks/useBusyGuard";
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
  // Garde synchrone : un double clic (ou Entrée répétée) invitait deux fois.
  const { busy: pending, isBusy, run, hold } = useBusyGuard();
  const { t } = useTeamPageText();

  const send = () =>
    run(async () => {
      const ok = await onConfirm(selected);
      // Succès : la modale reste en attente jusqu'à sa fermeture par l'appelant.
      // Refus : elle se rend avec la sélection (si l'appelant ne l'a pas fermée
      // pour montrer le refus sur le champ du pseudo).
      if (ok) hold();
    });
  // Cocher pendant l'envoi changerait l'écran sous la requête : ignoré.
  const change = (roles: TeamRole[]) => {
    if (!isBusy()) setSelected(roles);
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
          <BusyButton className="btn ghost" busy={false} blocked={pending} onClick={onClose}>
            {t("inviteDialog.cancel")}
          </BusyButton>
          <BusyButton type="submit" className={`btn ${styles.primaryButton}`} busy={pending}>
            <BusyLabel busy={pending} idle={t("inviteDialog.confirm")} pending={t("inviteDialog.sending")} />
          </BusyButton>
        </>
      }
    >
      <InfoHintRow>
        <span className={styles.roleTableLead}>{t("inviteDialog.lead")}</span>
        <InfoHint id="team-invite-roles-help" subject={t("inviteDialog.lead")}>
          <p>{t("inviteDialog.intro")}</p>
        </InfoHint>
      </InfoHintRow>
      <RoleTable selected={selected} onChange={change} checkable={MANAGER_ASSIGNABLE_ROLES} readOnly={pending} />
    </TeamDialog>
  );
}

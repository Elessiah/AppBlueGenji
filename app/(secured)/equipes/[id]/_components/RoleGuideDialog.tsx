"use client";

import { useTeamPageText } from "@/components/i18n/team-page-text";
import { TeamDialog } from "./TeamDialog";
import { RoleTable } from "./RoleTable";

/**
 * « Ce que fait chaque rôle », en lecture seule : ouvert depuis « Mes rôles »,
 * pour le membre qui ne gère pas l'équipe et ne voit donc jamais la modale des
 * rôles ni celle de l'invitation, qui portent le même tableau.
 */
export function RoleGuideDialog({ onClose }: Readonly<{ onClose: () => void }>) {
  const { t } = useTeamPageText();
  return (
    <TeamDialog
      title={t("roleGuide.title")}
      onClose={onClose}
      wide
      footer={
        <button type="button" className="btn ghost" onClick={onClose}>
          {t("roleGuide.close")}
        </button>
      }
    >
      <RoleTable />
    </TeamDialog>
  );
}

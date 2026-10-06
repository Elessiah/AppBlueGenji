"use client";

import { Pill } from "@/components/cyber";
import { useRecruitmentText } from "@/components/i18n/recruitment-text";

/**
 * Pastille clignotante « Urgente » d'une annonce **prioritaire**.
 *
 * Un seul composant pour la carte, la lecture en grand, la modale d'arrivée et
 * la banderole : la pastille est la promesse visible du statut, elle ne doit
 * pas changer de mot ni de forme d'un écran à l'autre. Le clignotement
 * (`.pill-urgent`) suit le régime de charge comme toute animation infinie.
 * Ambre d'avertissement (`pill-warning`) : le rouge est réservé au direct.
 */
export function UrgentPill({ className = "" }: Readonly<{ className?: string }>) {
  const { t } = useRecruitmentText();
  return (
    <Pill variant="warning" className={`pill-urgent ${className}`.trim()}>
      {t("card.urgent")}
    </Pill>
  );
}

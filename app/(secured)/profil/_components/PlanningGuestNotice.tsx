"use client";

import { useProfileText } from "@/components/i18n/profile-text";
import { InfoHint, InfoHintRow } from "@/components/ui/info-hint";
import s from "../profil.module.css";

const HINT_ID = "profile-planning-guest-hint";

/**
 * Sa propre marque « invité » (hors planning, `CAST_PLANNING.md` § Invités),
 * en lecture seule sur « Mon profil » : le planning ne prévient plus le
 * titulaire, la fiche lui dit qu'il a été marqué, et comment s'y opposer.
 * Rien n'est rendu sans la marque.
 */
export function PlanningGuestNotice({ guest }: Readonly<{ guest: boolean | undefined }>): React.ReactElement | null {
  const { t } = useProfileText();
  if (guest !== true) return null;
  return (
    <div className={`field ${s.matchDms}`}>
      <InfoHintRow separated>
        <span style={{ fontSize: 14, color: "var(--ink)" }}>{t("planningGuest.label")}</span>
        <InfoHint id={HINT_ID} subject={t("planningGuest.label")}>
          <p>{t("planningGuest.hint")}</p>
        </InfoHint>
      </InfoHintRow>
    </div>
  );
}

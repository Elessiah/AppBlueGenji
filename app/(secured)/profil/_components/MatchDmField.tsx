"use client";

import { useRef, useState } from "react";
import { Coche } from "@/components/Coche";
import { useProfileText } from "@/components/i18n/profile-text";
import { useToast } from "@/components/ui/toast";
import { profileErrorMessage } from "../profile-errors";
import s from "../profil.module.css";

const FIELD_ID = "profile-match-dms";
const HINT_ID = "profile-match-dms-hint";

/**
 * Messages privés Discord de match (`bg_users.match_dm_enabled`) : le droit
 * d'opposition du joueur aux messages que le bot lui envoie pour ses matchs
 * (`lib/server/users/match-dm-preference.ts`). Les notifications push gardent
 * leurs réglages par sujet, juste au-dessus.
 *
 * Enregistré au clic, sans bouton : un seul geste, réversible. Pendant
 * l'envoi, la case reste focalisable (`aria-busy`) ; un second clic attend la
 * réponse du premier.
 */
export function MatchDmField({ initial }: Readonly<{ initial: boolean }>): React.ReactElement {
  const text = useProfileText();
  const { t } = text;
  const { showError, showSuccess } = useToast();
  const [enabled, setEnabled] = useState(initial);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const toggle = async () => {
    if (busyRef.current) return;
    const next = !enabled;
    busyRef.current = true;
    setBusy(true);
    setEnabled(next);
    try {
      const response = await fetch("/api/profile/match-dms", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "PROFILE_UPDATE_FAILED");
      showSuccess(t(next ? "matchDms.enabled" : "matchDms.disabled"));
    } catch (e) {
      // Rien d'enregistré : la case reprend l'état que la base garde.
      setEnabled(!next);
      showError(profileErrorMessage((e as Error).message, text));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  return (
    <div className={`field ${s.matchDms}`}>
      <div className={s.toggleRow}>
        <Coche
          id={FIELD_ID}
          label={t("matchDms.label")}
          checked={enabled}
          theme="joueur"
          aria-busy={busy || undefined}
          aria-describedby={HINT_ID}
          onChange={() => void toggle()}
        />
      </div>
      <p id={HINT_ID} className={s.hint}>
        {t("matchDms.hint")}
      </p>
    </div>
  );
}

"use client";

import { useState } from "react";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";
import { InfoHint, InfoHintRow } from "@/components/ui/info-hint";
import { useToast } from "@/components/ui/toast";
import { useStaffLang } from "@/components/i18n/staff-lang";
import { BUSY_REFUSED_MESSAGE } from "@/lib/shared/busy-refused-message";
import { useBusyGuard } from "@/lib/shared/hooks/useBusyGuard";
import { reloadSucceeded } from "@/lib/shared/reload-outcome";
import { planningGuestErrorMessage } from "../_lib/planning-guest-errors";

/**
 * Case « Invité » de la fiche d'un joueur (`docs/features/CAST_PLANNING.md`
 * § Invités), dans le bloc « Rôles & permissions » : réservée au staff qui
 * tient `roles`, jamais sur sa propre fiche. Cocher passe par une
 * confirmation (le compte quitte ses créneaux à venir) ; décocher s'enregistre
 * aussitôt. Outil de l'administration : français sous `/en` (D4), comme le panneau.
 */
export function PlanningGuestField({
  userId,
  pseudo,
  guest,
  onSaved,
}: Readonly<{
  userId: string;
  pseudo: string;
  guest: boolean;
  /** Relit la fiche ; `false` : relecture échouée. */
  onSaved: () => Promise<boolean | void> | void;
}>) {
  const { showError, showInfo, showSuccess } = useToast();
  const staffLang = useStaffLang();
  const toastLang = staffLang ? { lang: staffLang } : undefined;
  const { busy, isBusy, run } = useBusyGuard();
  const [confirming, setConfirming] = useState(false);

  const send = async (next: boolean): Promise<boolean> => {
    try {
      const res = await fetch(`/api/admin/users/${userId}/planning-guest`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ guest: next }),
      });
      const payload = (await res.json().catch(() => ({}))) as { error?: string; failed?: number };
      if (!res.ok) throw new Error(payload.error || "PLANNING_GUEST_UPDATE_FAILED");
      if (!next) showSuccess(`${pseudo} rejoint le planning.`, toastLang);
      else if ((payload.failed ?? 0) > 0)
        showInfo(`${pseudo} est invité ; des créneaux à venir n'ont pas pu être quittés : retire-les depuis le planning.`, toastLang);
      else showSuccess(`${pseudo} est invité : hors planning.`, toastLang);
      if (!(await reloadSucceeded(onSaved))) showError(planningGuestErrorMessage("PROFILE_RELOAD_FAILED"), toastLang);
      return true;
    } catch (error) {
      showError(planningGuestErrorMessage((error as Error).message), toastLang);
      return false;
    }
  };

  const save = async (next: boolean): Promise<boolean> => {
    const done = await run(() => send(next));
    if (done === undefined) {
      showInfo(BUSY_REFUSED_MESSAGE, { ...toastLang, once: true });
      return false;
    }
    return done;
  };

  const onChange = () => {
    if (isBusy()) {
      showInfo(BUSY_REFUSED_MESSAGE, { ...toastLang, once: true });
      return;
    }
    if (guest) void save(false);
    else setConfirming(true);
  };

  return (
    <div style={{ marginTop: 18, paddingTop: 14, borderTop: "1px solid rgba(var(--violet-400-rgb), 0.2)" }}>
      <InfoHintRow>
        <label // NOSONAR S6853 — label englobant : la case et son libellé sont à l'intérieur
          style={{ display: "flex", alignItems: "center", gap: 12, cursor: busy ? "default" : "pointer" }}
        >
          <input
            type="checkbox"
            checked={guest}
            aria-readonly={busy || undefined}
            aria-describedby="player-planning-guest-help"
            onChange={onChange}
          />
          <span style={{ fontSize: 14, color: "var(--ink)" }}>Invité</span>
        </label>
        <InfoHint id="player-planning-guest-help" subject="Invité">
          <p>Hors planning : garde ses droits de caster/prod mais n&apos;apparaît pas au planning.</p>
        </InfoHint>
      </InfoHintRow>
      {confirming ? (
        <ConfirmActionDialog
          contentLang={staffLang}
          title={`Passer ${pseudo} en invité ?`}
          confirmLabel="Passer en invité"
          pendingLabel="Enregistrement…"
          tone="danger"
          onClose={() => setConfirming(false)}
          onConfirm={() => save(true)}
        >
          <p>
            Il garde ses rôles et peut toujours caster un match, mais il sort du planning : il quitte ses créneaux
            à venir (un remplaçant est cherché comme pour un désistement), ses disponibilités à venir sont effacées
            et il n&apos;y est plus proposé ni prévenu. Son historique reste.
          </p>
        </ConfirmActionDialog>
      ) : null}
    </div>
  );
}

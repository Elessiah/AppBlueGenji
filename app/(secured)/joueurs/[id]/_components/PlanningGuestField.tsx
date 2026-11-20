"use client";

import { useState } from "react";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";
import { InfoHint, InfoHintRow } from "@/components/ui/info-hint";
import { useToast } from "@/components/ui/toast";
import { usePlayersText } from "@/components/i18n/players-text";
import type { BusyGuard } from "@/lib/shared/hooks/useBusyGuard";
import { reloadSucceeded } from "@/lib/shared/reload-outcome";
import { planningGuestErrorMessage } from "../_lib/planning-guest-errors";

/**
 * Case « Invité » de la fiche d'un joueur (`docs/features/CAST_PLANNING.md`
 * § Invités), dans le bloc « Rôles & permissions » : réservée au staff qui
 * tient `roles`, jamais sur sa propre fiche. Cocher passe par une
 * confirmation (le compte quitte ses créneaux à venir) ; décocher s'enregistre
 * aussitôt. Ses textes sont traduits (`players.planningGuest`), à la
 * différence du reste du panneau, resté français (D4).
 */
export function PlanningGuestField({
  userId,
  pseudo,
  guest,
  guard,
  onSaved,
}: Readonly<{
  userId: string;
  pseudo: string;
  /** Valeur lue ; `null` : la lecture du drapeau a échoué, la case est offerte désactivée. */
  guest: boolean | null;
  /** Garde du panneau, partagée avec l'envoi des rôles : un seul envoi à la fois sur ce compte. */
  guard: BusyGuard;
  /** Relit la fiche ; `false` : relecture échouée. */
  onSaved: () => Promise<boolean | void> | void;
}>) {
  const { showError, showInfo, showSuccess } = useToast();
  const text = usePlayersText();
  const { busy, isBusy, run } = guard;
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
      if (!next) showSuccess(text.t("planningGuest.saved.member", { pseudo }));
      else if ((payload.failed ?? 0) > 0) showError(text.t("planningGuest.saved.partial", { pseudo }));
      else showSuccess(text.t("planningGuest.saved.guest", { pseudo }));
      if (!(await reloadSucceeded(onSaved))) showError(planningGuestErrorMessage("PROFILE_RELOAD_FAILED", text));
      return true;
    } catch (error) {
      showError(planningGuestErrorMessage((error as Error).message, text));
      return false;
    }
  };

  const save = async (next: boolean): Promise<boolean> => {
    const done = await run(() => send(next));
    if (done === undefined) {
      showInfo(text.t("planningGuest.busy"), { once: true });
      return false;
    }
    return done;
  };

  const onChange = () => {
    if (isBusy()) {
      showInfo(text.t("planningGuest.busy"), { once: true });
      return;
    }
    if (guest === null) return;
    if (guest) void save(false);
    else setConfirming(true);
  };

  return (
    // Traduit dans un panneau resté français (`lang="fr"` sous `/en`) : la langue de la page, redite (WCAG 3.1.2).
    <div lang={text.locale} style={{ marginTop: 18, paddingTop: 14, borderTop: "1px solid rgba(var(--violet-400-rgb), 0.2)" }}>
      <InfoHintRow>
        <label // NOSONAR S6853 — label englobant : la case et son libellé sont à l'intérieur
          style={{ display: "flex", alignItems: "center", gap: 12, cursor: busy ? "default" : "pointer" }}
        >
          <input
            type="checkbox"
            checked={guest === true}
            disabled={guest === null}
            aria-readonly={busy || undefined}
            aria-describedby="player-planning-guest-help"
            onChange={onChange}
          />
          <span style={{ fontSize: 14, color: "var(--ink)" }}>{text.t("planningGuest.label")}</span>
        </label>
        {guest === null ? <span style={{ fontSize: 12, color: "var(--ink-mute)" }}>{text.t("planningGuest.unreadable")}</span> : null}
        <InfoHint id="player-planning-guest-help" subject={text.t("planningGuest.label")}>
          <p>{text.t("planningGuest.hint")}</p>
        </InfoHint>
      </InfoHintRow>
      {confirming ? (
        <ConfirmActionDialog
          title={text.t("planningGuest.dialog.title", { pseudo })}
          confirmLabel={text.t("planningGuest.dialog.confirm")}
          pendingLabel={text.t("planningGuest.dialog.pending")}
          tone="primary"
          onClose={() => setConfirming(false)}
          onConfirm={() => save(true)}
        >
          <p>{text.t("planningGuest.dialog.body")}</p>
        </ConfirmActionDialog>
      ) : null}
    </div>
  );
}

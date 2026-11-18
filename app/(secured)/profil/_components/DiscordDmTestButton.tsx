"use client";

import { useState } from "react";
import { BusyButton } from "@/components/ui/busy-button";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";
import { InfoHint } from "@/components/ui/info-hint";
import { useToast } from "@/components/ui/toast";
import { useProfileText } from "@/components/i18n/profile-text";
import { useBusyGuard } from "@/lib/shared/hooks/useBusyGuard";
import {
  dmTestErrorToast,
  dmTestOutcomeToast,
  DM_TEST_FAILED,
  DM_TEST_HOURLY_LIMIT,
  type DmTestToast,
} from "@/lib/shared/discord-dm-test";
import s from "../profil.module.css";

/** Réponse de `POST /api/profile/discord/dm-test`. */
type DmTestResponse = { outcome?: unknown; error?: unknown };

/**
 * L'action d'une réponse : une notification, ou (`certify`) la fenêtre qui
 * propose de certifier — la route refuse un tag non certifié lu sous l'écran.
 */
export function dmTestResponseAction(
  ok: boolean,
  payload: DmTestResponse,
): DmTestToast | "certify" {
  if (ok) return dmTestOutcomeToast(payload.outcome);
  return dmTestErrorToast(payload.error) ?? "certify";
}

/**
 * « Tester mes MP » (`docs/features/DISCORD_DM_TEST.md`) : le bot envoie un message
 * privé de test au Discord rattaché du joueur, et une notification dit l'issue.
 *
 * Tag non certifié (`verified` faux) : rien ne part, une fenêtre dit pourquoi la
 * certification compte et propose « Certifier mon tag » — `onCertify` est
 * **le même geste** que le bouton « Certifier » de la ligne Discord
 * (`openVerifyDialog` de la page), aucune logique de certification ici.
 *
 * Rien n'est rendu tant que l'état Discord n'est pas lu (`linked` nul), ni sans
 * compte Discord lié (`linked` faux) : il n'y a alors personne à qui écrire.
 */
export function DiscordDmTestButton({
  linked,
  verified,
  onCertify,
}: Readonly<{ linked: boolean | null; verified: boolean; onCertify: () => void }>) {
  const { t } = useProfileText();
  const { showError, showSuccess } = useToast();
  const { busy, run, whenIdle } = useBusyGuard();
  const [warnOpen, setWarnOpen] = useState(false);

  const show = (toast: DmTestToast) => {
    const message = t(`dmTest.${toast.key}`);
    if (toast.tone === "success") showSuccess(message);
    else showError(message);
  };

  const test = () =>
    run(async () => {
      let action: DmTestToast | "certify";
      try {
        const res = await fetch("/api/profile/discord/dm-test", {
          method: "POST",
        });
        const payload = (await res
          .json()
          .catch(() => ({ error: DM_TEST_FAILED }))) as DmTestResponse;
        action = dmTestResponseAction(res.ok, payload);
      } catch {
        action = { tone: "error", key: "failed" };
      }
      if (action === "certify") setWarnOpen(true);
      else show(action);
    });

  const onClick = whenIdle(() => {
    if (verified) void test();
    else setWarnOpen(true);
  });

  if (linked !== true) return null;

  return (
    <div className={s.actionsRow}>
      <BusyButton
        busy={busy}
        className="btn ghost"
        onClick={onClick}
        aria-label={t("dmTest.buttonLabel")}
        style={{ padding: "7px 14px", fontSize: 12 }}
      >
        {t("dmTest.button")}
      </BusyButton>
      <InfoHint id="profile-dm-test-more" subject={t("dmTest.button")}>
        <p>{t("dmTest.hint", { max: String(DM_TEST_HOURLY_LIMIT) })}</p>
      </InfoHint>
      {warnOpen ? (
        // Le bouton vit dans le formulaire du profil : la soumission de la
        // fenêtre (portée dans <body>) remonterait par l'arbre React jusqu'au
        // `onSubmit` du profil, qui l'enregistrerait. Elle s'arrête ici.
        <span onSubmit={(event) => event.stopPropagation()}>
          <ConfirmActionDialog
            title={t("dmTest.certifyTitle")}
            confirmLabel={t("dmTest.certifyConfirm")}
            pendingLabel={t("dmTest.certifyPending")}
            tone="primary"
            closeOnSuccess={false}
            onClose={() => setWarnOpen(false)}
            onConfirm={async () => {
              // Cette fenêtre se ferme et celle de la certification s'ouvre dans le
              // même rendu : la seconde prend le focus.
              setWarnOpen(false);
              onCertify();
              return true;
            }}
          >
            <p>
              <strong>{t("dmTest.certifyWarning")}</strong>
            </p>
            <p>{t("dmTest.certifyWhy")}</p>
          </ConfirmActionDialog>
        </span>
      ) : null}
    </div>
  );
}

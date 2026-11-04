"use client";

import { useState } from "react";
import { LocaleLink, useLocaleRouter } from "@/components/i18n/locale-navigation";
import { useLoginText } from "@/components/i18n/login-text";
import { useToast } from "@/components/ui/toast";
import { CyberButton } from "@/components/cyber/CyberButton";
import { CyberCard } from "@/components/cyber/CyberCard";
import { ACCOUNT_SUSPENDED } from "@/lib/shared/account-suspension";
import { suspendedLoginText } from "@/lib/shared/login-text";
import { INTL_LOCALE, SITE_TIME_ZONE } from "@/lib/shared/locales";
import { LOGIN_HELP_TEXT_STYLE } from "../_lib/login-styles";

/** Carte de l'écran de réactivation : la date, ce qui ne revient pas, et le geste. */
export function ReactivationPanel({ finalAt }: Readonly<{ finalAt: string | null }>) {
  const text = useLoginText();
  const { t } = text;
  const router = useLocaleRouter();
  const { showError, showSuccess } = useToast();
  const [loading, setLoading] = useState(false);
  // Une date illisible vaut un ticket absent : jamais « Invalid Date » devant un bouton.
  const validFinalAt = finalAt !== null && !Number.isNaN(new Date(finalAt).getTime()) ? finalAt : null;
  const [expired, setExpired] = useState(validFinalAt === null);

  const date = validFinalAt
    ? new Date(validFinalAt).toLocaleDateString(INTL_LOCALE[text.locale], {
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: SITE_TIME_ZONE,
      })
    : "";

  const reactivate = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/auth/reactivate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as {
          error?: string;
          reactivated?: boolean;
          suspension?: { endsAt?: string | null };
        };
        // Compte suspendu : la réactivation est faite, il revient suspendu
        // (décision du 2026-11-04) — l'écran le dit et rend la connexion.
        if (payload.error === ACCOUNT_SUSPENDED && payload.reactivated === true) {
          showSuccess(t("reactivation.doneSuspended"));
          showError(suspendedLoginText(text, payload.suspension?.endsAt ?? null));
          router.push("/connexion");
          return;
        }
        // Seul un ticket périmé ou déjà servi (410) change l'écran ; une suspension
        // ou une panne passagère se disent par une notification, le bouton reste.
        if (response.status === 410) setExpired(true);
        let message = t(response.status === 410 ? "reactivation.expired" : "reactivation.failed");
        if (payload.error === ACCOUNT_SUSPENDED) message = suspendedLoginText(text, null);
        showError(message);
        setLoading(false);
        return;
      }
      showSuccess(t("reactivation.done"));
      router.push("/profil");
      // La barre de navigation passe à la session ouverte.
      router.refresh();
      // `loading` reste vrai : le bouton ne se rouvre pas pendant la navigation.
    } catch {
      showError(t("reactivation.failed"));
      setLoading(false);
    }
  };

  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", position: "relative" }}>
      <div className="fabric" />
      <CyberCard
        ticks
        style={{
          padding: "clamp(24px, 6vw, 48px)",
          width: "min(520px, calc(100vw - 32px))",
          borderColor: "rgba(var(--blue-500-rgb), 0.3)",
        }}
      >
        <h1 className="display" style={{ fontSize: 30, marginTop: 0, marginBottom: 16 }}>
          <span className="text-gradient">{t("reactivation.title")}</span>
        </h1>
        {expired ? (
          <>
            <p style={{ ...LOGIN_HELP_TEXT_STYLE, fontSize: 14 }}>{t("reactivation.expired")}</p>
            <LocaleLink href="/connexion" style={{ display: "inline-flex", alignItems: "center", minHeight: 44 }}>
              {t("reactivation.backToLogin")}
            </LocaleLink>
          </>
        ) : (
          <>
            <p style={{ fontSize: 14, lineHeight: 1.5, color: "var(--ink)" }}>{t("reactivation.lead", { date })}</p>
            <p style={{ ...LOGIN_HELP_TEXT_STYLE, fontSize: 14 }}>{t("reactivation.kept")}</p>
            <p style={{ ...LOGIN_HELP_TEXT_STYLE, fontSize: 14 }}>{t("reactivation.notUndone")}</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 24 }}>
              <CyberButton type="button" onClick={reactivate} disabled={loading}>
                {t("reactivation.confirm")}
              </CyberButton>
              <LocaleLink href="/" style={{ display: "inline-flex", alignItems: "center", minHeight: 44 }}>
                {t("reactivation.cancel")}
              </LocaleLink>
            </div>
          </>
        )}
      </CyberCard>
    </main>
  );
}

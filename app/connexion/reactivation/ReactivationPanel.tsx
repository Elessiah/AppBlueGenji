"use client";

import { useState } from "react";
import { LocaleLink, useLocaleRouter } from "@/components/i18n/locale-navigation";
import { useLoginText } from "@/components/i18n/login-text";
import { useToast } from "@/components/ui/toast";
import { CyberButton } from "@/components/cyber/CyberButton";
import { CyberCard } from "@/components/cyber/CyberCard";
import { INTL_LOCALE, SITE_TIME_ZONE } from "@/lib/shared/locales";
import { LOGIN_HELP_TEXT_STYLE } from "../_lib/login-styles";

/** Carte de l'écran de réactivation : la date, ce qui ne revient pas, et le geste. */
export function ReactivationPanel({ finalAt }: Readonly<{ finalAt: string | null }>) {
  const text = useLoginText();
  const { t } = text;
  const router = useLocaleRouter();
  const { showError, showSuccess } = useToast();
  const [loading, setLoading] = useState(false);
  const [expired, setExpired] = useState(finalAt === null);

  const date = finalAt
    ? new Date(finalAt).toLocaleDateString(INTL_LOCALE[text.locale], {
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
        setExpired(true);
        showError(t("reactivation.failed"));
        return;
      }
      showSuccess(t("reactivation.done"));
      router.push("/profil");
      // La barre de navigation passe à la session ouverte.
      router.refresh();
    } catch {
      showError(t("reactivation.failed"));
    } finally {
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

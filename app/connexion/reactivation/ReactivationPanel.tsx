"use client";

import { useEffect, useRef, useState } from "react";
import { LocaleLink, useLocaleRouter } from "@/components/i18n/locale-navigation";
import { useLoginText } from "@/components/i18n/login-text";
import { useToast } from "@/components/ui/toast";
import { CyberButton } from "@/components/cyber/CyberButton";
import { CyberCard } from "@/components/cyber/CyberCard";
import { ACCOUNT_SUSPENDED } from "@/lib/shared/account-suspension";
import { REACTIVATED_LOGIN_REQUIRED } from "@/lib/shared/account-deletion";
import { suspendedLoginText } from "@/lib/shared/login-text";
import { INTL_LOCALE, SITE_TIME_ZONE } from "@/lib/shared/locales";
import { LOGIN_HELP_TEXT_STYLE } from "../_lib/login-styles";

/**
 * Carte de l'écran de réactivation : la date, ce qui ne revient pas, et le geste.
 * `hadTicket` : un cookie de ticket est arrivé avec la page — sans lui (favori,
 * fenêtre privée), l'écran ne parle pas d'un lien « expiré » que le visiteur
 * n'a jamais eu.
 */
export function ReactivationPanel({
  finalAt,
  hadTicket = true,
}: Readonly<{ finalAt: string | null; hadTicket?: boolean }>) {
  const text = useLoginText();
  const { t } = text;
  const router = useLocaleRouter();
  const { showError, showSuccess, showInfo } = useToast();
  const [loading, setLoading] = useState(false);
  // Passe à vrai quand un ticket périme sous le clic : l'écran dit alors « expiré ».
  const [expiredUnderClick, setExpiredUnderClick] = useState(false);
  // Une date illisible vaut un ticket absent : jamais « Invalid Date » devant un bouton.
  const validFinalAt = finalAt !== null && !Number.isNaN(new Date(finalAt).getTime()) ? finalAt : null;
  const [expired, setExpired] = useState(validFinalAt === null);
  const expiredRef = useRef<HTMLDivElement>(null);
  const expiredOnMount = useRef(validFinalAt === null);
  // Un ticket qui expire sous le clic retire le bouton qui avait le focus : il
  // passe au bloc « expiré » (annoncé), sinon il tomberait sur <body>. Un écran
  // ouvert déjà expiré garde le focus d'une arrivée de page normale.
  useEffect(() => {
    if (expired && !expiredOnMount.current) expiredRef.current?.focus();
  }, [expired]);

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
        // Réactivé, mais la session n'a pas pu s'ouvrir : il reste à se connecter.
        if (payload.error === REACTIVATED_LOGIN_REQUIRED && payload.reactivated === true) {
          showSuccess(t("reactivation.doneLoginRequired"));
          router.push("/connexion");
          return;
        }
        // Compte suspendu : la réactivation est faite, il revient suspendu
        // (décision du 2026-11-04) — l'écran le dit et rend la connexion.
        if (payload.error === ACCOUNT_SUSPENDED && payload.reactivated === true) {
          showSuccess(t("reactivation.doneSuspended"));
          showError(suspendedLoginText(text, payload.suspension?.endsAt ?? null));
          router.push("/connexion");
          return;
        }
        // Seul un ticket périmé ou déjà servi (410) change l'écran — son bloc
        // « expiré », annoncé (`role="alert"`) et focalisé, le dit une fois, sans
        // notification en double ; une suspension ou une panne passagère se
        // disent par une notification, le bouton reste.
        if (response.status === 410) {
          setExpiredUnderClick(true);
          setExpired(true);
        } else {
          showError(payload.error === ACCOUNT_SUSPENDED ? suspendedLoginText(text, null) : t("reactivation.failed"));
        }
        setLoading(false);
        return;
      }
      const done = (await response.json().catch(() => ({}))) as { pseudoChanged?: boolean };
      showSuccess(t(done.pseudoChanged === true ? "reactivation.donePseudoChanged" : "reactivation.done"));
      router.push("/profil");
      // La barre de navigation passe à la session ouverte.
      router.refresh();
      // `loading` reste vrai : le bouton ne se rouvre pas pendant la navigation.
    } catch {
      showError(t("reactivation.failed"));
      setLoading(false);
    }
  };

  // « Ne pas réactiver » : le ticket et son cookie partent (poste partagé), et
  // l'issue est dite — la suppression suit son cours jusqu'à la date annoncée.
  const decline = async () => {
    setLoading(true);
    try {
      await fetch("/api/auth/reactivate", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
    } catch {
      // Le ticket expire de lui-même : le refus n'a rien à réussir.
    }
    showInfo(t("reactivation.declined", { date }));
    router.push("/");
    // `loading` reste vrai : rien ne se rouvre pendant la navigation.
  };

  return (
    <main style={{ minHeight: "100dvh", display: "grid", placeItems: "center", position: "relative" }}>
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
          <div ref={expiredRef} tabIndex={-1} role="alert" style={{ outline: "none" }}>
            <p style={{ ...LOGIN_HELP_TEXT_STYLE, fontSize: 14 }}>
              {t(hadTicket || expiredUnderClick ? "reactivation.expired" : "reactivation.missing")}
            </p>
            <LocaleLink href="/connexion" style={{ display: "inline-flex", alignItems: "center", minHeight: 44 }}>
              {t("reactivation.backToLogin")}
            </LocaleLink>
          </div>
        ) : (
          <>
            <p style={{ fontSize: 14, lineHeight: 1.5, color: "var(--ink)" }}>{t("reactivation.lead", { date })}</p>
            <p style={{ ...LOGIN_HELP_TEXT_STYLE, fontSize: 14 }}>{t("reactivation.kept")}</p>
            <p style={{ ...LOGIN_HELP_TEXT_STYLE, fontSize: 14 }}>{t("reactivation.notUndone")}</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 24 }}>
              <CyberButton type="button" onClick={reactivate} disabled={loading} aria-busy={loading}>
                {t(loading ? "reactivation.confirming" : "reactivation.confirm")}
              </CyberButton>
              <CyberButton type="button" variant="ghost" onClick={decline} disabled={loading}>
                {t("reactivation.cancel")}
              </CyberButton>
            </div>
          </>
        )}
      </CyberCard>
    </main>
  );
}

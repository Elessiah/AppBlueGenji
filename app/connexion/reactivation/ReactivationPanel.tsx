"use client";

import { signalSessionChanged } from "@/lib/shared/session-change-signal";
import { useEffect, useId, useRef, useState } from "react";
import { LocaleLink, useLocaleRouter } from "@/components/i18n/locale-navigation";
import { useLoginText } from "@/components/i18n/login-text";
import { useToast } from "@/components/ui/toast";
import { CyberButton } from "@/components/cyber/CyberButton";
import { CyberCard } from "@/components/cyber/CyberCard";
import { InfoHint, InfoHintRow } from "@/components/ui/info-hint";
import { ACCOUNT_SUSPENDED } from "@/lib/shared/account-suspension";
import { REACTIVATED_LOGIN_REQUIRED } from "@/lib/shared/account-deletion";
import { suspendedLoginText } from "@/lib/shared/login-text";
import { INTL_LOCALE, SITE_TIME_ZONE } from "@/lib/shared/locales";
import { LOGIN_HELP_TEXT_STYLE } from "../_lib/login-styles";

/** Corps d'un refus de `POST /api/auth/reactivate`. */
type ReactivationRefusal = {
  error?: string;
  reactivated?: boolean;
  pseudoChanged?: boolean;
  suspension?: { endsAt?: string | null };
};

/**
 * Cible de 44 px, et une base fixe : le libellé d'attente, plus court, ne fait
 * pas remonter le second bouton sur la première ligne (ni l'inverse à l'échec).
 */
const BUTTON_STYLE = { minHeight: 44, flex: "1 1 160px", justifyContent: "center" } as const;

/** Délai au-delà duquel « Ne pas réactiver » rend la main (connexion figée). */
const DECLINE_TIMEOUT_MS = 8000;

/** Ce que la réactivation ne défait pas, dans l'ordre des gestes de la demande. */
const NOT_UNDONE_ITEMS = ["teams", "organized", "registrations", "forfeits", "casts"] as const;

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
  const keptId = useId();
  const router = useLocaleRouter();
  const { showError, showSuccess, showInfo } = useToast();
  // Le geste en cours : les deux boutons se ferment (`aria-disabled` + garde,
  // pas `disabled` : le bouton garde le focus et son libellé d'attente reste
  // lisible), seul celui du geste dit l'attente.
  const [pending, setPending] = useState<"reactivate" | "decline" | null>(null);
  const loading = pending !== null;
  // Le bouton cliqué, désactivé pendant l'envoi, perd le focus : il lui revient
  // quand un échec rend la main (sinon le clavier repart du haut de la page).
  const confirmRef = useRef<HTMLButtonElement>(null);
  const declineRef = useRef<HTMLButtonElement>(null);
  const refocus = useRef<"reactivate" | "decline" | null>(null);
  useEffect(() => {
    if (pending !== null || refocus.current === null) return;
    (refocus.current === "reactivate" ? confirmRef : declineRef).current?.focus();
    refocus.current = null;
  }, [pending]);
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
  // Garde des deux gestes : un second clic pendant l'envoi ne part pas.
  const inFlight = useRef(false);

  const date = validFinalAt
    ? new Date(validFinalAt).toLocaleDateString(INTL_LOCALE[text.locale], {
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: SITE_TIME_ZONE,
      })
    : "";

  /** Un échec rend la main, et le focus au bouton du geste. */
  const giveBack = (action: "reactivate" | "decline") => {
    inFlight.current = false;
    refocus.current = action;
    setPending(null);
  };

  /**
   * Réponse hors 200, compte pourtant réactivé (session non ouverte, ou compte
   * suspendu) : l'écran le dit et renvoie à la connexion. Rend `false` si le
   * compte n'a pas été réactivé.
   */
  const leaveReactivated = (payload: ReactivationRefusal): boolean => {
    if (payload.reactivated !== true) return false;
    // Réactivé sous un autre pseudo : dit sur chaque issue où le compte revit.
    if (payload.pseudoChanged === true) showInfo(t("reactivation.pseudoChanged"));
    if (payload.error === REACTIVATED_LOGIN_REQUIRED) {
      showSuccess(t("reactivation.doneLoginRequired"));
    } else if (payload.error === ACCOUNT_SUSPENDED) {
      // Il revient suspendu (décision du 2026-11-04).
      showSuccess(t("reactivation.doneSuspended"));
      showError(suspendedLoginText(text, payload.suspension?.endsAt ?? null));
    } else {
      return false;
    }
    // `replace` : « Précédent » ne ramène pas à un écran dont le ticket a servi.
    router.replace("/connexion");
    return true;
  };

  const reactivate = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending("reactivate");
    try {
      const response = await fetch("/api/auth/reactivate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as ReactivationRefusal;
        if (leaveReactivated(payload)) return;
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
        giveBack("reactivate");
        return;
      }
      const done = (await response.json().catch(() => ({}))) as { pseudoChanged?: boolean };
      showSuccess(t("reactivation.done"));
      if (done.pseudoChanged === true) showInfo(t("reactivation.pseudoChanged"));
      signalSessionChanged();
      router.replace("/profil");
      // La barre de navigation passe à la session ouverte.
      router.refresh();
      // Le geste reste en cours : le bouton ne se rouvre pas pendant la navigation.
    } catch {
      showError(t("reactivation.failed"));
      giveBack("reactivate");
    }
  };

  // « Ne pas réactiver » : le ticket et son cookie partent (poste partagé), et
  // l'issue est dite — la suppression suit son cours jusqu'à la date annoncée.
  // Un refus qui n'a pas pu être enregistré (réseau, délai) est dit : le cookie
  // serait resté, et l'écran ne doit pas laisser croire le contraire.
  const decline = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending("decline");
    let recorded = false;
    // `AbortController` + minuteur, pas `AbortSignal.timeout` (absent des
    // navigateurs d'avant 2022 : il lèverait, et le refus ne partirait jamais).
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DECLINE_TIMEOUT_MS);
    try {
      const response = await fetch("/api/auth/reactivate", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: "{}",
        signal: controller.signal,
      });
      recorded = response.ok;
    } catch {
      recorded = false;
    } finally {
      clearTimeout(timer);
    }
    if (!recorded) {
      showError(t("reactivation.declineFailed"));
      giveBack("decline");
      return;
    }
    showInfo(t("reactivation.declined", { date }));
    router.replace("/");
    // Le geste reste en cours : rien ne se rouvre pendant la navigation.
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
          // `alert` pour le seul ticket périmé sous le clic : ouvert déjà expiré
          // (ou sans ticket), l'écran est un contenu de page, pas une alerte.
          <div ref={expiredRef} tabIndex={-1} role={expiredUnderClick ? "alert" : undefined} style={{ outline: "none" }}>
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
            {/* Ce qui revient, en une phrase ; le détail (pseudo pris, avatar
                masqué, compte suspendu) derrière le « i ». */}
            <InfoHintRow inline>
              <p style={{ ...LOGIN_HELP_TEXT_STYLE, fontSize: 14, margin: 0 }}>{t("reactivation.keptLead")}</p>
              <InfoHint id={keptId} subject={t("reactivation.keptSubject")}>
                <p>{t("reactivation.kept")}</p>
              </InfoHint>
            </InfoHintRow>
            <p style={{ ...LOGIN_HELP_TEXT_STYLE, fontSize: 14, marginBottom: 4 }}>{t("reactivation.notUndoneLead")}</p>
            <ul style={{ ...LOGIN_HELP_TEXT_STYLE, fontSize: 14, marginTop: 0, paddingLeft: 20 }}>
              {NOT_UNDONE_ITEMS.map((item) => (
                <li key={item}>{t(`reactivation.notUndoneItems.${item}`)}</li>
              ))}
            </ul>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 24 }}>
              <CyberButton
                ref={confirmRef}
                type="button"
                onClick={reactivate}
                aria-disabled={loading}
                aria-busy={pending === "reactivate"}
                style={BUTTON_STYLE}
              >
                {t(pending === "reactivate" ? "reactivation.confirming" : "reactivation.confirm")}
              </CyberButton>
              <CyberButton
                ref={declineRef}
                type="button"
                variant="ghost"
                onClick={decline}
                aria-disabled={loading}
                aria-busy={pending === "decline"}
                style={BUTTON_STYLE}
              >
                {t(pending === "decline" ? "reactivation.declining" : "reactivation.cancel")}
              </CyberButton>
            </div>
          </>
        )}
      </CyberCard>
    </main>
  );
}

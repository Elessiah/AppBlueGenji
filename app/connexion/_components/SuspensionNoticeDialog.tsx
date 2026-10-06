"use client";

import { createPortal } from "react-dom";
import { useEffect, useState } from "react";
import { LocaleLink } from "@/components/i18n/locale-navigation";
import { useLoginText } from "@/components/i18n/login-text";
import { richNodes } from "@/components/i18n/shell-text";
import { useBackdropDismiss } from "@/lib/shared/hooks/useBackdropDismiss";
import { useDialogBehavior } from "@/lib/shared/hooks/useDialogBehavior";
import { SUSPENSION_GROUND_DEFINITIONS, type SuspensionNotice } from "@/lib/shared/account-suspension";
import { suspensionSpanText } from "@/lib/shared/login-text";
import { DEFAULT_LOCALE } from "@/lib/shared/locales";
import { TERMS_PATH } from "@/lib/shared/terms-of-use";

/**
 * Exposé d'une suspension, à la connexion refusée d'un compte suspendu
 * (`lib/shared/account-suspension.ts`) : la décision et sa durée, les faits
 * retenus, la clause invoquée, et le moyen de la contester. C'est le seul canal
 * qui joigne un compte sans Discord rattaché — d'où une modale qu'on lit à son
 * rythme, plutôt qu'une notification qui s'efface.
 *
 * Textes du message `login.suspension` (lot 6), rendus aussi sous
 * `/en/connexion`. Les faits retenus sont **saisis** par la modération, en
 * français : sous `/en`, ils portent `lang="fr"` (WCAG 3.1.2), comme le lien
 * vers les conditions d'utilisation, pas encore traduites (lot 7b).
 */
export function SuspensionNoticeDialog({ notice, onClose }: Readonly<{ notice: SuspensionNotice; onClose: () => void }>) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const dialogRef = useDialogBehavior({ open: mounted, onClose });
  const backdrop = useBackdropDismiss(onClose);
  const text = useLoginText();
  const { t } = text;
  const frenchContentLang = text.locale === DEFAULT_LOCALE ? undefined : DEFAULT_LOCALE;

  if (!mounted) return null;
  const ground = SUSPENSION_GROUND_DEFINITIONS[notice.ground];

  return createPortal(
    <div /* NOSONAR S6819 — voile de modale, sans équivalent natif */
      role="presentation"
      {...backdrop}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        display: "grid",
        placeItems: "center",
        padding: 16,
        background: "rgba(4, 8, 14, 0.78)",
        backdropFilter: "blur(4px)",
      }}
    >
      <div /* NOSONAR S6819 — modale portée dans body (useDialogBehavior) : `<dialog>` changerait couche, Échap et ::backdrop */
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="suspension-notice-title"
        aria-describedby="suspension-notice-span"
        tabIndex={-1}
        style={{
          width: "min(480px, calc(100vw - 32px))",
          background: "var(--cyber-bg-1)",
          border: "1px solid var(--line-strong-cy)",
          borderRadius: "var(--r-cy-lg)",
          padding: 24,
        }}
      >
        <h2 id="suspension-notice-title" className="display" style={{ fontSize: 18, margin: "0 0 10px" }}>
          {t("suspension.title")}
        </h2>
        <p id="suspension-notice-span" style={{ color: "var(--ink)", fontSize: 14, lineHeight: 1.7, margin: "0 0 12px" }}>
          {suspensionSpanText(text, notice.endsAt, notice.reference)}
        </p>
        <dl style={{ fontSize: 13.5, lineHeight: 1.7, color: "var(--ink-mute)", margin: "0 0 12px" }}>
          <dt style={{ color: "var(--ink)", fontWeight: 600 }}>{t("suspension.facts")}</dt>
          <dd style={{ margin: "0 0 8px" }} lang={frenchContentLang}>
            {notice.reason}
          </dd>
          <dt style={{ color: "var(--ink)", fontWeight: 600 }}>{t("suspension.ground")}</dt>
          <dd style={{ margin: "0 0 8px" }}>
            {richNodes(
              text.rich("suspension.groundText", { clause: t(`suspension.clauses.${notice.ground}`) }, {
                terms: (children) => (
                  <LocaleLink href={`${TERMS_PATH}#${ground.anchor}`} hrefLang={frenchContentLang}>
                    {richNodes(children)}
                  </LocaleLink>
                ),
              }),
            )}
          </dd>
          <dt style={{ color: "var(--ink)", fontWeight: 600 }}>{t("suspension.appeal")}</dt>
          <dd style={{ margin: 0 }}>
            {/* « Autre » : libellé du formulaire de signalement, encore en français (lot 9). */}
            {richNodes(
              text.rich("suspension.appealText", { reference: notice.reference }, {
                fr: (children) =>
                  frenchContentLang ? <span lang={frenchContentLang}>{richNodes(children)}</span> : richNodes(children),
              }),
            )}
          </dd>
        </dl>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          {/* Focus sur la sortie : l'exposé se lit par la description du dialogue,
              et le premier arrêt ne doit pas être le lien vers les conditions. */}
          <button type="button" className="btn ghost" onClick={onClose} data-autofocus>
            {t("suspension.close")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

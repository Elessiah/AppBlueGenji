"use client";

import { useState, type ReactNode } from "react";
import { LocaleLink } from "@/components/i18n/locale-navigation";
import { useLoginText } from "@/components/i18n/login-text";
import { richNodes } from "@/components/i18n/shell-text";
import { CyberButton } from "@/components/cyber/CyberButton";
import { TERMS_TRANSLATION_NOTE } from "@/lib/shared/french-version-prevails";
import { DEFAULT_LOCALE } from "@/lib/shared/locales";
import { SITE_MINIMUM_AGE, TERMS_PATH } from "@/lib/shared/terms-of-use";
import { useDialogBehavior } from "@/lib/shared/hooks/useDialogBehavior";

/** Ce que la modale annonce, dans l'ordre (messages `login.consent`). */
const CONSENT_ITEMS = [
  "consent.pseudonyms",
  "consent.gameNames",
  "consent.noResale",
  "consent.discordTag",
  "consent.export",
] as const;

interface RgpdConsentModalProps {
  onAccept: () => void;
  onRefuse: () => void;
}

/**
 * Popup d'entrée de `/connexion`, affichée avant toute création de compte.
 *
 * **Une information, pas un consentement** — sauf pour ce qui est réellement
 * facultatif. Les données sans lesquelles un compte n'existe pas (pseudo,
 * identifiant du fournisseur de connexion) reposent sur l'exécution du service
 * demandé (art. 6.1.b RGPD) : les faire « accepter » serait demander un
 * consentement qui n'est pas libre, puisque le refuser interdit le service. La
 * modale **informe** (art. 13) et renvoie à la politique ; ce qui s'accepte vraiment
 * a sa propre case : les conditions d'utilisation (preuve serveur,
 * `bg_terms_acceptances`).
 *
 * Revenir en arrière (`onRefuse`) ne déclenche aucune requête
 * d'authentification : rien n'est enregistré.
 *
 * Textes du message `login.consent` (lot 6) : la modale s'ouvre aussi sous
 * `/en/connexion`. La case reprend `TERMS_CHECKBOX_LABEL` et
 * `TERMS_AGE_DECLARATION` (égalité du français testée). Les conditions sont
 * traduites depuis le lot 7b-1 : sous `/en`, leur lien mène à l'anglais, et une
 * note dit que c'est le texte français — la même `TERMS_VERSION` — que l'on
 * accepte (`TERMS_TRANSLATION_NOTE`). La politique de confidentialité est
 * traduite depuis le lot 7b-2 : son lien mène aussi à l'anglais.
 */
export function RgpdConsentModal({ onAccept, onRefuse }: Readonly<RgpdConsentModalProps>) {
  // Les conditions d'utilisation s'acceptent **ici**, avec le traitement des
  // données : le site n'a pas de formulaire d'inscription, un compte naît à la
  // première connexion — l'entrée de cette page est donc le seul endroit où les
  // présenter avant qu'il existe. Une case à part, et non un « en continuant,
  // tu acceptes » : c'est une acceptation qu'on doit pouvoir prouver.
  const [termsChecked, setTermsChecked] = useState(false);
  // Focus initial dans la modale, tabulation piégée et défilement figé : sans
  // eux, le clavier atteignait le formulaire de connexion derrière le voile
  // avant tout consentement. `locked` : Échap ne tranche pas un consentement,
  // il faut l'un des deux boutons. Pas de portail — la modale est rendue dès
  // le rendu serveur, au niveau de `<main>`, qui ne crée aucun contexte
  // d'empilement.
  const dialogRef = useDialogBehavior({ open: true, onClose: onRefuse, locked: true });
  const text = useLoginText();
  const { t } = text;
  const frenchDocumentLang = text.locale === DEFAULT_LOCALE ? undefined : DEFAULT_LOCALE;
  const strong = (children: ReadonlyArray<ReactNode>) => <strong>{richNodes(children)}</strong>;

  return (
    <div /* NOSONAR S6819 — voile de modale, sans équivalent natif */
      role="presentation"
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
        aria-labelledby="rgpd-consent-title"
        tabIndex={-1}
        style={{
          width: "min(520px, calc(100vw - 32px))",
          maxHeight: "calc(100vh - 32px)",
          overflowY: "auto",
          background: "var(--cyber-bg-1)",
          border: "1px solid var(--line-strong-cy)",
          borderRadius: "var(--r-cy-lg)",
          padding: 32,
        }}
      >
        <span className="eyebrow">{t("consent.eyebrow")}</span>
        <h2
          id="rgpd-consent-title"
          className="display"
          style={{ fontSize: 24, margin: "12px 0 16px" }}
        >
          {t("consent.title")}
        </h2>

        <p style={{ color: "var(--ink-mute)", fontSize: 14, lineHeight: 1.7, margin: "0 0 16px" }}>
          {t("consent.intro")}
        </p>

        <ul
          style={{
            color: "var(--ink-mute)",
            fontSize: 13.5,
            lineHeight: 1.7,
            margin: "0 0 16px",
            paddingLeft: 18,
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          {CONSENT_ITEMS.map((key) => (
            <li key={key}>{richNodes(text.rich(key, {}, { strong }))}</li>
          ))}
        </ul>

        <p style={{ color: "var(--ink-dim)", fontSize: 12.5, lineHeight: 1.6, margin: "0 0 24px" }}>
          {richNodes(
            text.rich("consent.policy", {}, {
              policy: (children) => (
                <LocaleLink
                  href="/rgpd"
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: "var(--blue-300)", textDecoration: "underline" }}
                >
                  {richNodes(children)}
                </LocaleLink>
              ),
            }),
          )}
        </p>

        <label
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 10,
            margin: "0 0 20px",
            fontSize: 13.5,
            lineHeight: 1.5,
            color: "var(--ink)",
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            checked={termsChecked}
            onChange={(event) => setTermsChecked(event.target.checked)}
            style={{ marginTop: 3 }}
          />
          <span>
            {richNodes(
              text.rich("consent.terms", { age: SITE_MINIMUM_AGE }, {
                terms: (children) => (
                  <LocaleLink
                    href={TERMS_PATH}
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: "var(--blue-300)", textDecoration: "underline" }}
                  >
                    {richNodes(children)}
                  </LocaleLink>
                ),
              }),
            )}
          </span>
        </label>
        {frenchDocumentLang ? (
          <p style={{ color: "var(--ink-dim)", fontSize: 12.5, lineHeight: 1.6, margin: "-12px 0 20px 26px" }}>
            {TERMS_TRANSLATION_NOTE.text}{" "}
            <a
              href={TERMS_PATH}
              target="_blank"
              rel="noreferrer"
              hrefLang="fr"
              style={{ color: "var(--blue-300)", textDecoration: "underline" }}
            >
              {TERMS_TRANSLATION_NOTE.link}
            </a>
          </p>
        ) : null}

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <CyberButton
            variant="primary"
            type="button"
            onClick={onAccept}
            disabled={!termsChecked}
            style={{ flex: 1, minWidth: 160 }}
          >
            {t("consent.accept")}
          </CyberButton>
          <CyberButton
            variant="ghost"
            type="button"
            onClick={onRefuse}
            style={{ flex: 1, minWidth: 120 }}
          >
            {t("consent.refuse")}
          </CyberButton>
        </div>
      </div>
    </div>
  );
}

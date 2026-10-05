"use client";

import { useTranslations } from "next-intl";
import { usePathname, useSearchParams } from "next/navigation";
import { LOCALE_NATIVE_NAME, isMigratedRoute, localeHref, splitLocalePrefix, type Locale } from "@/lib/shared/locales";
import { useAppLocale } from "./locale-context";
import styles from "./LanguageSwitcher.module.css";

/**
 * Lien vers **la même page** dans l'autre langue (`docs/features/I18N.md`).
 *
 * - Il garde la page courante, requête et ancre comprises : `/regles?x=1#a`
 *   ↔ `/en/regles?x=1#a`, rien d'autre — ni
 *   redirection selon `Accept-Language`, ni cookie : l'URL reste la seule
 *   source de vérité de la langue.
 * - Il se tait sur une route **pas encore traduite** : il mènerait à une
 *   redirection vers la page même où l'on est.
 * - Un `<a>` et pas un `next/link` : changer de langue recharge le document,
 *   seul moyen de rendre de nouveau `<html lang>` et les messages du client.
 * - Son nom accessible commence par le texte visible (WCAG 2.5.3), écrit dans
 *   la langue visée (`lang`), et `hrefLang` l'annonce aux robots.
 */
export function LanguageSwitcher({ className }: Readonly<{ className?: string }>) {
  const path = splitLocalePrefix(usePathname() ?? "/").path;
  const locale = useAppLocale();
  if (!isMigratedRoute(path)) return null;
  const target: Locale = locale === "fr" ? "en" : "fr";
  return <SwitcherLink href={localeHref(path, target)} target={target} className={className} />;
}

/** L'adresse de l'autre langue, avec la requête (`a=1`) et l'ancre (`#x`) de la page courante. */
export function switcherHref(path: string, query: string, hash = ""): string {
  const search = query ? "?" + query : "";
  const anchor = hash.startsWith("#") && hash.length > 1 ? hash : "";
  return path + search + anchor;
}

/**
 * Le lien lui-même, à part : `useTranslations` exige un fournisseur de
 * messages, qu'une page non traduite n'a pas à fournir pour un lien qu'elle ne
 * rend pas.
 */
function SwitcherLink({ href, target, className }: Readonly<{ href: string; target: Locale; className?: string }>) {
  const t = useTranslations("common.languageSwitcher");
  // La requête suit (un filtre, un onglet, le `?redirect=` de la connexion) :
  // changer de langue ne doit pas perdre l'état de la page.
  const query = useSearchParams()?.toString() ?? "";
  // L'ancre n'atteint jamais le serveur : ajoutée côté client, dès le survol ou
  // le focus — avant un clic du milieu ou un « Ouvrir dans un onglet » — et au
  // clic.
  const withAnchor = (event: { currentTarget: HTMLAnchorElement }) => {
    event.currentTarget.href = switcherHref(href, query, globalThis.location?.hash);
  };
  return (
    <a
      href={switcherHref(href, query)}
      hrefLang={target}
      className={className ? `${styles.link} ${className}` : styles.link}
      onPointerEnter={withAnchor}
      onFocus={withAnchor}
      onClick={withAnchor}
    >
      <span lang={target}>{LOCALE_NATIVE_NAME[target]}</span>
      <span className="sr-only"> — {t("label")}</span>
    </a>
  );
}

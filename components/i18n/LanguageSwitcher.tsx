"use client";

import { Globe } from "lucide-react";
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
 * - Sa précision (`label`) est traduite **côté serveur** par l'en-tête qui le
 *   rend (`languageSwitcherLabel()`) : sur une page sans rien de traduit, aucun
 *   code client de `next-intl` n'est chargé pour un lien qui ne s'affiche pas.
 */
export function LanguageSwitcher({
  label,
  className,
  compact = false,
}: Readonly<{ label: string; className?: string; compact?: boolean }>) {
  const path = useSwitchablePath();
  const locale = useAppLocale();
  if (path === null) return null;
  const target: Locale = locale === "fr" ? "en" : "fr";
  return (
    <SwitcherLink href={localeHref(path, target)} target={target} label={label} className={className} compact={compact} />
  );
}

/**
 * Le chemin courant (sans préfixe de langue) s'il a une autre langue, sinon
 * `null` : la seule décision « le sélecteur parle-t-il ? », partagée avec qui
 * doit savoir d'avance s'il sera rendu (groupe d'outils de `ArenaNav`).
 */
export function useSwitchablePath(): string | null {
  const path = splitLocalePrefix(usePathname() ?? "/").path;
  return isMigratedRoute(path) ? path : null;
}

/** L'adresse de l'autre langue, avec la requête (`a=1`) et l'ancre (`#x`) de la page courante. */
export function switcherHref(path: string, query: string, hash = ""): string {
  const search = query ? "?" + query : "";
  const anchor = hash.startsWith("#") && hash.length > 1 ? hash : "";
  return path + search + anchor;
}

/**
 * Le lien lui-même, à part : `useSearchParams` ne s'appelle que sur une route
 * traduite.
 */
function SwitcherLink({
  href,
  target,
  label,
  className,
  compact,
}: Readonly<{ href: string; target: Locale; label: string; className?: string; compact: boolean }>) {
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
      {/* Sur un écran étroit, le code (« EN ») remplace le nom : la ligne
          d'actions de l'en-tête passait sinon à la ligne et poussait le menu du
          compte sous le logo. Le nom accessible garde le code visible en tête. */}
      {/* `compact` (barre connectée) : globe et code, à toutes les largeurs. */}
      {compact && <Globe size={14} aria-hidden="true" className={styles.globe} />}
      {!compact && (
        <span lang={target} className={styles.full}>
          {LOCALE_NATIVE_NAME[target]}
        </span>
      )}
      <span lang={target} className={compact ? undefined : styles.short}>
        {target.toUpperCase()}
      </span>
      <span className="sr-only"> — {label}</span>
    </a>
  );
}

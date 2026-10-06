"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { forwardRef, useMemo, type AnchorHTMLAttributes } from "react";
import { crossesLocale, localeHref, splitLocalePrefix, type Locale } from "@/lib/shared/locales";
import { useAppLocale } from "./locale-context";

/**
 * Navigation interne dans la langue de la page (`docs/features/I18N.md`).
 *
 * Règle d'or : un lien qui **change de langue** est une navigation complète,
 * jamais une navigation client. La mise en page racine porte `<html lang>` et
 * les messages du client ; Next ne la rend pas de nouveau d'une page à l'autre,
 * si bien qu'une navigation client de `/en/regles` vers une page restée en
 * français garderait `lang="en"` et le dictionnaire anglais.
 */

export type LocaleLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  /** Chemin interne **sans** préfixe de langue (`/regles`), ou adresse externe. */
  href: string;
  prefetch?: boolean | null;
  replace?: boolean;
  scroll?: boolean;
};

/**
 * `next/link` dans la langue de la page : `/regles` mène à `/en/regles` sur une
 * page anglaise si la route est traduite, à `/regles` sinon.
 */
export const LocaleLink = forwardRef<HTMLAnchorElement, LocaleLinkProps>(function LocaleLink(
  { href, prefetch, replace, scroll, ...anchor },
  ref,
) {
  const locale = useAppLocale();
  const target = localeHref(href, locale);
  if (crossesLocale(href, locale)) {
    return <a ref={ref} href={target} {...anchor} />;
  }
  return <Link ref={ref} href={target} prefetch={prefetch} replace={replace} scroll={scroll} {...anchor} />;
});

/** `localeHref` lié à la langue de la page, pour qui construit une adresse. */
export function useLocaleHref(): (href: string) => string {
  const locale = useAppLocale();
  return useMemo(() => (href: string) => localeHref(href, locale), [locale]);
}

/**
 * Le chemin de la page **sans** préfixe de langue, et la langue de la page.
 * À préférer à `usePathname()` pour comparer une route (lien actif…).
 */
export function useLocalePathname(): { locale: Locale; path: string } {
  const pathname = usePathname() ?? "/";
  return { locale: useAppLocale(), path: splitLocalePrefix(pathname).path };
}

type NavigateOptions = { scroll?: boolean };

export type LocaleRouter = {
  push: (href: string, options?: NavigateOptions) => void;
  replace: (href: string, options?: NavigateOptions) => void;
  prefetch: (href: string) => void;
  back: () => void;
  forward: () => void;
  refresh: () => void;
};

/**
 * `useRouter()` dans la langue de la page : `push`/`replace` passent par
 * `localeHref`, et un changement de langue devient une navigation complète.
 */
export function useLocaleRouter(): LocaleRouter {
  const router = useRouter();
  const locale = useAppLocale();
  return useMemo(
    () => ({
      push(href, options) {
        const target = localeHref(href, locale);
        if (crossesLocale(href, locale)) globalThis.location.assign(target);
        else router.push(target, options);
      },
      replace(href, options) {
        const target = localeHref(href, locale);
        if (crossesLocale(href, locale)) globalThis.location.replace(target);
        else router.replace(target, options);
      },
      prefetch(href) {
        if (!crossesLocale(href, locale)) router.prefetch(localeHref(href, locale));
      },
      back: () => router.back(),
      forward: () => router.forward(),
      refresh: () => router.refresh(),
    }),
    [router, locale],
  );
}

"use client";

import { Flag } from "lucide-react";
import { LocaleLink, useLocalePathname } from "@/components/i18n/locale-navigation";
import { LogoWithGlow } from "./logo-with-glow";
import { AccountMenu } from "./account-menu";
import { LanguageSwitcher } from "./i18n/LanguageSwitcher";
import { isNavLinkActive } from "@/lib/shared/nav-active";
import { isMigratedRoute } from "@/lib/shared/locales";
import { REPORTS_ADMIN_PATH } from "@/lib/shared/content-reports";
import type { ShellKey } from "@/lib/shared/shell-text";
import { useShellText } from "./i18n/shell-text";
import s from "./arena-nav.module.css";

type ArenaNavProps = {
  pseudo: string;
  avatarUrl: string | null;
  activeTeam?: { teamId: number; teamName: string } | null;
  /**
   * Signalements à traiter, pour la modération (`null` : pas de permission, le
   * lien n'est pas rendu). Le nombre est celui du chargement de la page.
   */
  openReports?: number | null;
  /**
   * Précision du sélecteur de langue, traduite côté serveur
   * (`languageSwitcherLabel()`). Absente : pas de sélecteur.
   */
  languageSwitcherLabel?: string;
};

/**
 * Teinte de chaque section, en jetons de la palette « néon froid »
 * (DESIGN_SYSTEM.md) : joueurs glacier, équipes violet (comme leurs pages),
 * tournois vert d'eau, classement rose. Aucune teinte chaude (ni rouge du direct,
 * ni ambre, ni couleur de défaite).
 */
export const ARENA_NAV_LINKS = [
  { href: "/joueurs", labelKey: "nav.links.players", rgb: "var(--blue-500-rgb)" },
  { href: "/equipes", labelKey: "nav.links.teams", rgb: "var(--violet-400-rgb)" },
  { href: "/tournois", labelKey: "nav.links.tournaments", rgb: "var(--teal-400-rgb)" },
  { href: "/classement", labelKey: "nav.links.ranking", rgb: "var(--pink-400-rgb)" },
] as const satisfies ReadonlyArray<{ href: string; labelKey: ShellKey; rgb: string }>;
const links = ARENA_NAV_LINKS;

export function ArenaNav({
  pseudo,
  avatarUrl,
  activeTeam,
  openReports = null,
  languageSwitcherLabel,
}: Readonly<ArenaNavProps>) {
  // Chemin sans préfixe de langue : `/en/tournois` reste la section « Tournois ».
  const { path: pathname } = useLocalePathname();
  const { t } = useShellText();
  // Le sélecteur se tait sur une route pas encore traduite : décidé ici pour ne
  // pas rendre un groupe d'outils vide, dont le filet resterait seul.
  const languageLabel = languageSwitcherLabel && isMigratedRoute(pathname) ? languageSwitcherLabel : null;
  // Au-delà de 99, la pastille déborderait du drapeau ; le compte exact reste lu.
  const badge = openReports !== null && openReports > 99 ? "99+" : openReports;

  return (
    <nav className={s.nav} aria-label={t("nav.mainLabel")} data-sticky-header>
      <div className={`container ${s.navInner}`}>
        <div className={s.navLeft}>
          {links.map((link) => {
            const isActive = isNavLinkActive(pathname, link.href);
            return (
              <LocaleLink
                key={link.href}
                href={link.href}
                aria-current={isActive ? "page" : undefined}
                className={`${s.navLink} ${isActive ? s.navLinkActive : ""}`}
                style={{ "--nav-rgb": link.rgb } as React.CSSProperties}
              >
                {t(link.labelKey)}
              </LocaleLink>
            );
          })}
        </div>

        <LocaleLink href="/" className={s.navLogo} aria-label={t("nav.home")}>
          <LogoWithGlow
            src="/logo_bg.webp"
            alt={t("nav.logoAlt")}
            width={32}
            height={32}
            size="sm"
            borderRadius={8}
            borderColor="rgba(0,0,0,0)"
          />
        </LocaleLink>

        <div className={s.navRight}>
          {/* Barre allégée : l'accueil passe par le logo, « Mon équipe » par le
              menu du compte. Restent les outils (langue, modération) et le
              compte, séparés par un filet — le groupe n'est rendu que s'il a
              quelque chose à montrer (sinon le filet resterait seul). */}
          {(languageLabel || openReports !== null) && (
            <div className={s.navTools}>
              {/* Même page dans l'autre langue — seulement sur une route traduite. */}
              {languageLabel && <LanguageSwitcher label={languageLabel} compact className={s.navTool} />}
              {openReports !== null && (
                <LocaleLink
                  href={REPORTS_ADMIN_PATH}
                  className={`${s.navTool} ${s.navReports}`}
                  aria-current={isNavLinkActive(pathname, REPORTS_ADMIN_PATH) ? "page" : undefined}
                >
                  <Flag size={16} strokeWidth={2} aria-hidden="true" />
                  {/* Libellé visible sur grand écran, lu seul en dessous de 1280 px. */}
                  <span className={s.navReportsLabel}>{t("nav.reports")}</span>
                  {openReports > 0 && (
                    <>
                      <span className={s.navBadge} aria-hidden="true">
                        {badge}
                      </span>
                      <span className="sr-only">{`, ${openReports} ${t("nav.reportsPending", { count: openReports })}`}</span>
                    </>
                  )}
                </LocaleLink>
              )}
            </div>
          )}
          {/* Profil, équipe et déconnexion, à portée de main sur toutes les largeurs. */}
          <AccountMenu pseudo={pseudo} avatarUrl={avatarUrl} activeTeam={activeTeam} />
        </div>
      </div>
    </nav>
  );
}

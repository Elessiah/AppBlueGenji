"use client";

import { Flag } from "lucide-react";
import { LocaleLink, useLocalePathname } from "@/components/i18n/locale-navigation";
import { LogoWithGlow } from "./logo-with-glow";
import { AccountMenu } from "./account-menu";
import { LanguageSwitcher, useSwitchablePath } from "./i18n/LanguageSwitcher";
import { isNavLinkActive } from "@/lib/shared/nav-active";
import { REPORTS_ADMIN_PATH } from "@/lib/shared/content-reports";
import type { ShellKey } from "@/lib/shared/shell-text";
import { useShellText } from "./i18n/shell-text";
import s from "./site-nav.module.css";

type SiteNavProps = {
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
export const SITE_NAV_LINKS = [
  { href: "/joueurs", labelKey: "nav.links.players", rgb: "var(--blue-500-rgb)" },
  { href: "/equipes", labelKey: "nav.links.teams", rgb: "var(--violet-400-rgb)" },
  { href: "/tournois", labelKey: "nav.links.tournaments", rgb: "var(--teal-400-rgb)" },
  { href: "/classement", labelKey: "nav.links.ranking", rgb: "var(--pink-400-rgb)" },
] as const satisfies ReadonlyArray<{ href: string; labelKey: ShellKey; rgb: string }>;
const links = SITE_NAV_LINKS;

export function SiteNav({
  pseudo,
  avatarUrl,
  activeTeam,
  openReports = null,
  languageSwitcherLabel,
}: Readonly<SiteNavProps>) {
  // Chemin sans préfixe de langue : `/en/tournois` reste la section « Tournois ».
  const { path: pathname } = useLocalePathname();
  const { t } = useShellText();
  // Le sélecteur se tait sur une route pas encore traduite (même décision que
  // lui) : le savoir d'avance évite un groupe d'outils vide au filet orphelin.
  const switchable = useSwitchablePath() !== null;
  const languageLabel = switchable && languageSwitcherLabel ? languageSwitcherLabel : null;
  const pending = openReports !== null && openReports > 0;
  const badge = pending ? reportsBadge(openReports) : null;

  return (
    <nav className={s.nav} aria-label={t("nav.mainLabel")} data-sticky-header>
      <div className={`container ${s.navInner}`}>
        {/* Largeur étroite : logo, compte, puis liens (ordre visuel = ordre du clavier).
            Logo et liens existent en deux copies qui s'excluent en CSS par `display: none`, qui les retire
            de l'arbre d'accessibilité et de l'ordre du focus : une seule est lue. */}
        <HomeLogo className={s.navLogoMobile} />
        <NavLinks className={s.navLeft} pathname={pathname} />

        <HomeLogo className={s.navLogo} />

        <div className={s.navRight}>
          {/* Barre allégée : l'accueil passe par le logo, « Mon équipe » par le
              menu du compte. Restent les outils (langue, modération) et le
              compte, séparés par un filet — le groupe n'est rendu que s'il a
              quelque chose à montrer (sinon le filet resterait seul). */}
          {(languageLabel || openReports !== null) && (
            <div className={s.navTools}>
              {/* Même page dans l'autre langue — seulement sur une route traduite. */}
              {languageLabel && <LanguageSwitcher label={languageLabel} />}
              {openReports !== null && (
                <LocaleLink
                  href={REPORTS_ADMIN_PATH}
                  className={[s.navTool, s.navReports, pending && s.navReportsPending].filter(Boolean).join(" ")}
                  aria-current={isNavLinkActive(pathname, REPORTS_ADMIN_PATH) ? "page" : undefined}
                >
                  <Flag size={16} strokeWidth={2} aria-hidden="true" />
                  {/* Libellé visible dès 1150 px, lu seul en dessous. */}
                  <span className={s.navReportsLabel}>{t("nav.reports")}</span>
                  {pending && (
                    <>
                      {/* Le nom lu contient le compte affiché (« 99+ » compris) :
                          « Signalements, 2 à traiter ». */}
                      <span className="sr-only">{t("nav.reportsCountLead")}</span>
                      <span className={s.navBadge}>{badge}</span>
                      <span className="sr-only">{` ${t("nav.reportsPending", { count: openReports })}`}</span>
                    </>
                  )}
                </LocaleLink>
              )}
            </div>
          )}
          {/* Profil, équipe et déconnexion, à portée de main sur toutes les largeurs. */}
          <AccountMenu pseudo={pseudo} avatarUrl={avatarUrl} activeTeam={activeTeam} />
        </div>
        <NavLinks className={s.navLeftMobile} pathname={pathname} />
      </div>
    </nav>
  );
}

/**
 * Les liens de section, rendus deux fois (voir `SiteNav`) : en bureau avant le
 * logo, en largeur étroite après le compte, comme à l'écran.
 */
function NavLinks({ className, pathname }: Readonly<{ className: string; pathname: string }>) {
  const { t } = useShellText();
  return (
    <div className={className}>
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
  );
}

/** Lien d'accueil par le logo (rendu deux fois, une seule copie visible : voir `SiteNav`). */
function HomeLogo({ className }: Readonly<{ className: string }>) {
  const { t } = useShellText();
  return (
    <LocaleLink href="/" className={className} aria-label={t("nav.home")} title={t("nav.home")}>
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
  );
}

/** Texte de la pastille : au-delà de 99, elle déborderait du drapeau. */
function reportsBadge(count: number): string {
  return count > 99 ? "99+" : String(count);
}

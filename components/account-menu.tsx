"use client";

import { useEffect, useId, useRef, useState } from "react";
import { LogOut, Shield, UserRound } from "lucide-react";
import { LocaleLink } from "@/components/i18n/locale-navigation";
import { entrantHref } from "@/lib/shared/participants";
import { UserAvatar } from "./user-avatar";
import { focusLeftMenu, handleMenuEscape } from "./cyber/landing/PublicNavMenu";
import { useShellText } from "./i18n/shell-text";
import { useLogout } from "./use-logout";
import s from "./account-menu.module.css";

export type AccountMenuTeam = { teamId: number; teamName: string };

type AccountMenuProps = {
  pseudo: string;
  avatarUrl: string | null;
  activeTeam?: AccountMenuTeam | null;
};

/**
 * Menu du compte, sous l'avatar : « Mon profil », « Mon équipe » et
 * « Déconnexion ». La déconnexion n'existait qu'au bas de `/profil` (plus de
 * quatre mille pixels de défilement sur mobile), et « Mon équipe » disparaissait
 * de la barre sous 720 px — l'onglet « Équipes » menant à l'annuaire, pas à la
 * sienne. Rendu par la barre de l'espace connecté **et** par l'en-tête public :
 * le même geste au même endroit, où que l'on soit sur le site.
 *
 * Bouton de divulgation et non `role="menu"` : le panneau est une courte liste
 * de liens, que le lecteur d'écran parcourt à la tabulation. Il se ferme au clic
 * en dehors, sur un lien, avec Échap (le focus revient au bouton) et quand la
 * tabulation en sort — mêmes règles que le menu de la vitrine.
 */
export function AccountMenu({ pseudo, avatarUrl, activeTeam = null }: Readonly<AccountMenuProps>) {
  const { t } = useShellText();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      handleMenuEscape(e.key, document.activeElement, rootRef.current, buttonRef.current, () =>
        setOpen(false),
      );
    };
    const onPointer = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer);
    };
  }, [open]);

  const { leaving, logout: onLogout } = useLogout(() => setOpen(false));

  const close = () => setOpen(false);

  return (
    <div
      className={s.root}
      ref={rootRef}
      onBlur={(e) => {
        if (open && focusLeftMenu(rootRef.current, e.relatedTarget)) setOpen(false);
      }}
    >
      {/* Le nom accessible commence par le pseudo affiché (WCAG 2.5.3). */}
      <button
        ref={buttonRef}
        type="button"
        className={`${s.trigger} ${open ? s.triggerOpen : ""}`}
        aria-label={t("account.menuLabel", { pseudo })}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((v) => !v)}
      >
        <UserAvatar src={avatarUrl} pseudo={pseudo} size={30} borderWidth={1} decorative />
        <span className={s.name}>{pseudo}</span>
        <span className={s.caret} aria-hidden="true">
          ▾
        </span>
      </button>

      {open && (
        <AccountMenuPanel
          id={panelId}
          activeTeam={activeTeam}
          leaving={leaving}
          onNavigate={close}
          onLogout={onLogout}
        />
      )}
    </div>
  );
}

/** Le panneau ouvert, séparé pour être rendu (et testé) sans état. */
export function AccountMenuPanel({
  id,
  activeTeam,
  leaving,
  onNavigate,
  onLogout,
}: Readonly<{
  id: string;
  activeTeam: AccountMenuTeam | null;
  leaving: boolean;
  onNavigate: () => void;
  onLogout: () => void;
}>) {
  const { t } = useShellText();
  return (
    <div id={id} className={s.panel}>
      <LocaleLink href="/profil" className={s.item} onClick={onNavigate}>
        <UserRound className={s.itemIcon} size={16} aria-hidden="true" />
        <span className={s.itemText}>{t("account.profile")}</span>
      </LocaleLink>
      {activeTeam && (
        <LocaleLink
          href={entrantHref(activeTeam.teamId, null)}
          className={s.item}
          onClick={onNavigate}
          aria-label={activeTeam.teamName ? t("nav.myTeamLabel", { team: activeTeam.teamName }) : t("nav.myTeam")}
        >
          <Shield className={s.itemIcon} size={16} aria-hidden="true" />
          <span className={s.itemText}>
            {t("nav.myTeam")}
            {/* `title` : le nom complet au survol quand il est rogné ; muet, le
                rappel étant masqué aux technologies d'assistance. */}
            {/* NOSONAR S6772 — entrée en flex colonne : l'indication passe à la ligne */}
            {activeTeam.teamName ? (
              <span className={s.itemHint} aria-hidden="true" title={activeTeam.teamName}>
                {activeTeam.teamName}
              </span>
            ) : null}
          </span>
        </LocaleLink>
      )}
      <button type="button" className={`${s.item} ${s.logout}`} onClick={() => !leaving && onLogout()}
        aria-disabled={leaving || undefined}
        aria-busy={leaving || undefined}
      >
        <LogOut className={s.itemIcon} size={16} aria-hidden="true" />
        <span className={s.itemText}>{leaving ? t("account.loggingOut") : t("account.logout")}</span>
      </button>
    </div>
  );
}

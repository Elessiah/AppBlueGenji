"use client";

import { useEffect, useId, useRef, useState } from "react";
import { LocaleLink, useLocaleRouter } from "@/components/i18n/locale-navigation";
import { UserAvatar } from "./user-avatar";
import { useToast } from "./ui/toast";
import { focusLeftMenu, handleMenuEscape } from "./cyber/landing/PublicNavMenu";
import s from "./account-menu.module.css";

export type AccountMenuTeam = { teamId: number; teamName: string };

type AccountMenuProps = {
  pseudo: string;
  avatarUrl: string | null;
  activeTeam?: AccountMenuTeam | null;
};

/** Message du toast quand la déconnexion n'a pas abouti. */
export const LOGOUT_FAILED_MESSAGE = "La déconnexion a échoué. Réessaie dans un instant.";

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
  const router = useLocaleRouter();
  const { showError } = useToast();
  const [open, setOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
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

  const onLogout = async () => {
    if (leaving) return;
    setLeaving(true);
    const done = await requestLogout();
    setLeaving(false);
    if (!done) {
      showError(LOGOUT_FAILED_MESSAGE);
      return;
    }
    setOpen(false);
    router.push("/");
    router.refresh();
  };

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
        aria-label={`${pseudo}, menu du compte`}
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
  return (
    <div id={id} className={s.panel}>
      <LocaleLink href="/profil" className={s.item} onClick={onNavigate}>
        Mon profil
      </LocaleLink>
      {activeTeam && (
        <LocaleLink
          href={`/equipes/${activeTeam.teamId}`}
          className={s.item}
          onClick={onNavigate}
          aria-label={`Mon équipe : ${activeTeam.teamName}`}
        >
          Mon équipe
          {/* NOSONAR S6772 — entrée en flex colonne : l'indication passe à la ligne */}
          <span className={s.itemHint} aria-hidden="true">
            {activeTeam.teamName}
          </span>
        </LocaleLink>
      )}
      <button type="button" className={`${s.item} ${s.logout}`} onClick={onLogout} disabled={leaving}>
        {leaving ? "Déconnexion…" : "Déconnexion"}
      </button>
    </div>
  );
}

/**
 * Ferme la session côté serveur. Rend `false` si la requête échoue ou est
 * refusée : l'appelant le dit (toast) au lieu de ramener à l'accueil un
 * joueur toujours connecté.
 */
export async function requestLogout(fetchImpl: typeof fetch = fetch): Promise<boolean> {
  try {
    const res = await fetchImpl("/api/auth/logout", { method: "POST" });
    return res.ok;
  } catch {
    return false;
  }
}

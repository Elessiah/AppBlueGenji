"use client";

import { useEffect, useId, useRef, useState, type ComponentProps } from "react";
import { BookOpen, CalendarClock, Drama, Eye, LogOut, Shield, UserRound } from "lucide-react";
import { LocaleLink } from "@/components/i18n/locale-navigation";
import { entrantHref } from "@/lib/shared/participants";
import { DEVDOC_PATH } from "@/lib/shared/dev-docs";
import { PLANNING_PATH } from "@/lib/shared/planning";
import { UserAvatar } from "./user-avatar";
import { focusLeftMenu, handleMenuEscape } from "./cyber/landing/PublicNavMenu";
import { useShellText } from "./i18n/shell-text";
import { useLogout } from "./use-logout";
import { useToast } from "@/components/ui/toast";
import {
  loadedImpersonateRoleDialog,
  loadImpersonateRoleDialog,
  preloadImpersonateRoleDialog,
  type ImpersonateRoleDialogComponent,
} from "./impersonate-role-loader";
import { takePlayerViewFocus, usePlayerViewToggle } from "./player-view-toggle";
import type { PlayerViewMenuMode } from "@/lib/shared/player-view";
import s from "./account-menu.module.css";

const PLAYER_VIEW_MENU_KEYS = {
  enter: { idle: "account.impersonate", pending: "account.impersonate" },
  back: { idle: "playerView.back", pending: "playerView.backPending" },
} as const;

export type AccountMenuTeam = { teamId: number; teamName: string };

type AccountMenuProps = {
  pseudo: string;
  avatarUrl: string | null;
  activeTeam?: AccountMenuTeam | null;
  /** Lien vers la documentation développeur (permission `dev`, `DEVDOC.md`). */
  devDocs?: boolean;
  /** Lien « Planning » des casts et arbitres (permission `planning`, `CAST_PLANNING.md`). */
  planning?: boolean;
  /**
   * Entrée de l'incarnation (`ADMIN_ROLE_IMPERSONATION.md`) : `"enter"`
   * (« Incarner un rôle », qui ouvre la modale du choix) pour un
   * administrateur qui n'incarne rien, `"back"` (« Revenir en vue admin »)
   * pendant l'incarnation — la bannière défile avec la page, le menu reste
   * sous la barre fixe. Rien pour un autre compte.
   */
  playerViewEntry?: PlayerViewMenuMode | null;
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
export function AccountMenu({
  pseudo,
  avatarUrl,
  activeTeam = null,
  devDocs = false,
  planning = false,
  playerViewEntry = null,
}: Readonly<AccountMenuProps>) {
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

  // Après le retour en vue admin, la bannière a disparu : le focus revient au
  // bouton du compte plutôt que de se perdre sur la page.
  useEffect(() => {
    if (playerViewEntry === "enter" && takePlayerViewFocus("account")) buttonRef.current?.focus();
  }, [playerViewEntry]);

  const close = () => setOpen(false);
  // Modale « Incarner un rôle » ouverte. Une bascule réussie la ferme avec le menu.
  const [choosing, setChoosing] = useState(false);
  const [loadingDialog, setLoadingDialog] = useState(false);
  const { showError } = useToast();
  // Le code de la modale part dès l'ouverture du menu : le clic la trouve prête.
  useEffect(() => {
    if (open && playerViewEntry === "enter") preloadImpersonateRoleDialog();
  }, [open, playerViewEntry]);
  const { pending: switching, toggle } = usePlayerViewToggle(() => {
    setOpen(false);
    setChoosing(false);
  });
  const closeChoice = () => {
    setChoosing(false);
    // Le menu s'est refermé à l'ouverture de la modale : le focus revient au compte.
    buttonRef.current?.focus();
  };
  const onEntry = () => {
    if (playerViewEntry === "enter") {
      if (loadedImpersonateRoleDialog()) {
        setOpen(false);
        setChoosing(true);
        return;
      }
      if (loadingDialog) return;
      // Pas encore arrivée : le menu reste ouvert (son entrée « occupée »)
      // jusqu'à la modale ; un échec se dit, le geste suivant retente.
      setLoadingDialog(true);
      loadImpersonateRoleDialog().then(
        () => {
          setLoadingDialog(false);
          setOpen(false);
          setChoosing(true);
        },
        () => {
          setLoadingDialog(false);
          showError(t("account.impersonateFailed"));
        },
      );
      return;
    }
    void toggle(false);
  };

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
          devDocs={devDocs}
          planning={planning}
          playerView={playerViewEntry ? { mode: playerViewEntry, pending: playerViewEntry === "back" ? switching : loadingDialog, toggle: onEntry } : null}
          leaving={leaving}
          onNavigate={close}
          onLogout={onLogout}
        />
      )}
      {choosing && <ChoiceDialog onClose={closeChoice} onConfirm={(roles) => toggle(true, roles)} />}
    </div>
  );
}

/** La modale du choix, une fois chargée (`impersonate-role-loader.ts`) ; rien d'ici là. */
function ChoiceDialog(props: Readonly<ComponentProps<ImpersonateRoleDialogComponent>>) {
  const Dialog = loadedImpersonateRoleDialog();
  return Dialog ? <Dialog {...props} /> : null;
}

/** Le panneau ouvert, séparé pour être rendu (et testé) sans état. */
export function AccountMenuPanel({
  id,
  activeTeam,
  devDocs = false,
  planning = false,
  playerView = null,
  leaving,
  onNavigate,
  onLogout,
}: Readonly<{
  id: string;
  activeTeam: AccountMenuTeam | null;
  devDocs?: boolean;
  planning?: boolean;
  /** Entrée de l'incarnation, pour un administrateur ({@link AccountMenuProps.playerViewEntry}). */
  playerView?: { mode: PlayerViewMenuMode; pending: boolean; toggle: () => void } | null;
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
      {planning && (
        <LocaleLink href={PLANNING_PATH} className={s.item} onClick={onNavigate}>
          <CalendarClock className={s.itemIcon} size={16} aria-hidden="true" />
          <span className={s.itemText}>{t("account.planning")}</span>
        </LocaleLink>
      )}
      {devDocs && (
        <LocaleLink href={DEVDOC_PATH} className={s.item} onClick={onNavigate}>
          <BookOpen className={s.itemIcon} size={16} aria-hidden="true" />
          <span className={s.itemText}>{t("account.devDocs")}</span>
        </LocaleLink>
      )}
      {playerView && (
        <button
          type="button"
          className={s.item}
          onClick={() => !playerView.pending && playerView.toggle()}
          aria-disabled={playerView.pending || undefined}
          aria-busy={playerView.pending || undefined}
        >
          {playerView.mode === "enter" ? (
            <Drama className={s.itemIcon} size={16} aria-hidden="true" />
          ) : (
            <Eye className={s.itemIcon} size={16} aria-hidden="true" />
          )}
          <span className={s.itemText}>
            {t(PLAYER_VIEW_MENU_KEYS[playerView.mode][playerView.pending ? "pending" : "idle"])}
          </span>
        </button>
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

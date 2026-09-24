"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ScrollArea } from "@/components/cyber/ScrollArea";
import {
  A11Y_SETTINGS,
  a11yAttribute,
  a11yCookieString,
  toggleA11ySetting,
  type A11ySettingKey,
} from "@/lib/shared/accessibility-settings";
import { OPEN_ACCESSIBILITY_MENU_EVENT } from "@/lib/shared/accessibility-menu-request";
import styles from "./AccessibilityMenu.module.css";

/**
 * Applique un choix à la page ouverte et le garde pour les suivantes : l'attribut
 * de `<html>` change le rendu tout de suite, le cookie le fait poser par le
 * serveur dès le HTML initial du prochain chargement.
 */
function applySettings(keys: A11ySettingKey[]): void {
  const root = document.documentElement;
  const attribute = a11yAttribute(keys);
  if (attribute) root.setAttribute("data-a11y", attribute);
  else root.removeAttribute("data-a11y");
  try {
    document.cookie = a11yCookieString(keys, window.location.protocol === "https:");
  } catch {
    // Cookies refusés : le réglage vaut pour la page ouverte, pas au-delà.
  }
}

/** Intitulé du bouton flottant : il dit combien de réglages sont actifs. */
export function accessibilityButtonLabel(activeCount: number): string {
  if (activeCount === 0) return "Réglages d'accessibilité";
  return `Réglages d'accessibilité (${activeCount} actif${activeCount > 1 ? "s" : ""})`;
}

interface AccessibilityMenuProps {
  /** Réglages lus dans le cookie par la mise en page racine. */
  initialSettings: A11ySettingKey[];
}

/**
 * Bouton flottant d'accessibilité, en bas à gauche, et son menu.
 *
 * Le coin gauche est le seul libre : à droite vivent le bouton « ? » des règles
 * (pages de tournoi) et le témoin du régime de charge. Les notifications, qui
 * occupaient ce coin, montent d'un cran au-dessus du bouton.
 *
 * Le menu est un **panneau non modal** (motif « disclosure ») : il ne bloque
 * pas la page, pour qu'on voie l'effet d'un réglage au moment où on le coche.
 * Échap et un clic à côté le referment ; Échap rend le focus au bouton. Le
 * panneau suit le bouton dans l'ordre du document, si bien que `Tab` y entre
 * directement.
 *
 * Le menu s'ouvre aussi **à la demande** d'un autre point de la page — le lien
 * « Accessibilité » du pied de page (`requestAccessibilityMenu`). Il prend alors
 * le focus, puisque le panneau ne suit pas ce lien dans l'ordre du document, et
 * le rend en se fermant à l'élément qui l'a demandé plutôt qu'au bouton flottant.
 */
export function AccessibilityMenu({ initialSettings }: AccessibilityMenuProps) {
  const [settings, setSettings] = useState<A11ySettingKey[]>(initialSettings);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  // Élément à qui rendre le focus à la fermeture, quand le menu a été ouvert
  // d'ailleurs que par son bouton ; `null` = le bouton flottant.
  const returnFocusRef = useRef<HTMLElement | null>(null);
  // Ouvert à la demande, le menu doit prendre le focus une fois le panneau rendu.
  const pendingFocusRef = useRef(false);
  const panelId = useId();
  const titleId = useId();

  useEffect(() => {
    const onRequest = () => {
      const active = document.activeElement;
      returnFocusRef.current =
        active instanceof HTMLElement && active !== document.body && !rootRef.current?.contains(active)
          ? active
          : null;
      const panel = document.getElementById(panelId);
      if (panel) panel.focus();
      else pendingFocusRef.current = true;
      setOpen(true);
    };
    window.addEventListener(OPEN_ACCESSIBILITY_MENU_EVENT, onRequest);
    return () => window.removeEventListener(OPEN_ACCESSIBILITY_MENU_EVENT, onRequest);
  }, [panelId]);

  // Le panneau n'existe qu'une fois rendu ouvert : le focus attend ce rendu.
  useEffect(() => {
    if (!open || !pendingFocusRef.current) return;
    pendingFocusRef.current = false;
    document.getElementById(panelId)?.focus();
  }, [open, panelId]);

  /** Rend le focus à qui a ouvert le menu, s'il est encore dans la page. */
  const restoreFocus = useCallback(() => {
    const opener = returnFocusRef.current;
    returnFocusRef.current = null;
    if (opener?.isConnected) opener.focus();
    else buttonRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    // Échap ne répond que si le focus est dans le menu, ou nulle part : une
    // modale ouverte par-dessus (lancement de match) traite son propre Échap,
    // et le focus ne doit pas lui être repris.
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const active = document.activeElement;
      const inside = active !== null && rootRef.current?.contains(active) === true;
      if (!inside && active !== null && active !== document.body) return;
      setOpen(false);
      if (inside) restoreFocus();
      else returnFocusRef.current = null;
    };
    // Un clic à côté, ou le focus clavier qui quitte le menu, le referment :
    // laissé ouvert, le panneau masquerait le bas de la page où la tabulation
    // continue (WCAG 2.4.11).
    const onOutside = (event: Event) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      setOpen(false);
      returnFocusRef.current = null;
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onOutside);
    document.addEventListener("focusin", onOutside);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onOutside);
      document.removeEventListener("focusin", onOutside);
    };
  }, [open, restoreFocus]);

  const update = (next: A11ySettingKey[]) => {
    setSettings(next);
    applySettings(next);
  };

  const close = () => {
    setOpen(false);
    restoreFocus();
  };

  const label = accessibilityButtonLabel(settings.length);

  return (
    // `a11y-always-contrast` : le menu se lit toujours en contraste renforcé,
    // réglage coché ou non — c'est lui qui permet de l'activer.
    <div ref={rootRef} className={`${styles.root} a11y-always-contrast`}>
      <button
        ref={buttonRef}
        type="button"
        className={styles.fab}
        aria-label={label}
        title={label}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => {
          returnFocusRef.current = null;
          setOpen((value) => !value);
        }}
      >
        <span className={styles.icon} aria-hidden="true" />
        {settings.length > 0 && (
          <span className={styles.count} aria-hidden="true">
            {settings.length}
          </span>
        )}
      </button>
      {open && (
        <AccessibilityPanel
          id={panelId}
          titleId={titleId}
          settings={settings}
          onToggle={(key, enabled) => update(toggleA11ySetting(settings, key, enabled))}
          onReset={() => update([])}
          onClose={close}
        />
      )}
    </div>
  );
}

interface AccessibilityPanelProps {
  id: string;
  titleId: string;
  settings: A11ySettingKey[];
  onToggle: (key: A11ySettingKey, enabled: boolean) => void;
  onReset: () => void;
  onClose: () => void;
}

/** Contenu du menu, séparé pour être rendu et testé sans l'état d'ouverture. */
export function AccessibilityPanel({ id, titleId, settings, onToggle, onReset, onClose }: AccessibilityPanelProps) {
  return (
    // `tabIndex={-1}` : le panneau reçoit le focus quand le menu est ouvert
    // depuis le pied de page, sans devenir un arrêt de la tabulation.
    <div id={id} className={styles.panel} role="region" aria-labelledby={titleId} tabIndex={-1}>
      <div className={styles.head}>
        <p id={titleId} className={styles.title}>
          Accessibilité
        </p>
        <button type="button" className={styles.close} aria-label="Fermer le menu d'accessibilité" onClick={onClose}>
          <span aria-hidden="true">×</span>
        </button>
      </div>
      <p className={styles.intro}>Tous désactivés par défaut. Ton choix est gardé dans ce navigateur.</p>
      <ScrollArea orientation="y" className={styles.list} ariaLabel="Réglages d'accessibilité">
        <ul className={styles.options}>
          {A11Y_SETTINGS.map((setting) => {
            const descriptionId = `${id}-${setting.key}`;
            const labelId = `${descriptionId}-label`;
            return (
              <li key={setting.key}>
                {/* Le `<label>` rend toute la ligne cliquable, mais le nom de
                    la case est son seul intitulé (`aria-labelledby`) : sans
                    cela il contiendrait aussi la description, que
                    `aria-describedby` fait déjà lire — deux fois donc. */}
                <label className={styles.option}>
                  <input
                    type="checkbox"
                    checked={settings.includes(setting.key)}
                    aria-labelledby={labelId}
                    aria-describedby={descriptionId}
                    onChange={(event) => onToggle(setting.key, event.target.checked)}
                  />
                  <span className={styles.optionText}>
                    <span id={labelId} className={styles.optionLabel}>
                      {setting.label}
                    </span>
                    <span id={descriptionId} className={styles.optionDescription}>
                      {setting.description}
                    </span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
        <p className={styles.hint}>
          Pour agrandir le texte, utilise le zoom de ton navigateur (Ctrl + ou ⌘ + sur Mac).
        </p>
      </ScrollArea>
      <div className={styles.foot}>
        {/* `aria-disabled` et non `disabled` : le bouton garde le focus après
            avoir servi, au lieu de le jeter au `<body>` en se désactivant. */}
        <button
          type="button"
          className={styles.reset}
          aria-disabled={settings.length === 0}
          onClick={() => {
            if (settings.length > 0) onReset();
          }}
        >
          Tout désactiver
        </button>
      </div>
    </div>
  );
}

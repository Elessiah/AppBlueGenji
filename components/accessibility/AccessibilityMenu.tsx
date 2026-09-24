"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ScrollArea } from "@/components/cyber/ScrollArea";
import {
  A11Y_SETTINGS,
  a11yAttribute,
  a11yCookieString,
  toggleA11ySetting,
  type A11ySettingKey,
} from "@/lib/shared/accessibility-settings";
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
 */
export function AccessibilityMenu({ initialSettings }: AccessibilityMenuProps) {
  const [settings, setSettings] = useState<A11ySettingKey[]>(initialSettings);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const titleId = useId();

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
      if (inside) buttonRef.current?.focus();
    };
    // Un clic à côté, ou le focus clavier qui quitte le menu, le referment :
    // laissé ouvert, le panneau masquerait le bas de la page où la tabulation
    // continue (WCAG 2.4.11).
    const onOutside = (event: Event) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onOutside);
    document.addEventListener("focusin", onOutside);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onOutside);
      document.removeEventListener("focusin", onOutside);
    };
  }, [open]);

  const update = (next: A11ySettingKey[]) => {
    setSettings(next);
    applySettings(next);
  };

  const close = () => {
    setOpen(false);
    buttonRef.current?.focus();
  };

  const label = accessibilityButtonLabel(settings.length);

  return (
    <div ref={rootRef} className={styles.root}>
      <button
        ref={buttonRef}
        type="button"
        className={styles.fab}
        aria-label={label}
        title={label}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((value) => !value)}
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
    <div id={id} className={styles.panel} role="region" aria-labelledby={titleId}>
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
            return (
              <li key={setting.key}>
                <label className={styles.option}>
                  <input
                    type="checkbox"
                    checked={settings.includes(setting.key)}
                    aria-describedby={descriptionId}
                    onChange={(event) => onToggle(setting.key, event.target.checked)}
                  />
                  <span className={styles.optionText}>
                    <span className={styles.optionLabel}>{setting.label}</span>
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

"use client";

import { InputHTMLAttributes, useState } from "react";

type CocheTheme = "tournoi" | "joueur" | "equipe";

interface CocheProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "onChange"> {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  theme?: CocheTheme;
  checkedColor?: string;
}

const THEME_COLORS: Record<CocheTheme, { base: string; rgb: string }> = {
  tournoi: { base: "#4fe0a2", rgb: "79,224,162" },
  joueur: { base: "#59d4ff", rgb: "89,212,255" },
  equipe: { base: "#ff9d2e", rgb: "255,157,46" },
};

/**
 * Le repère de focus ne se pose qu'au parcours **clavier**. `:focus-visible` est
 * la seule façon de le dire, mais tous les moteurs ne connaissent pas le
 * sélecteur : `matches()` lève alors une `SyntaxError` au beau milieu d'un
 * gestionnaire React. On retombe donc sur « focus = repère », plus bavard
 * qu'invisible.
 */
function isKeyboardFocus(element: HTMLInputElement): boolean {
  try {
    return element.matches(":focus-visible");
  } catch {
    return true;
  }
}

export function Coche({
  label,
  checked,
  onChange,
  theme = "joueur",
  checkedColor,
  ...props
}: CocheProps) {
  const color = checkedColor || THEME_COLORS[theme].base;
  const rgbColor = checkedColor || THEME_COLORS[theme].rgb;
  // La case native est masquée : c'est elle qui reçoit le focus, mais la
  // pastille qui se voit. Sans ce relais, un parcours au clavier traversait le
  // réglage sans aucun repère à l'écran.
  const [focused, setFocused] = useState(false);

  return (
    <label
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "7px 14px",
        borderRadius: 999,
        border: `1px solid ${checked ? `rgba(${rgbColor},0.4)` : "var(--line)"}`,
        background: checked ? `rgba(${rgbColor},0.1)` : "rgba(255,255,255,0.03)",
        boxShadow: focused ? `0 0 0 3px rgba(${rgbColor},0.28)` : "none",
        cursor: "pointer",
        fontSize: 14,
        userSelect: "none",
        transition: "border-color 0.15s, background 0.15s, box-shadow 0.15s",
      }}
    >
      {/* `{...props}` passe **avant** : étalé après, un `onFocus` ou un `onBlur`
          d'appelant remplacerait le relais et le repère clavier disparaîtrait
          sans un mot. Les gestionnaires de l'appelant sont donc chaînés, et le
          style de masquage reste le dernier — la pastille ne se voit que parce
          que l'input, lui, ne se voit pas. */}
      <input
        {...props}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        onFocus={(e) => {
          props.onFocus?.(e);
          setFocused(isKeyboardFocus(e.currentTarget));
        }}
        onBlur={(e) => {
          props.onBlur?.(e);
          setFocused(false);
        }}
        style={{
          ...props.style,
          position: "absolute",
          opacity: 0,
          width: 0,
          height: 0,
          pointerEvents: "none",
        }}
      />
      <span
        style={{
          flexShrink: 0,
          width: 16,
          height: 16,
          borderRadius: "50%",
          border: `1.5px solid ${checked ? `rgba(${rgbColor},0.8)` : "rgba(255,255,255,0.2)"}`,
          background: checked ? color : "transparent",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          transition: "all 0.15s",
          fontSize: 10,
          color: "var(--bg-0)",
          fontWeight: 900,
          lineHeight: 1,
        }}
      >
        {checked && "✓"}
      </span>
      <span style={{ color: checked ? "var(--text-0)" : "var(--text-1)" }}>
        {label}
      </span>
    </label>
  );
}

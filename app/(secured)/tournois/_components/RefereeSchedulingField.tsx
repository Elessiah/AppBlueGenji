"use client";

import type { TournamentFormText } from "@/lib/shared/tournament-actions-text";
import { checkboxCardChrome, HINT } from "../_lib/form-styles";
import { useFormText } from "../_lib/form-text";

/** Précision sous la description, selon l'écran. */
function scopeHint(text: TournamentFormText, mode: "create" | "edit", editable: boolean): string {
  if (!editable) return text.t("form.referee.finished");
  return text.t(mode === "create" ? "form.referee.create" : "form.referee.edit");
}

/**
 * Case « Matchs planifiés par l'arbitrage » du formulaire de tournoi.
 *
 * Contrairement aux autres réglages, elle **survit à la fenêtre d'édition** :
 * elle reste modifiable jusqu'à la clôture, tournoi en cours compris (la page
 * l'enregistre par sa route dédiée, pas par `PATCH .../edit`). D'où un
 * `editable` propre plutôt que la liste des champs de la fenêtre.
 *
 * La carte entière est le libellé natif de la case : un clic n'importe où la
 * coche, au clavier comme à la souris, sans `<div>` cliquable.
 */
export function RefereeSchedulingField({
  mode,
  checked,
  editable,
  warnUndoesLaunches,
  onChange,
}: Readonly<{
  mode: "create" | "edit";
  checked: boolean;
  /** Faux sur un tournoi terminé : la case est montrée, verrouillée. */
  editable: boolean;
  /** Cocher défera des lancements à l'enregistrement (tournoi en cours). */
  warnUndoesLaunches: boolean;
  onChange: (checked: boolean) => void;
}>) {
  const text = useFormText();
  const { t } = text;
  return (
    <>
      <label
        className="checkbox-card"
        htmlFor="referee-scheduling"
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 12,
          marginTop: 16,
          padding: "14px 16px",
          ...checkboxCardChrome(checked, !editable),
          borderRadius: 10,
          cursor: editable ? "pointer" : "default",
          transition: "border-color 0.2s ease, background-color 0.2s ease",
        }}
      >
        <input
          id="referee-scheduling"
          type="checkbox"
          checked={checked}
          disabled={!editable}
          onChange={(e) => onChange(e.target.checked)}
          // Nom court (le titre) et description à part : la carte-libellé
          // porte les deux textes, qui formeraient sinon un seul nom.
          aria-labelledby="referee-scheduling-label"
          aria-describedby={
            warnUndoesLaunches
              ? "referee-scheduling-hint referee-scheduling-warning"
              : "referee-scheduling-hint"
          }
          style={{ marginTop: 2 }}
        />
        <span style={{ flex: 1 }}>
          <span
            id="referee-scheduling-label"
            style={{
              display: "block",
              margin: "0 0 4px",
              fontSize: 14,
              fontWeight: 500,
              color: "var(--ink)",
            }}
          >
            {t("form.referee.label")}
          </span>
          <span id="referee-scheduling-hint" style={{ ...HINT, display: "block", margin: 0 }}>
            {t("form.referee.description")} {scopeHint(text, mode, editable)}
          </span>
        </span>
      </label>
      {warnUndoesLaunches && (
        // `<output>` : région d'état native, lue quand elle apparaît au clic.
        <output
          id="referee-scheduling-warning"
          style={{
            display: "block",
            marginTop: 8,
            padding: "8px 10px",
            borderRadius: 8,
            border: "1px solid rgba(var(--amber-rgb), 0.4)",
            background: "rgba(var(--amber-rgb), 0.1)",
            fontSize: 12,
            color: "var(--ink-soft, #c3ccd8)",
          }}
        >
          {t("form.referee.warning")}
        </output>
      )}
    </>
  );
}

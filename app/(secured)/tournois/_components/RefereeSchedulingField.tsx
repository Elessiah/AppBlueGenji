"use client";

import type { TournamentFormText } from "@/lib/shared/tournament-actions-text";
import { InfoHint, InfoHintRow } from "@/components/ui/info-hint";
import { CHECKBOX_CARD_LAYOUT, CHECKBOX_CARD_TITLE, checkboxCardChrome, HINT } from "../_lib/form-styles";
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
 * La carte porte la case, son titre (libellé natif) et le bouton « i » du
 * parcours d'un match (`docs/features/INFO_HINTS.md`) — un bouton ne se pose
 * pas dans un `<label>`. La ligne visible dit jusqu'à quand l'option se
 * modifie ; l'avertissement d'un tournoi en cours reste visible.
 */
export function RefereeSchedulingField({
  mode,
  checked,
  editable,
  warnUndoesLaunches,
  launchPhase = true,
  onChange,
}: Readonly<{
  mode: "create" | "edit";
  checked: boolean;
  /** Faux sur un tournoi terminé : la case est montrée, verrouillée. */
  editable: boolean;
  /** Cocher défera des lancements à l'enregistrement (tournoi en cours). */
  warnUndoesLaunches: boolean;
  /** Option « phase de lancement » : éteinte, aucun « Prêt » n'est effacé. Absente = allumée. */
  launchPhase?: boolean;
  onChange: (checked: boolean) => void;
}>) {
  const text = useFormText();
  const { t } = text;
  return (
    <>
      <div className="checkbox-card" style={{ ...CHECKBOX_CARD_LAYOUT, ...checkboxCardChrome(checked, !editable) }}>
        <input
          id="referee-scheduling"
          type="checkbox"
          checked={checked}
          disabled={!editable}
          onChange={(e) => onChange(e.target.checked)}
          aria-labelledby="referee-scheduling-label"
          aria-describedby={
            warnUndoesLaunches
              ? "referee-scheduling-more referee-scheduling-hint referee-scheduling-warning"
              : "referee-scheduling-more referee-scheduling-hint"
          }
          style={{ marginTop: 2 }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <InfoHintRow>
            <label
              id="referee-scheduling-label"
              htmlFor="referee-scheduling"
              style={{ ...CHECKBOX_CARD_TITLE, cursor: editable ? "pointer" : "default" }}
            >
              {t("form.referee.label")}
            </label>
            <InfoHint id="referee-scheduling-more" subject={t("form.referee.label")}>
              <p>{t("form.referee.description")}</p>
            </InfoHint>
          </InfoHintRow>
          <p id="referee-scheduling-hint" style={{ ...HINT, margin: "4px 0 0" }}>
            {scopeHint(text, mode, editable)}
          </p>
        </div>
      </div>
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
          {t(launchPhase ? "form.referee.warning" : "form.referee.warningDirect")}
        </output>
      )}
    </>
  );
}

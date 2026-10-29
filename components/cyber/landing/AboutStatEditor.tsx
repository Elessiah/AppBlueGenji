"use client";

import { useState, type KeyboardEvent } from "react";
import { BilingualField, EnglishMissingHint } from "@/components/ui/bilingual-field";
import { FieldErrorText } from "@/components/ui/field-error-text";
import { InfoHint, InfoHintRow } from "@/components/ui/info-hint";
import { useToast } from "@/components/ui/toast";
import {
  type AboutStat,
  ABOUT_STAT_FIELD_ERRORS,
  ABOUT_STAT_LABEL_MAX,
  ABOUT_STAT_VALUE_MAX,
  aboutStatErrorMessage,
  aboutStatValueNeedsEnglish,
  validateAboutStatInput,
} from "@/lib/shared/about-stats";
import { useFieldErrors } from "@/lib/shared/hooks/useFieldErrors";
import { hasEnglish } from "@/lib/shared/staff-translation";
import { LandingDialog } from "./LandingDialog";
import styles from "./AboutStats.module.css";

interface FormState {
  value: string;
  valueEn: string;
  label: string;
  labelEn: string;
}

/** `id` des champs du formulaire, cibles de `useFieldErrors`. */
const STAT_FIELD_IDS = {
  value: "about-stat-value",
  valueEn: "about-stat-value-en",
  label: "about-stat-label",
  labelEn: "about-stat-label-en",
} as const;

/** Explication du champ « Valeur en anglais », citée par son `aria-describedby`. */
const VALUE_EN_HINT_ID = "about-stat-value-en-help";
const VALUE_EN_MISSING_ID = "about-stat-value-en-missing";

const VALUE_EN_MISSING_TEXT =
  "Pas encore de valeur anglaise : la page anglaise affiche la valeur française telle quelle.";
const VALUE_EN_STALE_TEXT =
  "La valeur française a changé, pas l'anglaise : vérifie qu'elle correspond encore.";

/** Entrée dans un champ d'une ligne : passe au champ suivant (touche « Suivant » du clavier mobile comprise). */
function focusNextOnEnter(nextId: string) {
  return (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    document.getElementById(nextId)?.focus();
  };
}

interface AboutStatEditorProps {
  /** Carte modifiée ; `null` pour une création. */
  editing: AboutStat | null;
  /** Langue de la modale quand la page n'est pas française (`lang="fr"`, D4). */
  staffLang?: string;
  onClose: () => void;
  /** Carte enregistrée par le serveur ; `created` distingue l'ajout de la mise à jour. */
  onSaved: (stat: AboutStat, created: boolean) => void;
}

/**
 * Modale d'ajout / de modification d'un chiffre « L'association » (staff).
 * Chargée à la demande par `AboutStats` : ni son code ni celui de ses champs
 * ne partent chez un visiteur qui ne gère pas la section.
 */
export function AboutStatEditor({ editing, staffLang, onClose, onSaved }: Readonly<AboutStatEditorProps>) {
  const toast = useToast();
  const staffToast = staffLang ? { lang: staffLang } : undefined;
  const showError = (message: string) => toast.showError(message, staffToast);
  const fieldErrors = useFieldErrors(ABOUT_STAT_FIELD_ERRORS, STAT_FIELD_IDS);
  const [form, setForm] = useState<FormState>(() =>
    editing
      ? { value: editing.value, valueEn: editing.valueEn ?? "", label: editing.label, labelEn: editing.labelEn ?? "" }
      : { value: "", valueEn: "", label: "", labelEn: "" },
  );
  const [busy, setBusy] = useState(false);

  function close() {
    if (busy) return;
    onClose();
  }

  // Un refus désigne son champ (valeur, titre, anglais du titre) : rattaché à
  // lui, focus ramené, et la même phrase en notification.
  function refuse(code: string | undefined, fallback: string) {
    const message = aboutStatErrorMessage(code, fallback);
    fieldErrors.report(code, message);
    showError(message);
  }

  async function submit() {
    if (busy) return;
    const payload = {
      value: form.value.trim(),
      valueEn: form.valueEn.trim(),
      label: form.label.trim(),
      labelEn: form.labelEn.trim(),
    };
    // Même validation que le serveur, avant l'envoi : l'anglais (obligatoire,
    // D9) est désigné sans aller-retour.
    const check = validateAboutStatInput(payload);
    if (!check.ok) {
      refuse(check.error, "Formulaire invalide.");
      return;
    }

    setBusy(true);
    try {
      const url = editing ? `/api/association/about-stats/${editing.id}` : "/api/association/about-stats";
      const res = await fetch(url, {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as { stat?: AboutStat; error?: string };
      if (!res.ok || !data.stat) {
        refuse(data.error, "Échec de l'enregistrement.");
        return;
      }
      onSaved(data.stat, editing === null);
    } catch {
      showError("Erreur réseau, réessaye.");
    } finally {
      setBusy(false);
    }
  }

  const submitLabel = editing ? "Enregistrer" : "Ajouter";
  // Calculés ici seulement : la vitrine, modale fermée, n'en paie rien.
  // La valeur saisie se lirait telle quelle sur la page anglaise : le champ anglais le dit.
  const valueEnMissing = aboutStatValueNeedsEnglish(form);
  // Le français a changé sous une valeur anglaise gardée telle quelle : elle peut ne plus convenir.
  const valueEnStale =
    editing !== null &&
    hasEnglish(form.valueEn) &&
    form.valueEn.trim() === (editing.valueEn ?? "").trim() &&
    form.value.trim() !== editing.value.trim();
  let valueEnNote: string | null = null;
  if (valueEnMissing) valueEnNote = VALUE_EN_MISSING_TEXT;
  else if (valueEnStale) valueEnNote = VALUE_EN_STALE_TEXT;

  return (
    <LandingDialog onClose={close} busy={busy} className={styles.modal} labelledBy="about-stat-modal-title" lang={staffLang}>
      <h3 id="about-stat-modal-title" className={styles.modalTitle}>
        {editing ? "Modifier la carte" : "Ajouter une carte"}
      </h3>

      <div className={styles.modalField}>
        <label className={styles.modalLabel} htmlFor={STAT_FIELD_IDS.value}>
          Valeur
        </label>
        <input
          id={STAT_FIELD_IDS.value}
          className={styles.modalInput}
          value={form.value}
          maxLength={ABOUT_STAT_VALUE_MAX}
          placeholder="100%"
          enterKeyHint="next"
          readOnly={busy}
          {...fieldErrors.aria("value")}
          onChange={(e) => {
            fieldErrors.clear("value");
            setForm((f) => ({ ...f, value: e.target.value }));
          }}
          onKeyDown={focusNextOnEnter(STAT_FIELD_IDS.valueEn)}
        />
        {/* Hors du <label> : la phrase d'erreur ne s'ajoute pas au nom du champ. */}
        <FieldErrorText fieldId={STAT_FIELD_IDS.value} message={fieldErrors.message("value")} />
      </div>

      <div className={styles.modalField}>
        <InfoHintRow>
          <label className={styles.modalLabel} htmlFor={STAT_FIELD_IDS.valueEn}>
            Valeur en anglais (facultatif)
          </label>
          <InfoHint id={VALUE_EN_HINT_ID} subject="Valeur en anglais">
            <p>
              La valeur affichée sur la page anglaise, écrite à l'anglaise (« <span lang="en">€4,200</span> »,
              « <span lang="en">Free</span> »). Laissée vide, la valeur française y est reprise : faite de mots ou
              écrite à la française, la carte reste alors marquée « EN ».
            </p>
          </InfoHint>
        </InfoHintRow>
        <input
          id={STAT_FIELD_IDS.valueEn}
          className={styles.modalInput}
          value={form.valueEn}
          maxLength={ABOUT_STAT_VALUE_MAX}
          placeholder={form.value.trim() || "€4,200"}
          lang="en"
          enterKeyHint="next"
          readOnly={busy}
          {...fieldErrors.aria("valueEn", VALUE_EN_HINT_ID, valueEnNote !== null && VALUE_EN_MISSING_ID)}
          onChange={(e) => {
            fieldErrors.clear("valueEn");
            setForm((f) => ({ ...f, valueEn: e.target.value }));
          }}
          onKeyDown={focusNextOnEnter(STAT_FIELD_IDS.label)}
        />
        {valueEnNote !== null && <EnglishMissingHint id={VALUE_EN_MISSING_ID}>{valueEnNote}</EnglishMissingHint>}
        <FieldErrorText fieldId={STAT_FIELD_IDS.valueEn} message={fieldErrors.message("valueEn")} />
      </div>

      <div className={styles.modalField}>
        <BilingualField
          label="Titre"
          ids={{ fr: STAT_FIELD_IDS.label, en: STAT_FIELD_IDS.labelEn }}
          fields={{ fr: "label", en: "labelEn" }}
          errors={fieldErrors}
          values={{ fr: form.label, en: form.labelEn }}
          onChange={(lang, value) => setForm((f) => (lang === "fr" ? { ...f, label: value } : { ...f, labelEn: value }))}
          maxLength={ABOUT_STAT_LABEL_MAX}
          placeholders={{ fr: "Bénévole", en: "Volunteer-run" }}
          onEnter={() => void submit()}
          readOnly={busy}
          enMissing={editing !== null && !hasEnglish(editing.labelEn)}
          inputClassName={styles.modalInput}
          labelClassName={styles.modalLabel}
        />
      </div>

      <div className={styles.modalActions}>
        {/* `aria-disabled` + garde (`close`, `submit`) plutôt que `disabled` :
            le bouton cliqué garde le focus pendant l'envoi. Le nom reste
            « Enregistrer » / « Ajouter » (`aria-label`) : seul le visuel passe à « … ». */}
        <button type="button" className={styles.action} onClick={close} aria-disabled={busy}>
          Annuler
        </button>
        <button
          type="button"
          className={styles.actionPrimary}
          onClick={submit}
          aria-disabled={busy}
          aria-busy={busy}
          aria-label={submitLabel}
        >
          {busy ? "…" : submitLabel}
        </button>
      </div>
    </LandingDialog>
  );
}

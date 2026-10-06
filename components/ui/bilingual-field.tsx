"use client";

import type { ChangeEvent } from "react";
import { FieldErrorText } from "@/components/ui/field-error-text";
import type { FieldErrors } from "@/lib/shared/hooks/useFieldErrors";
import { ENGLISH_BACKFILL_HINT } from "@/lib/shared/staff-translation";
import styles from "./bilingual-field.module.css";

export type BilingualLang = "fr" | "en";

type BilingualFieldProps<F extends string> = {
  /** Intitulé du champ (staff, en français — l'administration n'est pas traduite, D4). */
  label: string;
  /** `id` des deux contrôles : c'est sur eux que `useFieldErrors` pose ses attributs et ramène le focus. */
  ids: Readonly<Record<BilingualLang, string>>;
  /** Clés de champ des deux contrôles dans le `useFieldErrors` du formulaire. */
  fields: Readonly<Record<BilingualLang, F>>;
  errors: FieldErrors<F>;
  values: Readonly<Record<BilingualLang, string>>;
  onChange: (lang: BilingualLang, value: string) => void;
  maxLength: number;
  multiline?: boolean;
  rows?: number;
  placeholders?: Partial<Record<BilingualLang, string>>;
  /** Le français est-il obligatoire ? (l'anglais l'est dès que le français est saisi). */
  required?: boolean;
  /**
   * Contenu déjà en ligne sans anglais (écrit avant le lot 5b) : l'aide du
   * rattrapage paraît sous le champ anglais.
   */
  enMissing?: boolean;
  inputClassName?: string;
  labelClassName?: string;
  /** `id` d'une `<datalist>` de suggestions pour le champ français. */
  listFr?: string;
};

/**
 * Un texte saisi par le staff, en français **et** en anglais côte à côte —
 * l'anglais obligatoire (D9), comme dans l'éditeur des textes de la vitrine
 * (`EditableCopy`). Un refus du serveur ou du contrôle d'avant l'envoi est
 * rattaché à son champ par le `useFieldErrors` du formulaire (`aria-invalid`,
 * phrase en `aria-describedby`, focus ramené) : `ACCESSIBILITY_FORM_ERRORS_STATEMENT.md`.
 */
export function BilingualField<F extends string>({
  label,
  ids,
  fields,
  errors,
  values,
  onChange,
  maxLength,
  multiline = false,
  rows = 4,
  placeholders,
  required = true,
  enMissing = false,
  inputClassName,
  labelClassName,
  listFr,
}: Readonly<BilingualFieldProps<F>>) {
  const hintId = `${ids.en}-hint`;
  const enRequired = required || values.fr.trim().length > 0;

  const control = (lang: BilingualLang) => {
    const common = {
      id: ids[lang],
      className: inputClassName,
      value: values[lang],
      lang,
      maxLength,
      placeholder: placeholders?.[lang],
      required: lang === "fr" ? required : enRequired,
      ...errors.aria(fields[lang], lang === "en" && enMissing && hintId),
      onChange: (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        errors.clear(fields[lang]);
        onChange(lang, e.target.value);
      },
    };
    return multiline ? (
      <textarea {...common} rows={rows} />
    ) : (
      <input {...common} list={lang === "fr" ? listFr : undefined} />
    );
  };

  return (
    <fieldset className={styles.pair}>
      <legend className={labelClassName}>{label}</legend>
      <div className={styles.columns}>
        <div className={styles.column}>
          <label className={styles.lang} htmlFor={ids.fr}>
            {required ? "Français (obligatoire)" : "Français"}
          </label>
          {control("fr")}
          <FieldErrorText fieldId={ids.fr} message={errors.message(fields.fr)} />
        </div>
        <div className={styles.column}>
          <label className={styles.lang} htmlFor={ids.en}>
            {required ? "Anglais (obligatoire)" : "Anglais (obligatoire si le français est saisi)"}
          </label>
          {control("en")}
          {enMissing && (
            <span id={hintId} className={styles.hint}>
              {ENGLISH_BACKFILL_HINT}
            </span>
          )}
          <FieldErrorText fieldId={ids.en} message={errors.message(fields.en)} />
        </div>
      </div>
    </fieldset>
  );
}

/**
 * Marque **EN** d'un contenu déjà en ligne sans anglais, sur son bouton
 * d'édition (staff) : il manque à la page anglaise jusqu'à ce qu'on le traduise.
 * Le bouton qui la porte ajoute « (EN à rédiger) » à son nom accessible
 * ({@link withEnglishMissing}).
 */
export function EnglishMissingMark() {
  return (
    <span className={styles.missing} aria-hidden="true">
      EN
    </span>
  );
}

/** Nom accessible d'un bouton d'édition dont le contenu attend son anglais. */
export function withEnglishMissing(label: string, missing: boolean): string {
  return missing ? `${label} (EN à rédiger)` : label;
}

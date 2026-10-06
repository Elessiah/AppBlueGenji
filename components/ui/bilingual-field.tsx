"use client";

import type { ChangeEvent, KeyboardEvent } from "react";
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
  /** `id` d'une aide commune aux deux langues (rendue par l'appelant), lue avec chaque contrôle. */
  describedBy?: string;
  /** Affiche « n / max » sous chaque langue, rattaché à son contrôle. */
  counter?: boolean;
  /** Classe de plus du compteur selon la longueur saisie (ex. alerte près du plafond). */
  counterClassName?: (length: number) => string | undefined;
  /** Touche « Entrée » du clavier virtuel (champ d'une ligne seulement). */
  enterKeyHint?: "next" | "done";
  /**
   * Champ d'une ligne : Entrée dans le français passe à l'anglais, Entrée dans
   * l'anglais appelle `onEnter` (enregistrer le formulaire).
   */
  onEnter?: () => void;
};

/** Avec `onEnter` : le français mène à l'anglais, l'anglais enregistre. */
const ENTER_KEY_HINTS: Readonly<Record<BilingualLang, "next" | "done">> = { fr: "next", en: "done" };

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
  describedBy,
  counter = false,
  counterClassName,
  enterKeyHint,
  onEnter,
}: Readonly<BilingualFieldProps<F>>) {
  const hintId = `${ids.en}-hint`;
  // L'aide du rattrapage se tait dès que l'anglais est saisi.
  const showHint = enMissing && values.en.trim().length === 0;
  const enRequired = required || values.fr.trim().length > 0;
  const counterId = (lang: BilingualLang) => `${ids[lang]}-count`;
  const counterText = (lang: BilingualLang) =>
    counter && (
      <span
        id={counterId(lang)}
        className={[styles.counter, counterClassName?.(values[lang].length)].filter(Boolean).join(" ")}
      >
        {values[lang].length} / {maxLength}
      </span>
    );

  const control = (lang: BilingualLang) => {
    const common = {
      id: ids[lang],
      className: inputClassName,
      value: values[lang],
      lang,
      maxLength,
      placeholder: placeholders?.[lang],
      required: lang === "fr" ? required : enRequired,
      ...errors.aria(
        fields[lang],
        describedBy,
        counter && counterId(lang),
        lang === "en" && showHint && hintId,
      ),
      onChange: (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        errors.clear(fields[lang]);
        onChange(lang, e.target.value);
      },
    };
    return multiline ? (
      <textarea {...common} rows={rows} />
    ) : (
      <input
        {...common}
        list={lang === "fr" ? listFr : undefined}
        enterKeyHint={onEnter ? ENTER_KEY_HINTS[lang] : enterKeyHint}
        onKeyDown={
          onEnter
            ? (e: KeyboardEvent<HTMLInputElement>) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                if (lang === "fr") document.getElementById(ids.en)?.focus();
                else onEnter();
              }
            : undefined
        }
      />
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
          {counterText("fr")}
          <FieldErrorText fieldId={ids.fr} message={errors.message(fields.fr)} />
        </div>
        <div className={styles.column}>
          <label className={styles.lang} htmlFor={ids.en}>
            {required ? "Anglais (obligatoire)" : "Anglais (obligatoire si le français est saisi)"}
          </label>
          {control("en")}
          {counterText("en")}
          {showHint && (
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

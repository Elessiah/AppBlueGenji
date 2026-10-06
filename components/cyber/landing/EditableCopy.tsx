"use client";

import { createContext, useContext, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { focusOnMount } from "@/lib/shared/focus-on-mount";
import { useToast } from "@/components/ui/toast";
import { FieldErrorText } from "@/components/ui/field-error-text";
import { useAppLocale } from "@/components/i18n/locale-context";
import { useFieldErrors } from "@/lib/shared/hooks/useFieldErrors";
import {
  SITE_COPY_ERROR_MESSAGES,
  SITE_COPY_FIELD_ERRORS,
  siteCopyErrorMessage,
  siteCopyField,
  type SiteCopyEditorEntry,
  type SiteCopyKey,
} from "@/lib/shared/site-copy";
import styles from "./EditableCopy.module.css";

/**
 * Ce que l'éditeur reprend pour chaque texte (`SiteCopyBundle.editor`) : le
 * français, l'anglais, et l'anglais encore à rédiger. Posé par la page, pour
 * les seuls porteurs de `showcase` — un visiteur ne reçoit rien de plus.
 */
const SiteCopyEditorContext = createContext<Partial<Record<SiteCopyKey, SiteCopyEditorEntry>> | null>(null);

export function SiteCopyEditorProvider({
  entries,
  children,
}: Readonly<{ entries: Record<SiteCopyKey, SiteCopyEditorEntry> | null; children: ReactNode }>) {
  return <SiteCopyEditorContext.Provider value={entries}>{children}</SiteCopyEditorContext.Provider>;
}

interface EditableCopyProps {
  copyKey: SiteCopyKey;
  /** Texte affiché (dans la langue de la page). */
  value: string;
  /** Vrai pour les porteurs de la permission `showcase`. */
  canEdit: boolean;
  /**
   * Élément de rendu du texte. Le composant n'impose aucun style : il se
   * contente d'ajouter le bouton d'édition à côté du contenu existant.
   */
  children: React.ReactNode;
}

type CopyLang = "fr" | "en";

export type SiteCopySubmitOutcome = { ok: true } | { ok: false; code: string; fallback: string };

/**
 * Envoi d'une édition bilingue. Un anglais vide est refusé **avant** l'envoi
 * (`COPY_EN_EMPTY`, comme le serveur) ; un refus du serveur rend son code ; un
 * échec réseau, aucun code (aucun champ n'y peut rien).
 */
export async function submitSiteCopy(
  fetcher: typeof fetch,
  key: SiteCopyKey,
  fr: string,
  en: string,
): Promise<SiteCopySubmitOutcome> {
  if (en.trim().length === 0) {
    return { ok: false, code: "COPY_EN_EMPTY", fallback: SITE_COPY_ERROR_MESSAGES.COPY_EN_EMPTY };
  }
  try {
    const res = await fetcher("/api/site-copy", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key, value: fr, valueEn: en }),
    });
    if (res.ok) return { ok: true };
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, code: payload.error ?? "", fallback: "Échec de l'enregistrement." };
  } catch {
    return { ok: false, code: "", fallback: "Erreur réseau, réessaye." };
  }
}

/**
 * Texte de la vitrine éditable en place par le staff `showcase`.
 *
 * Hors édition, le rendu est **exactement** celui du texte (aucun wrapper
 * visuel pour un visiteur). Pour un éditeur, un bouton « ✎ » discret ouvre
 * l'éditeur **bilingue** : français et anglais côte à côte, l'anglais
 * obligatoire (D9) — refusé sans lui, le refus rattaché au champ anglais. Un
 * français édité avant que l'anglais ne soit demandé porte la marque « EN » sur
 * son crayon : sa traduction reste à écrire. L'enregistrement rafraîchit la page
 * serveur pour que tout autre endroit affichant ce texte suive.
 *
 * L'administration reste en français (D4) : sous `/en`, l'éditeur porte
 * `lang="fr"`.
 */
export function EditableCopy({ copyKey, value, canEdit, children }: Readonly<EditableCopyProps>) {
  const router = useRouter();
  const locale = useAppLocale();
  const { showError, showSuccess } = useToast();
  const entries = useContext(SiteCopyEditorContext);
  const entry: SiteCopyEditorEntry = entries?.[copyKey] ?? { fr: value, en: "", enMissing: false };
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(entry.fr);
  const [draftEn, setDraftEn] = useState(entry.en);
  const [busy, setBusy] = useState(false);
  const ids: Record<CopyLang, string> = { fr: `copy-${copyKey}`, en: `copy-${copyKey}-en` };
  const fieldErrors = useFieldErrors(SITE_COPY_FIELD_ERRORS, ids);
  // L'éditeur remplace le texte : à sa fermeture, le focus revient au crayon
  // au lieu de retomber en haut de page.
  const returnFocus = useRef(false);
  const closeEditor = () => {
    fieldErrors.clear();
    returnFocus.current = true;
    setEditing(false);
  };

  const field = siteCopyField(copyKey);
  const label = field?.label ?? copyKey;
  const staffLang = locale === "fr" ? undefined : "fr";

  if (!canEdit) return <>{children}</>;

  const refuse = (code: string, fallback: string) => {
    const message = siteCopyErrorMessage(code, fallback);
    fieldErrors.report(code, message);
    showError(message, staffLang ? { lang: staffLang } : undefined);
  };

  const save = async () => {
    setBusy(true);
    try {
      const outcome = await submitSiteCopy(fetch, copyKey, draft, draftEn);
      if (!outcome.ok) {
        refuse(outcome.code, outcome.fallback);
        return;
      }
      showSuccess("Texte mis à jour.", staffLang ? { lang: staffLang } : undefined);
      closeEditor();
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/site-copy?key=${encodeURIComponent(copyKey)}`, {
        method: "DELETE",
      });
      const payload = (await res.json()) as { error?: string };
      if (!res.ok) {
        refuse(payload.error ?? "", "Échec de la remise à l'origine.");
        return;
      }
      showSuccess("Texte d'origine rétabli.", staffLang ? { lang: staffLang } : undefined);
      closeEditor();
      router.refresh();
    } catch {
      refuse("", "Erreur réseau, réessaye.");
    } finally {
      setBusy(false);
    }
  };

  if (editing) {
    const rows = (text: string) => Math.min(8, Math.max(3, text.split("\n").length + 1));
    const control = (lang: CopyLang) => {
      const text = lang === "fr" ? draft : draftEn;
      const onChange = (next: string) => {
        fieldErrors.clear(lang);
        if (lang === "fr") setDraft(next);
        else setDraftEn(next);
      };
      const common = {
        id: ids[lang],
        className: styles.input,
        value: text,
        lang,
        maxLength: field?.maxLength,
        required: true,
        ...fieldErrors.aria(lang, lang === "en" && entry.enMissing && `${ids.en}-hint`),
        ref: lang === "fr" ? focusOnMount : undefined,
      };
      return field?.multiline ? (
        <textarea {...common} rows={rows(text)} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input {...common} onChange={(e) => onChange(e.target.value)} />
      );
    };

    return (
      <fieldset className={styles.editor} lang={staffLang}>
        <legend className={styles.label}>{label}</legend>
        <div className={styles.columns}>
          <div className={styles.column}>
            <label className={styles.langLabel} htmlFor={ids.fr}>
              Français
            </label>
            {control("fr")}
            <FieldErrorText fieldId={ids.fr} message={fieldErrors.message("fr")} />
          </div>
          <div className={styles.column}>
            <label className={styles.langLabel} htmlFor={ids.en}>
              Anglais (obligatoire)
            </label>
            {control("en")}
            {entry.enMissing && (
              <span id={`${ids.en}-hint`} className={styles.hint}>
                Français modifié avant la traduction du site : la page anglaise montre encore l&apos;anglais
                d&apos;origine. Traduis le texte ci-contre.
              </span>
            )}
            <FieldErrorText fieldId={ids.en} message={fieldErrors.message("en")} />
          </div>
        </div>
        <div className={styles.actions}>
          <button type="button" className="btn ghost" onClick={reset} disabled={busy}>
            Rétablir l&apos;original
          </button>
          <span className={styles.spacer} />
          <button
            type="button"
            className="btn ghost"
            onClick={() => {
              setDraft(entry.fr);
              setDraftEn(entry.en);
              closeEditor();
            }}
            disabled={busy}
          >
            Annuler
          </button>
          <button type="button" className="btn" onClick={save} disabled={busy}>
            {busy ? "Enregistrement…" : "Enregistrer"}
          </button>
        </div>
      </fieldset>
    );
  }

  const pencilLabel = entry.enMissing ? `Modifier : ${label} (EN à rédiger)` : `Modifier : ${label}`;

  return (
    <span className={styles.wrap}>
      {children}
      <button
        type="button"
        className={entry.enMissing ? `${styles.pencil} ${styles.pencilMissing}` : styles.pencil}
        lang={staffLang}
        ref={(el) => {
          if (el && returnFocus.current) {
            returnFocus.current = false;
            el.focus();
          }
        }}
        aria-label={pencilLabel}
        title={pencilLabel}
        onClick={() => {
          setDraft(entry.fr);
          setDraftEn(entry.en);
          setEditing(true);
        }}
      >
        ✎{entry.enMissing && <span className={styles.missing}>EN</span>}
      </button>
    </span>
  );
}

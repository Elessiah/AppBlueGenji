"use client";

import { Copy } from "lucide-react";
import { useAppLocale } from "@/components/i18n/locale-context";
import { useToast } from "@/components/ui/toast";
import { getiText } from "@/lib/shared/geti/page-text";
import styles from "./geti.module.css";

type CopyText = { copy: string; copyLabel: string; copied: string; copyFailed: string; tagLabel: string };

/** Copie par l'ancienne voie (`execCommand`), pour un navigateur sans presse-papiers asynchrone. */
function legacyCopy(value: string): boolean {
  const area = document.createElement("textarea");
  area.value = value;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  let done = false;
  try {
    done = document.execCommand("copy"); // NOSONAR typescript:S1874 — repli voulu quand `navigator.clipboard` manque
  } catch {
    done = false;
  }
  area.remove();
  return done;
}

async function copyText(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Presse-papiers refusé (permission, contexte non sûr) : on tente l'ancienne voie.
  }
  return legacyCopy(value);
}

/**
 * Pseudo Discord de l'auteur et son bouton « Copier » : un clic, une
 * notification. Le pseudo reste un texte sélectionnable, pour qui ne peut pas
 * copier autrement.
 */
export function GetiCopyTag({ tag, text }: Readonly<{ tag: string; text: CopyText }>) {
  const locale = useAppLocale();
  const { showSuccess, showError } = useToast();

  const copy = async () => {
    if (await copyText(tag)) showSuccess(getiText(locale, text.copied, { tag }));
    else showError(text.copyFailed);
  };

  return (
    <>
      <span className={styles.tag} title={text.tagLabel} data-testid="geti-tag">
        <span className="sr-only">{text.tagLabel} : </span>
        {tag}
      </span>
      <button
        type="button"
        className={styles.copy}
        onClick={() => void copy()}
        aria-label={getiText(locale, text.copyLabel, { tag })}
      >
        <Copy size={13} aria-hidden="true" />
        {text.copy}
      </button>
    </>
  );
}

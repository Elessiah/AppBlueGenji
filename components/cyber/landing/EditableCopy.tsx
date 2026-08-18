"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";
import { siteCopyField, type SiteCopyKey } from "@/lib/shared/site-copy";
import styles from "./EditableCopy.module.css";

interface EditableCopyProps {
  copyKey: SiteCopyKey;
  value: string;
  /** Vrai pour les porteurs de la permission `showcase`. */
  canEdit: boolean;
  /**
   * Élément de rendu du texte. Le composant n'impose aucun style : il se
   * contente d'ajouter le bouton d'édition à côté du contenu existant.
   */
  children: React.ReactNode;
}

/**
 * Texte de la vitrine éditable en place par le staff `showcase`.
 *
 * Hors édition, le rendu est **exactement** celui du texte (aucun wrapper
 * visuel pour un visiteur). Pour un éditeur, un bouton « ✎ » discret ouvre une
 * zone de saisie ; l'enregistrement rafraîchit la page serveur pour que tout
 * autre endroit affichant ce texte suive.
 */
export function EditableCopy({ copyKey, value, canEdit, children }: EditableCopyProps) {
  const router = useRouter();
  const { showError, showSuccess } = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [busy, setBusy] = useState(false);

  const field = siteCopyField(copyKey);

  if (!canEdit) return <>{children}</>;

  const save = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/site-copy", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key: copyKey, value: draft }),
      });
      const payload = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(payload.error || "SITE_COPY_UPDATE_FAILED");
      showSuccess("Texte mis à jour.");
      setEditing(false);
      router.refresh();
    } catch (e) {
      showError((e as Error).message);
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
      if (!res.ok) throw new Error(payload.error || "SITE_COPY_RESET_FAILED");
      showSuccess("Texte d'origine rétabli.");
      setEditing(false);
      router.refresh();
    } catch (e) {
      showError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (editing) {
    return (
      <div className={styles.editor}>
        <label className={styles.label} htmlFor={`copy-${copyKey}`}>
          {field?.label ?? copyKey}
        </label>
        {field?.multiline ? (
          <textarea
            id={`copy-${copyKey}`}
            className={styles.input}
            value={draft}
            maxLength={field.maxLength}
            rows={Math.min(8, Math.max(3, draft.split("\n").length + 1))}
            onChange={(e) => setDraft(e.target.value)}
            autoFocus
          />
        ) : (
          <input
            id={`copy-${copyKey}`}
            className={styles.input}
            value={draft}
            maxLength={field?.maxLength}
            onChange={(e) => setDraft(e.target.value)}
            autoFocus
          />
        )}
        <div className={styles.actions}>
          <button type="button" className="btn ghost" onClick={reset} disabled={busy}>
            Rétablir l&apos;original
          </button>
          <span className={styles.spacer} />
          <button
            type="button"
            className="btn ghost"
            onClick={() => {
              setDraft(value);
              setEditing(false);
            }}
            disabled={busy}
          >
            Annuler
          </button>
          <button type="button" className="btn" onClick={save} disabled={busy}>
            {busy ? "Enregistrement…" : "Enregistrer"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <span className={styles.wrap}>
      {children}
      <button
        type="button"
        className={styles.pencil}
        aria-label={`Modifier : ${field?.label ?? copyKey}`}
        title={`Modifier : ${field?.label ?? copyKey}`}
        onClick={() => {
          setDraft(value);
          setEditing(true);
        }}
      >
        ✎
      </button>
    </span>
  );
}

"use client";

import { FormEvent, ReactNode, useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { useBackdropDismiss } from "@/lib/shared/hooks/useBackdropDismiss";
import { useDialogBehavior } from "@/lib/shared/hooks/useDialogBehavior";
import { richNodes, useShellText } from "@/components/i18n/shell-text";
import styles from "./confirm-action-dialog.module.css";

export interface ConfirmActionDialogProps {
  title: string;
  /** Ce que le geste entraîne — lu à l'ouverture, avant les boutons. */
  children: ReactNode;
  confirmLabel: string;
  pendingLabel: string;
  /**
   * Ton du bouton de confirmation. `danger` (défaut) pour un geste qui retire
   * ou sanctionne ; `primary` pour un engagement, comme l'inscription, qui ne
   * se défait pas seul mais n'est pas une perte.
   */
  tone?: "danger" | "primary";
  /**
   * Texte à recopier pour armer le bouton — réservé aux gestes sans retour
   * (dissoudre une équipe), comme la suppression d'un tournoi.
   */
  requireText?: string;
  /** Désarme le bouton tant qu'un champ requis du contenu n'est pas rempli. */
  disabled?: boolean;
  /**
   * `true` (défaut) : la modale se referme d'elle-même quand `onConfirm` rend
   * `true`. `false` : l'appelant la démonte lui-même (navigation, rechargement
   * des données) et le bouton reste « en cours » jusque-là.
   */
  closeOnSuccess?: boolean;
  /**
   * Le focus d'ouverture va au premier champ du contenu (motif de modération à
   * saisir) plutôt qu'à « Annuler ».
   */
  focusContent?: boolean;
  onClose: () => void;
  /**
   * Exécute le geste. Rend `true` s'il a abouti : la modale ne se ferme qu'alors,
   * un refus la laisse ouverte pour qu'on puisse réessayer ou renoncer.
   */
  onConfirm: () => Promise<boolean>;
}

/**
 * Joue le geste confirmé : bouton « en cours » pendant le vol, réarmé sur un
 * refus (`false` ou exception) qui laisse la modale ouverte, fermeture sur un
 * succès sauf `closeOnSuccess: false`. Rend l'issue.
 */
export async function runConfirmation({
  onConfirm,
  onClose,
  setBusy,
  closeOnSuccess,
}: Readonly<{
  onConfirm: () => Promise<boolean>;
  onClose: () => void;
  setBusy: (busy: boolean) => void;
  closeOnSuccess: boolean;
}>): Promise<boolean> {
  setBusy(true);
  let ok = false;
  try {
    ok = await onConfirm();
  } finally {
    if (!ok) setBusy(false);
  }
  if (ok && closeOnSuccess) onClose();
  return ok;
}

/**
 * Confirmation commune de tous les gestes sans retour du site — fiche tournoi,
 * fiche d'équipe, modération d'un joueur, contenus publiés (bureau, bénévoles,
 * annonces, cartes « À propos », partenaires), profil, rôles de plateforme.
 * Remplace `window.confirm` (interdit, garde ESLint) : une boîte système qu'un
 * Entrée réflexe valide, dans le style du navigateur, que certains bloquent
 * après deux ouvertures.
 *
 * Portail sur `document.body`, `useDialogBehavior`, voile fermé par
 * `useBackdropDismiss`, et **rien de verrouillé tant que le geste est en vol**
 * (le focus reste piégé, Échap et le voile ne ferment pas).
 *
 * Le focus s'ouvre sur « Annuler » (`data-autofocus`) : un Entrée réflexe ne
 * doit pas valider un geste qui ne se défait pas — sauf quand un texte est à
 * recopier (il va au champ) ou que le contenu porte un champ (`focusContent`).
 */
export function ConfirmActionDialog({
  title,
  children,
  confirmLabel,
  pendingLabel,
  tone = "danger",
  requireText,
  disabled = false,
  closeOnSuccess = true,
  focusContent = false,
  onClose,
  onConfirm,
}: Readonly<ConfirmActionDialogProps>) {
  const { t, rich } = useShellText();
  const titleId = useId();
  const bodyId = useId();
  const inputId = useId();
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const dialogRef = useDialogBehavior({ open: mounted, onClose, locked: busy });
  const backdrop = useBackdropDismiss(onClose, busy);
  const armed = !disabled && (requireText === undefined || typed.trim() === requireText.trim());

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (busy || !armed) return;
    void runConfirmation({ onConfirm, onClose, setBusy, closeOnSuccess });
  };

  if (!mounted) return null;

  return createPortal(
    <div /* NOSONAR S6819 — voile de modale, sans équivalent natif */ role="presentation" className={styles.backdrop} {...backdrop}>
      <div /* NOSONAR S6819 — modale portée dans body (useDialogBehavior) : `<dialog>` changerait couche, Échap et ::backdrop */
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        // Un contenu à remplir (motif, listes) se lit champ par champ, pas d'un bloc.
        aria-describedby={focusContent ? undefined : bodyId}
        tabIndex={-1}
        className={styles.dialog}
      >
        <h3 id={titleId} className={styles.title}>
          {title}
        </h3>
        <form onSubmit={submit}>
          <div id={bodyId} className={styles.body}>
            {children}
          </div>
          {requireText === undefined ? null : (
            <div className={`field ${styles.confirmField}`}>
              <label htmlFor={inputId}>
                {richNodes(
                  rich("confirmDialog.typeToConfirm", { text: requireText }, {
                    strong: (children) => <strong>{children}</strong>,
                  }),
                )}
              </label>
              <input
                id={inputId}
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                data-autofocus
              />
            </div>
          )}
          <div className={styles.actions}>
            <button
              type="button"
              className="btn ghost"
              onClick={onClose}
              disabled={busy}
              data-autofocus={requireText === undefined && !focusContent ? true : undefined}
            >
              {t("confirmDialog.cancel")}
            </button>
            <button type="submit" className={tone === "danger" ? "btn danger" : "btn"} disabled={busy || !armed}>
              {busy ? pendingLabel : confirmLabel}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}

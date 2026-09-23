"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CyberButton, ScrollArea } from "@/components/cyber";
import { useToast } from "@/components/ui/toast";
import { useDialogBehavior } from "@/lib/shared/hooks/useDialogBehavior";
import {
  RETENTION_UNKNOWN,
  accountDeletionConfirmation,
  accountDeletionErrorMessage,
  accountDeletionOutcome,
  type AccountDeletionPlan,
  type ConfirmationSubject,
} from "@/lib/shared/account-deletion";
import {
  formatPrivacyChangeDate,
  privacyChangesHeading,
  type PrivacyChange,
} from "@/lib/shared/privacy-changes";
import styles from "./PrivacyChangesModal.module.css";

type Step = "REVIEW" | "CONFIRM_DELETE";

/**
 * Présente à un compte connecté les changements du traitement de ses données
 * qu'il n'a pas encore acceptés (`lib/shared/privacy-changes.ts`), **tous à la
 * fois** : un joueur revenu après trois changements les lit ici tous les trois.
 *
 * Deux issues, et aucune autre :
 *
 * - **« J'accepte »** enregistre les changements *montrés* — leurs identifiants
 *   voyagent dans la requête, pas « tout ce qui est dû » ;
 * - **« Je refuse, je supprime mon compte »** ouvre une seconde étape qui dit ce
 *   que la suppression va faire (même aperçu et mêmes phrases que `/profil`) et
 *   exige une confirmation explicite. Refuser le traitement, c'est ne plus avoir
 *   de compte : le site ne peut pas fonctionner sans les données décrites.
 *
 * La modale ne se ferme **ni par Échap ni par un clic à côté** : Échap ramène
 * seulement de la confirmation à la lecture. Ne rien choisir la laisse revenir
 * au chargement suivant — c'est ce que veut dire « une seule fois » : jusqu'à
 * ce que le joueur ait répondu.
 *
 * Rendue par la mise en page racine, côté serveur : la liste est dans le HTML
 * initial, sans aller-retour ni clignotement.
 */
export function PrivacyChangesModal({ changes }: { changes: PrivacyChange[] }) {
  const { showError, showSuccess } = useToast();
  const [answered, setAnswered] = useState(false);
  const [step, setStep] = useState<Step>("REVIEW");
  const [busy, setBusy] = useState(false);
  const [subject, setSubject] = useState<ConfirmationSubject>(RETENTION_UNKNOWN);

  const open = changes.length > 0 && !answered;
  const dialogRef = useDialogBehavior({
    open,
    onClose: () => {
      if (step === "CONFIRM_DELETE") setStep("REVIEW");
    },
    locked: busy,
  });

  // Changer d'étape remplace les boutons sous le focus : on le repose sur le
  // premier bouton de l'étape (« Retour » à la confirmation — le geste sûr).
  useEffect(() => {
    if (!open) return;
    dialogRef.current?.querySelector<HTMLElement>("button")?.focus();
    // `dialogRef` est stable ; seul le changement d'étape compte.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  if (!open) return null;

  const accept = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const response = await fetch("/api/profile/privacy-changes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ changeIds: changes.map((change) => change.id) }),
      });
      if (!response.ok) throw new Error();
      setAnswered(true);
      showSuccess("Merci, ton choix est enregistré.");
    } catch {
      showError("Ton acceptation n'a pas pu être enregistrée. Réessaie dans un instant.");
    } finally {
      setBusy(false);
    }
  };

  // L'aperçu est demandé en passant à la confirmation, comme sur `/profil` :
  // « effacé » et « anonymisé » ne sont pas la même promesse. Injoignable, la
  // phrase reste celle qui ne promet ni l'un ni l'autre.
  const askDeletion = async () => {
    if (busy) return;
    setBusy(true);
    setSubject(RETENTION_UNKNOWN);
    setStep("CONFIRM_DELETE");
    try {
      const preview = await fetch("/api/profile/deletion", { cache: "no-store" });
      if (preview.ok) setSubject(((await preview.json()) as AccountDeletionPlan).reason);
    } catch {
      // Phrase prudente conservée.
    } finally {
      setBusy(false);
    }
  };

  const deleteAccount = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const response = await fetch("/api/profile", { method: "DELETE" });
      const payload = (await response.json()) as { error?: string } & Partial<AccountDeletionPlan>;
      if (!response.ok) throw new Error(accountDeletionErrorMessage(payload.error));
      showSuccess(accountDeletionOutcome(payload.mode ? payload.reason ?? null : subject));
      setAnswered(true);
      setTimeout(() => {
        window.location.href = "/";
      }, 1200);
    } catch (error) {
      showError((error as Error).message);
      setBusy(false);
    }
  };

  const heading = privacyChangesHeading(changes.length);

  return (
    <div className={styles.overlay} role="presentation">
      <div
        ref={dialogRef}
        className={styles.modal}
        role={step === "CONFIRM_DELETE" ? "alertdialog" : "dialog"}
        aria-modal="true"
        aria-labelledby="privacy-changes-title"
        aria-describedby="privacy-changes-intro"
        aria-busy={busy}
        tabIndex={-1}
      >
        {step === "REVIEW" ? (
          <>
            <span className="eyebrow">PROTECTION DES DONNÉES · RGPD</span>
            <h2 id="privacy-changes-title" className={styles.title}>
              {heading}
            </h2>
            <p id="privacy-changes-intro" className={styles.intro}>
              {changes.length > 1
                ? "Depuis ta dernière visite, la façon dont BlueGenji traite tes données a changé. Lis-les avant de continuer : tu pourras les accepter, ou refuser et supprimer ton compte."
                : "La façon dont BlueGenji traite tes données a changé. Lis ce changement avant de continuer : tu pourras l'accepter, ou refuser et supprimer ton compte."}
            </p>

            <ScrollArea orientation="y" className={styles.changes} ariaLabel="Détail des changements">
              <ol className={styles.changeList}>
                {changes.map((change) => (
                  <li key={change.id} className={styles.change}>
                    <div className={styles.changeHead}>
                      <h3 className={styles.changeTitle}>{change.title}</h3>
                      <time className={styles.changeDate} dateTime={change.publishedAt}>
                        {formatPrivacyChangeDate(change.publishedAt)}
                      </time>
                    </div>
                    <p className={styles.changeSummary}>{change.summary}</p>
                    {change.details.length > 0 && (
                      <ul className={styles.changeDetails}>
                        {change.details.map((detail, index) => (
                          <li key={index}>{detail}</li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ol>
            </ScrollArea>

            <p className={styles.policyLink}>
              Politique complète :{" "}
              <Link href="/rgpd" target="_blank" rel="noreferrer">
                politique de confidentialité
              </Link>
              .
            </p>

            <div className={styles.actions}>
              <button type="button" className={styles.refuse} onClick={askDeletion} disabled={busy}>
                Je refuse, je supprime mon compte
              </button>
              <CyberButton variant="primary" type="button" onClick={accept} disabled={busy}>
                {busy ? "Enregistrement…" : "J'accepte"}
              </CyberButton>
            </div>
          </>
        ) : (
          <>
            <span className={`eyebrow ${styles.dangerEyebrow}`}>SUPPRESSION DÉFINITIVE</span>
            <h2 id="privacy-changes-title" className={styles.title}>
              Supprimer ton compte ?
            </h2>
            <div id="privacy-changes-intro" className={styles.warning}>
              <p>{accountDeletionConfirmation(subject)}</p>
              <p>
                Tu seras déconnecté, et aucun retour en arrière ne sera possible : ni nous ni
                toi ne pourrons récupérer le compte. Si tu veux garder une copie de tes données,{" "}
                {/* Le lien télécharge directement : `/profil` serait couvert par
                    cette même modale, et son bouton d'export inatteignable. */}
                <a href="/api/profile/export" download>
                  télécharge-les d&apos;abord
                </a>
                .
              </p>
            </div>
            <div className={styles.actions}>
              <CyberButton variant="ghost" type="button" onClick={() => setStep("REVIEW")} disabled={busy}>
                Retour
              </CyberButton>
              <button type="button" className={styles.confirmDelete} onClick={deleteAccount} disabled={busy}>
                {busy ? "Patiente…" : "Supprimer définitivement mon compte"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

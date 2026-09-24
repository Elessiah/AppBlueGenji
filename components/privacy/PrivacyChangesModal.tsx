"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
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
  PRIVACY_CHANGES_ANSWERED_EVENT,
  privacyChangesHeading,
  type PrivacyChange,
} from "@/lib/shared/privacy-changes";
import styles from "./PrivacyChangesModal.module.css";

type Step = "REVIEW" | "CONFIRM_DELETE";

/**
 * Seule page où la modale se tait : elle y couvrirait la politique qu'elle
 * invite à lire. Décidé **ici**, au rendu client, et non par la mise en page :
 * celle-ci n'est pas re-rendue d'un lien à l'autre, si bien qu'un silence
 * décidé côté serveur sur `/rgpd` aurait suivi le joueur sur tout le site.
 */
export const PRIVACY_POLICY_PATH = "/rgpd";

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
  // Chargement de l'aperçu, distinct de `busy` : « Retour » doit rester
  // atteignable (et focalisable) pendant qu'on demande au serveur ce que la
  // suppression ferait — seul le bouton de confirmation attend la réponse.
  const [previewing, setPreviewing] = useState(false);
  const [subject, setSubject] = useState<ConfirmationSubject>(RETENTION_UNKNOWN);

  const pathname = usePathname();
  const open = changes.length > 0 && !answered && pathname !== PRIVACY_POLICY_PATH;
  const dialogRef = useDialogBehavior({
    open,
    onClose: () => {
      if (step === "CONFIRM_DELETE") setStep("REVIEW");
    },
    locked: busy,
  });

  // Changer d'étape remplace les boutons sous le focus : on le repose sur le
  // geste **sûr** de l'étape — « Retour » à la confirmation, la liste des
  // changements au retour en lecture, jamais le bouton de refus. Rien au
  // montage : `useDialogBehavior` y a déjà placé le focus sur la liste, et le
  // premier bouton de la lecture est justement celui qui mène à la suppression.
  const mountedStep = useRef(step);
  useEffect(() => {
    if (!open || mountedStep.current === step) return;
    mountedStep.current = step;
    const dialog = dialogRef.current;
    const target =
      step === "CONFIRM_DELETE"
        ? dialog?.querySelector<HTMLElement>("button")
        : dialog?.querySelector<HTMLElement>('[role="region"]');
    (target ?? dialog)?.focus();
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
      window.dispatchEvent(new Event(PRIVACY_CHANGES_ANSWERED_EVENT));
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
    if (busy || previewing) return;
    setPreviewing(true);
    setSubject(RETENTION_UNKNOWN);
    setStep("CONFIRM_DELETE");
    try {
      const preview = await fetch("/api/profile/deletion", { cache: "no-store" });
      if (preview.ok) setSubject(((await preview.json()) as AccountDeletionPlan).reason);
    } catch {
      // Phrase prudente conservée.
    } finally {
      setPreviewing(false);
    }
  };

  const deleteAccount = async () => {
    if (busy || previewing) return;
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
        aria-busy={busy || previewing}
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
              <button type="button" className={styles.refuse} onClick={askDeletion} disabled={busy || previewing}>
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
              <button
                type="button"
                className={styles.confirmDelete}
                onClick={deleteAccount}
                disabled={busy || previewing}
              >
                {busy ? "Suppression…" : "Supprimer définitivement mon compte"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

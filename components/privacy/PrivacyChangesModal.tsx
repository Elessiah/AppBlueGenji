"use client";

import { useRef, useState } from "react";
import { LocaleLink, useLocalePathname } from "@/components/i18n/locale-navigation";
import { richNodes, useShellText } from "@/components/i18n/shell-text";
import { CyberButton, ScrollArea } from "@/components/cyber";
import { EnglishLegalText } from "@/components/legal/EnglishLegalText";
import { useToast } from "@/components/ui/toast";
import { useDialogBehavior } from "@/lib/shared/hooks/useDialogBehavior";
import {
  formatPrivacyChangeDateIn,
  PRIVACY_CHANGES_ANSWERED_EVENT,
  type PrivacyChange,
} from "@/lib/shared/privacy-changes";
import styles from "./PrivacyChangesModal.module.css";

/**
 * Seule page où la modale se tait : elle y couvrirait la politique qu'elle
 * invite à lire. Décidé **ici**, au rendu client, et non par la mise en page :
 * celle-ci n'est pas re-rendue d'un lien à l'autre, si bien qu'un silence
 * décidé côté serveur sur `/rgpd` aurait suivi le joueur sur tout le site.
 */
export const PRIVACY_POLICY_PATH = "/rgpd";

/**
 * Présente à un compte connecté les changements publiés du traitement de ses
 * données dont il n'a pas encore pris connaissance
 * (`lib/shared/privacy-changes.ts`), **tous à la fois** : un joueur revenu
 * après trois changements les lit ici tous les trois.
 *
 * **Elle informe, elle ne demande rien** : un seul bouton, « J'ai pris
 * connaissance », qui enregistre les changements *montrés* — leurs
 * identifiants voyagent dans la requête, pas « tout ce qui est dû ». Il n'y a
 * pas de refus, et surtout pas de refus qui coûterait le compte : un
 * traitement fondé sur l'intérêt légitime ou le service se discute par le
 * droit d'opposition, un traitement fondé sur le consentement se refuse par
 * son propre réglage, sans rien perdre d'autre. La modale le dit, et renvoie à
 * la politique pour l'exercice des droits.
 *
 * La modale ne se ferme **ni par Échap ni par un clic à côté** : elle revient
 * au chargement suivant tant que le joueur n'a pas cliqué — c'est ce que veut
 * dire « une seule fois ».
 *
 * Rendue par la mise en page racine, côté serveur : la liste est dans le HTML
 * initial, sans aller-retour ni clignotement.
 *
 * Langue de la page (lot 7b-2) : son habillage vient de `shell.privacyModal`,
 * et les entrées arrivent **déjà traduites** de la mise en page
 * (`localizedPrivacyChanges`) — aucune traduction n'est chargée ici.
 */
export function PrivacyChangesModal({ changes }: Readonly<{ changes: PrivacyChange[] }>) {
  const { t, rich, locale } = useShellText();
  const { showError, showSuccess } = useToast();
  const [answered, setAnswered] = useState(false);
  const [busy, setBusy] = useState(false);
  // Fermée par un lien d'action pendant un enregistrement : sa réponse ne doit
  // plus parler d'une modale que le joueur a quittée.
  const leftByLink = useRef(false);

  // Route sans préfixe de langue : `/en/rgpd` est la page de confidentialité.
  const { path: pathname } = useLocalePathname();

  // En anglais, les noms français cités « … » (catégories du formulaire, libellés de /profil)
  // sont marqués lang="fr" (WCAG 3.1.2) ; le français reste du texte brut, inchangé.
  const entryText = (text: string) => (locale === "en" ? <EnglishLegalText text={text} /> : text);
  const open = changes.length > 0 && !answered && pathname !== PRIVACY_POLICY_PATH;
  const dialogRef = useDialogBehavior({
    open,
    // Échap ne ferme rien : la modale attend que le joueur ait lu.
    onClose: () => {},
    locked: busy,
  });

  if (!open) return null;

  const record = async (changeIds: string[]) => {
    const response = await fetch("/api/profile/privacy-changes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ changeIds }),
      // Un lien d'action qui change de langue charge un nouveau document
      // (`LocaleLink`) : sans `keepalive`, ce départ annulerait l'écriture.
      keepalive: true,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  };

  const close = () => {
    setAnswered(true);
    window.dispatchEvent(new Event(PRIVACY_CHANGES_ANSWERED_EVENT));
  };

  const acknowledge = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await record(changes.map((change) => change.id));
      close();
      if (!leftByLink.current) showSuccess(t("privacyModal.saved"));
    } catch {
      // Échec d'un enregistrement parti d'une modale déjà refermée : rien à réessayer ici.
      showError(leftByLink.current ? t("privacyModal.replay") : t("privacyModal.failed"));
    } finally {
      setBusy(false);
    }
  };

  /**
   * Suivre un lien d'action vaut prise de connaissance **de ce changement-là**,
   * pas des autres présentés avec lui : un clic dans une entrée ne prouve pas
   * qu'on a lu ses voisines, qui reviendront au chargement suivant. La modale
   * se ferme **aussitôt** : elle ne se tait que sur `/rgpd`, et attendre la
   * réponse la laisserait couvrir l'écran même où elle envoie agir — pour de
   * bon si l'enregistrement échoue. Un échec la fait simplement revenir au
   * chargement suivant, ce que le message annonce. Un enregistrement déjà en
   * cours (clic sur le bouton juste avant) couvre tout et n'est pas doublé.
   */
  const followLink = (changeId: string) => {
    close();
    if (busy) {
      leftByLink.current = true;
      return;
    }
    record([changeId]).catch(() => showError(t("privacyModal.replay")));
  };

  return (
    <div /* NOSONAR S6819 — voile de modale, sans équivalent natif */ className={styles.overlay} role="presentation">
      <div /* NOSONAR S6819 — modale portée dans body (useDialogBehavior) : `<dialog>` changerait couche, Échap et ::backdrop */
        ref={dialogRef}
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="privacy-changes-title"
        aria-describedby="privacy-changes-intro"
        aria-busy={busy}
        tabIndex={-1}
      >
        <span className="eyebrow">{t("privacyModal.eyebrow")}</span>
        <h2 id="privacy-changes-title" className={styles.title}>
          {t("privacyModal.heading", { count: changes.length })}
        </h2>
        <p id="privacy-changes-intro" className={styles.intro}>
          {changes.length > 1 ? t("privacyModal.introMany") : t("privacyModal.introOne")}
        </p>

        <ScrollArea orientation="y" className={styles.changes} ariaLabel={t("privacyModal.detailsLabel")}>
          <ol className={styles.changeList}>
            {changes.map((change) => (
              <li key={change.id} className={styles.change}>
                <div className={styles.changeHead}>
                  <h3 className={styles.changeTitle}>{change.title}</h3>
                  <time className={styles.changeDate} dateTime={change.publishedAt}>
                    {formatPrivacyChangeDateIn(change.publishedAt, locale)}
                  </time>
                </div>
                <p className={styles.changeSummary}>{entryText(change.summary)}</p>
                {change.details.length > 0 && (
                  <ul className={styles.changeDetails}>
                    {change.details.map((detail, index) => (
                      <li key={index} /* NOSONAR S6479 — détails d'une entrée publiée, immuables */>{entryText(detail)}</li>
                    ))}
                  </ul>
                )}
                {change.links && change.links.length > 0 && (
                  <ul className={styles.changeLinks}>
                    {change.links.map((link) => (
                      <li key={link.href}>
                        <LocaleLink href={link.href} onClick={() => followLink(change.id)}>
                          {link.label}
                        </LocaleLink>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ol>
        </ScrollArea>

        <p className={styles.policyLink}>
          {richNodes(
            rich("privacyModal.policy", {}, {
              policy: (children) => (
                <LocaleLink href="/rgpd" target="_blank" rel="noreferrer">
                  {richNodes(children)}
                </LocaleLink>
              ),
            }),
          )}
        </p>

        <div className={styles.actions}>
          <CyberButton variant="primary" type="button" onClick={acknowledge} disabled={busy}>
            {busy ? t("privacyModal.saving") : t("privacyModal.acknowledge")}
          </CyberButton>
        </div>
      </div>
    </div>
  );
}

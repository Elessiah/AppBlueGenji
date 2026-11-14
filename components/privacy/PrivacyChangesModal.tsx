"use client";

import { useEffect, useRef, useState } from "react";
import { LocaleLink, useLocalePathname } from "@/components/i18n/locale-navigation";
import { richNodes, useShellText } from "@/components/i18n/shell-text";
import { CyberButton, ScrollArea } from "@/components/cyber";
import { EnglishLegalText } from "@/components/legal/EnglishLegalText";
import { useToast } from "@/components/ui/toast";
import { useDialogBehavior } from "@/lib/shared/hooks/useDialogBehavior";
import { crossesLocale, type Locale } from "@/lib/shared/locales";
import {
  formatPrivacyChangeDateIn,
  privacyAnsweredEvent,
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
 * Phrase d'ouverture : « aucun accord » sans exception, sauf quand un
 * changement montré annonce des conditions d'utilisation à accepter
 * (`asksTermsAcceptance`) — comme le pied du message privé (EF-19).
 */
export function privacyModalIntroKey(changes: readonly PrivacyChange[]) {
  const terms = changes.some((change) => change.asksTermsAcceptance === true);
  if (changes.length > 1) return terms ? "privacyModal.introManyTerms" : "privacyModal.introMany";
  return terms ? "privacyModal.introOneTerms" : "privacyModal.introOne";
}

/** Clé d'un détail lu : la langue en fait partie (un passage à `/en` relit l'anglais). */
function detailKey(locale: Locale, id: string): string {
  return `${locale}:${id}`;
}

/**
 * La lecture de détail que réclame la liste **présentée** : les seules entrées
 * sans détail ni détail déjà lu **dans cette langue**, préfixées de la langue —
 * `""` quand rien ne manque. Une liste qui rétrécit ou se réordonne ne relit
 * rien ; une entrée ajoutée sous la modale ouverte (publiée à minuit), ou un
 * changement de langue, en relance une.
 */
export function privacyDetailsRequestKey(
  changes: readonly Pick<PrivacyChange, "id" | "details">[],
  loaded: PrivacyChangeDetails,
  locale: Locale,
): string {
  const missing = changes
    .filter((change) => change.details.length === 0 && !(detailKey(locale, change.id) in loaded))
    .map((change) => change.id);
  return missing.length > 0 ? `${locale}|${missing.join(",")}` : "";
}

/** Langue et identifiants d'une clé de lecture (`privacyDetailsRequestKey`). */
function splitRequestKey(key: string): { locale: string; ids: string[] } {
  const bar = key.indexOf("|");
  return { locale: key.slice(0, bar), ids: key.slice(bar + 1).split(",") };
}

/**
 * La lecture `readKey` couvre-t-elle `requestKey` ? Même langue, et chaque
 * identifiant demandé déjà dans cette lecture. Une clé vide est toujours couverte.
 */
export function privacyDetailsReadCovers(readKey: string | null, requestKey: string): boolean {
  if (requestKey === "") return true;
  if (readKey === null || readKey === "") return false;
  const read = splitRequestKey(readKey);
  const wanted = splitRequestKey(requestKey);
  return read.locale === wanted.locale && wanted.ids.every((id) => read.ids.includes(id));
}

/**
 * Le suivi des lectures de détail d'une modale : seule la **dernière** lecture
 * lancée parle (son échec se dit, celui d'une lecture dépassée se tait — même
 * à clé égale, après un aller-retour de langue), et une clé que la dernière
 * lecture couvre déjà n'en relance pas une (lecture dépassée revenue, qui
 * réduit la clé à ce que la dernière attend encore).
 */
export function createPrivacyDetailsReads() {
  let sequence = 0;
  let latest: { seq: number; key: string } | null = null;
  return {
    /** Numéro de la lecture à lancer, `null` si la dernière couvre déjà `requestKey`. */
    start(requestKey: string): number | null {
      if (privacyDetailsReadCovers(latest?.key ?? null, requestKey)) return null;
      sequence += 1;
      latest = { seq: sequence, key: requestKey };
      return sequence;
    },
    isLatest(seq: number): boolean {
      return latest?.seq === seq;
    },
  };
}

/**
 * Le bouton attend-il le détail ? Oui tant qu'une lecture est due
 * (`requestKey` non vide) et que la dernière lecture, en échec (`failedFor`),
 * ne la couvre pas : on ne prend pas connaissance d'une entrée dont le détail
 * n'a jamais été montré.
 */
export function privacyDetailsPending(
  detailsDeferred: boolean,
  requestKey: string,
  failedFor: string | null,
): boolean {
  return detailsDeferred && requestKey !== "" && !(failedFor !== null && privacyDetailsReadCovers(failedFor, requestKey));
}

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
 * initial, sans aller-retour ni clignotement. Le **détail** des entrées, lui,
 * n'y est pas (`detailsDeferred`, #587) : la charge de chaque page d'un compte
 * en retard en portait des dizaines de Ko. Il se lit une fois, à l'ouverture
 * (`GET /api/profile/privacy-changes`), et le bouton attend qu'il soit là — on
 * ne prend pas connaissance d'un détail encore absent. En panne, une erreur le
 * dit et le bouton se libère : la politique, liée, porte tout le texte.
 *
 * Langue de la page (lot 7b-2) : son habillage vient de `shell.privacyModal`,
 * et les entrées arrivent **déjà traduites** de la mise en page
 * (`localizedPrivacyChanges`) — aucune traduction n'est chargée ici.
 */
export function PrivacyChangesModal({
  changes,
  detailsDeferred = false,
}: Readonly<{ changes: PrivacyChange[]; detailsDeferred?: boolean }>) {
  const { t, rich, locale } = useShellText();
  const { showError, showSuccess } = useToast();
  const [answered, setAnswered] = useState(false);
  const [busy, setBusy] = useState(false);
  // Détail lu, par langue et identifiant (`detailKey`).
  const [loadedDetails, setLoadedDetails] = useState<PrivacyChangeDetails>({});
  // Lecture (`privacyDetailsRequestKey`) en échec : le bouton se libère.
  const [detailsFailedFor, setDetailsFailedFor] = useState<string | null>(null);
  const detailsReads = useRef(createPrivacyDetailsReads());
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

  const requestKey = privacyDetailsRequestKey(changes, loadedDetails, locale);
  useEffect(() => {
    if (!open || !detailsDeferred) return;
    const seq = detailsReads.current.start(requestKey);
    if (seq === null) return;
    // Lecture neuve : un échec précédent ne libère plus le bouton.
    setDetailsFailedFor(null);
    const ids = requestKey.slice(requestKey.indexOf("|") + 1).split(",");
    loadPrivacyChangeDetails(ids.join(","), locale).then(
      (details) => {
        // Chaque identifiant demandé est tenu pour lu, même sans détail rendu :
        // sinon la lecture se relancerait sans fin.
        setLoadedDetails((previous) => {
          const next = { ...previous };
          for (const id of ids) next[detailKey(locale, id)] = details[id] ?? [];
          return next;
        });
      },
      () => {
        // Une lecture dépassée (liste ou langue changée depuis, même revenue à
        // l'identique) se tait : la dernière lecture parle pour la liste présentée.
        if (!detailsReads.current.isLatest(seq)) return;
        setDetailsFailedFor(requestKey);
        showError(t("privacyModal.detailsFailed"));
      },
    );
  }, [open, detailsDeferred, requestKey, locale, showError, t]);
  const detailsPending = privacyDetailsPending(detailsDeferred, requestKey, detailsFailedFor);
  const detailsOf = (change: PrivacyChange) =>
    change.details.length > 0 ? change.details : (loadedDetails[detailKey(locale, change.id)] ?? []);

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

  const close = (followedLink = false) => {
    setAnswered(true);
    window.dispatchEvent(privacyAnsweredEvent(followedLink));
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
    close(true);
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
          {t(privacyModalIntroKey(changes))}
        </p>

        <ScrollArea orientation="y" className={styles.changes} ariaLabel={t("privacyModal.detailsLabel")}>
          {detailsPending && (
            <output className={`${styles.changeSummary} ${styles.detailsLoading}`}>
              {t("privacyModal.detailsLoading")}
            </output>
          )}
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
                {detailsOf(change).length > 0 && (
                  <ul className={styles.changeDetails}>
                    {detailsOf(change).map((detail, index) => (
                      <li key={index} /* NOSONAR S6479 — détails d'une entrée publiée, immuables */>{entryText(detail)}</li>
                    ))}
                  </ul>
                )}
                {change.links && change.links.length > 0 && (
                  <ul className={styles.changeLinks}>
                    {change.links.map((link) => {
                      // Vers une page encore française (profil), le lien le dit, comme `EnglishLegalLink`.
                      const french = crossesLocale(link.href, locale);
                      return (
                        <li key={link.href}>
                          <LocaleLink
                            href={link.href}
                            hrefLang={french ? "fr" : undefined}
                            onClick={() => followLink(change.id)}
                          >
                            {link.label}
                            {french && ` ${t("privacyModal.inFrench")}`}
                          </LocaleLink>
                        </li>
                      );
                    })}
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
          <CyberButton variant="primary" type="button" onClick={acknowledge} disabled={busy || detailsPending}>
            {busy ? t("privacyModal.saving") : t("privacyModal.acknowledge")}
          </CyberButton>
        </div>
      </div>
    </div>
  );
}

/** Détail des entrées présentées, par identifiant (`GET /api/profile/privacy-changes`). */
export type PrivacyChangeDetails = Record<string, readonly string[]>;

/** Lit le détail des entrées `idsKey` (identifiants joints par des virgules), dans la langue de la page. */
async function loadPrivacyChangeDetails(idsKey: string, locale: Locale): Promise<PrivacyChangeDetails> {
  const query = new URLSearchParams({ ids: idsKey, locale });
  const response = await fetch(`/api/profile/privacy-changes?${query.toString()}`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = (await response.json()) as { details?: PrivacyChangeDetails };
  return body.details ?? {};
}

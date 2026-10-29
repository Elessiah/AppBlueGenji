"use client";

import { type Dispatch, FormEvent, type ReactNode, type SetStateAction, useEffect, useId, useRef, useState } from "react";
import { LocaleLink, useLocaleHref } from "@/components/i18n/locale-navigation";
import { createPortal } from "react-dom";
import { CyberButton, ScrollArea } from "@/components/cyber";
import { useToast } from "@/components/ui/toast";
import { useBackdropDismiss } from "@/lib/shared/hooks/useBackdropDismiss";
import { useDialogBehavior } from "@/lib/shared/hooks/useDialogBehavior";
import {
  MODERATION_SUPPORT_PORTAL_URL,
  OFF_SITE_CONDUCT_ICON,
  REPORT_CATEGORIES,
  REPORT_CATEGORY_RULES,
  REPORT_CONTACT_EMAIL_MAX_LENGTH,
  REPORT_CONTACT_NAME_MAX_LENGTH,
  REPORT_DESCRIPTION_MAX_LENGTH,
  REPORT_DESCRIPTION_MIN_LENGTH,
  REPORT_MAX_TARGETS,
  RIGHTS_RELATIONS,
  missingReplyChannel,
  reportRequiresConsent,
  reportTargetFromPath,
  validateReportSubmission,
  type ContestableReportOption,
  type ReportCategory,
  type ReportCategoryRules,
  type ReportTargetOption,
  type ReportTargetType,
  type RightsRelation,
} from "@/lib/shared/content-reports";
import { TERMS_PATH } from "@/lib/shared/terms-of-use";
import { TargetPicker } from "./TargetPicker";
import { richNodes } from "@/components/i18n/shell-text";
import { INTL_LOCALE, type Locale } from "@/lib/shared/locales";
import { cached } from "@/lib/shared/intl-cache";
import { UNREADABLE_DATE } from "@/lib/shared/dates";
import {
  legalBasisText,
  reportErrorText,
  retentionText,
  rightsText,
  useReportsText,
  type ReportsMessages,
  type ReportsText,
} from "./reports-text";
import { ReportsTextProvider } from "./reports-text-provider";
import styles from "./ReportProblem.module.css";

/**
 * Formateurs construits une fois, et seulement pour la langue lue (`cached`) :
 * `toLocaleDateString` en bâtirait un par option.
 */
const CONTEST_OPTION_DATE = new Map<Locale, Intl.DateTimeFormat>();
const CONTEST_OPTION_DATE_OPTIONS: Readonly<Record<Locale, Intl.DateTimeFormatOptions>> = {
  fr: { timeZone: "Europe/Paris" },
  en: { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Paris" },
};

/**
 * Date d'un signalement dans la liste à contester : courte (le texte d'une
 * option ne passe pas à la ligne). Le français garde ses chiffres (jour/mois,
 * sans ambiguïté pour lui) ; l'anglais nomme le mois, que `10/12/2026` ne dit
 * pas sans équivoque. En heure de Paris, comme la page du signalement : les
 * deux écrans donnent le même jour.
 */
function contestOptionDate(iso: string, locale: Locale): string {
  const format = cached(CONTEST_OPTION_DATE, locale, (key) => new Intl.DateTimeFormat(INTL_LOCALE[key], CONTEST_OPTION_DATE_OPTIONS[key]));
  const date = new Date(iso);
  // Une date illisible ne fait pas tomber le formulaire (`format` lève sur une date invalide).
  return Number.isNaN(date.getTime()) ? UNREADABLE_DATE : format.format(date);
}

export interface ReportProblemDialogProps {
  /** Chemin de la page d'où l'on signale : il accompagne le signalement. */
  pathname: string;
  /** Visiteur connecté : lui seul peut désigner des cibles par leur nom. */
  authenticated: boolean;
  onClose: () => void;
  /**
   * Ouvre directement une contestation de ce signalement (page d'un
   * signalement qui vise le lecteur) : la catégorie et le signalement sont
   * déjà choisis.
   */
  contestOf?: number;
  /**
   * Ouvre directement le détail d'une catégorie (bouton « Faire une demande
   * RGPD » de `/rgpd`). Contrairement à une contestation, on peut encore en
   * changer.
   */
  initialCategory?: Exclude<ReportCategory, "CONTEST">;
  /** Appelé après un envoi réussi (la page d'un signalement relit ses contestations). */
  onSubmitted?: () => void;
  /**
   * L'anglais du formulaire, chargé au clic sous `/en` par `ReportProblemButton`
   * (revue de performance du lot 9-2) : le formulaire pose alors lui-même son
   * fournisseur, dans son morceau — le bouton, au pied de chaque page, n'en
   * porte pas la mécanique. Absent : les textes du fournisseur au-dessus (page
   * d'un signalement), le français à défaut.
   */
  englishMessages?: ReportsMessages;
}

type Selection = Record<ReportTargetType, ReportTargetOption[]>;
const EMPTY_SELECTION: Selection = { USER: [], TEAM: [], TOURNAMENT: [] };

/** Mention à côté du champ d'adresse de réponse. */
function replyChannelRequirement(text: ReportsText, requiresReplyChannel: boolean, authenticated: boolean): string {
  if (!requiresReplyChannel) return text.t("dialog.replyOptional");
  return authenticated ? text.t("dialog.replyRequiredDiscord") : text.t("dialog.replyRequiredAccount");
}

/** Ce que l'absence d'adresse de réponse implique. */
function replyChannelHint(text: ReportsText, requiresReplyChannel: boolean, authenticated: boolean): string {
  if (authenticated) return text.t("dialog.replyHintAuthenticated");
  return requiresReplyChannel ? text.t("dialog.replyHintRequired") : text.t("dialog.replyHintOptional");
}

/**
 * Formulaire « Signaler un problème », ouvert depuis le pied de page de toutes
 * les pages.
 *
 * Deux étapes : la **catégorie** d'abord (elle décide de tout le reste — ce
 * qu'on peut désigner, ce qu'on exige), puis le détail. La validation est celle
 * de la route (`validateReportSubmission`), rejouée ici avant l'envoi : la
 * saisie incomplète est refusée par une notification qui nomme le champ en
 * cause, sans aller-retour — le bouton, lui, n'est jamais grisé (un bouton
 * éteint ne dit pas ce qui manque).
 *
 * Ouvert depuis la fiche d'un joueur, d'une équipe ou d'un tournoi, le
 * formulaire la désigne déjà (`reportTargetFromPath`), si la catégorie le
 * permet : c'est presque toujours d'elle qu'on veut parler.
 */
export function ReportProblemDialog({ englishMessages, ...props }: Readonly<ReportProblemDialogProps>) {
  if (!englishMessages) return <ReportForm {...props} />;
  return (
    <ReportsTextProvider locale="en" messages={englishMessages}>
      <ReportForm {...props} />
    </ReportsTextProvider>
  );
}

function ReportForm({
  pathname,
  authenticated,
  onClose,
  contestOf,
  initialCategory,
  onSubmitted,
}: Readonly<Omit<ReportProblemDialogProps, "englishMessages">>) {
  const { showError, showSuccess } = useToast();
  const text = useReportsText();
  const { t } = text;
  const titleId = useId();
  const [category, setCategory] = useState<ReportCategory | null>(
    contestOf ? "CONTEST" : (initialCategory ?? null),
  );
  const [parentReportId, setParentReportId] = useState<number | null>(contestOf ?? null);
  const [contestable, setContestable] = useState<ContestableReportOption[] | null>(null);
  const [selection, setSelection] = useState<Selection>(EMPTY_SELECTION);
  const [description, setDescription] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [rightsRelation, setRightsRelation] = useState<RightsRelation | "">("");
  const [goodFaith, setGoodFaith] = useState(false);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const [pageTarget, setPageTarget] = useState<ReportTargetOption | null>(null);

  const dialogRef = useDialogBehavior({ open: true, onClose, locked: busy });
  const backdrop = useBackdropDismiss(onClose, busy);

  // La fiche d'où l'on signale, résolue une fois (nom et vignette).
  useEffect(() => {
    const ref = reportTargetFromPath(pathname);
    if (!ref || !authenticated) return;
    let cancelled = false;
    fetch(`/api/reports/targets?type=${ref.type}&ids=${ref.id}`, { cache: "no-store" })
      .then(async (response) => (response.ok ? ((await response.json()) as { options: ReportTargetOption[] }).options : []))
      .then((options) => {
        if (!cancelled && options[0]) setPageTarget(options[0]);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [pathname, authenticated]);

  const definition = category ? REPORT_CATEGORY_RULES[category] : null;

  // Les signalements que le lecteur peut contester, chargés au choix de la
  // catégorie seulement : ils n'intéressent que lui, et que là.
  useEffect(() => {
    if (category !== "CONTEST" || !authenticated || contestable !== null) return;
    let cancelled = false;
    fetch("/api/reports/contestable", { cache: "no-store" })
      .then(async (response) =>
        response.ok ? ((await response.json()) as { reports: ContestableReportOption[] }).reports : [],
      )
      .then((reports) => {
        if (!cancelled) setContestable(reports);
      })
      .catch(() => {
        if (!cancelled) setContestable([]);
      });
    return () => {
      cancelled = true;
    };
  }, [category, authenticated, contestable]);

  // Changer d'étape remplace le contenu sous le focus : on le repose sur le
  // premier geste de l'étape (la description, ou la première catégorie au
  // retour), sans quoi il tombe sur `<body>` et le clavier sort de la modale.
  const choosing = category === null;
  // À l'ouverture, c'est `useDialogBehavior` qui pose le focus (sur l'élément
  // marqué `data-autofocus`) : cet effet ne sert qu'aux changements d'étape.
  const mountedStep = useRef(true);
  useEffect(() => {
    if (mountedStep.current) {
      mountedStep.current = false;
      return;
    }
    const dialog = dialogRef.current;
    if (!dialog) return;
    const target = dialog.querySelector<HTMLElement>(choosing ? "button[data-category]" : "textarea");
    target?.focus();
    // `dialogRef` est stable ; seul le changement d'étape compte.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [choosing]);

  const chooseCategory = (next: ReportCategory) => {
    setCategory(next);
    const allowed = REPORT_CATEGORY_RULES[next].targets;
    // Les cibles d'une autre catégorie ne survivent qu'à hauteur de ce que la
    // nouvelle autorise ; la fiche d'où l'on signale est proposée d'office.
    setSelection((current) => {
      const kept: Selection = { USER: [], TEAM: [], TOURNAMENT: [] };
      for (const type of allowed) kept[type] = current[type];
      if (pageTarget && allowed.includes(pageTarget.type) && !kept[pageTarget.type].some((t) => t.id === pageTarget.id)) {
        kept[pageTarget.type] = [pageTarget, ...kept[pageTarget.type]];
      }
      return kept;
    });
  };

  const selectedTargets = Object.values(selection).flat();
  const payload = {
    category,
    description,
    targets: selectedTargets.map((target) => ({ type: target.type, id: target.id })),
    pagePath: pathname,
    contactName,
    contactEmail,
    rightsRelation: rightsRelation || undefined,
    goodFaith,
    consent,
    parentReportId: category === "CONTEST" ? parentReportId : undefined,
  };
  const validation = validateReportSubmission(payload);
  const descriptionLength = description.trim().length;
  const descriptionTooShort = descriptionLength > 0 && descriptionLength < REPORT_DESCRIPTION_MIN_LENGTH;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    // Garde par référence (revue de sécurité du lot 9-2) : deux envois dans le même
    // instant feraient deux signalements, deux alertes et deux messages privés.
    if (sending.current) return;
    if (!validation.ok) {
      showError(reportErrorText(text, validation.error));
      return;
    }
    if (missingReplyChannel(validation.value, authenticated)) {
      showError(reportErrorText(text, "REPORT_REPLY_CHANNEL_REQUIRED"));
      return;
    }
    sending.current = true;
    setBusy(true);
    try {
      const response = await fetch("/api/reports", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await response.json().catch(() => ({}))) as { id?: number; error?: string };
      if (!response.ok) throw new Error(body.error);
      // Un corps illisible ne porte pas de numéro : l'accusé s'en passe plutôt que de dire « n° undefined ».
      const sent = typeof body.id === "number" ? t("dialog.sent", { id: String(body.id) }) : t("dialog.sentNoId");
      showSuccess(category === "CONTEST" ? t("dialog.contestSent") : sent);
      onSubmitted?.();
      onClose();
    } catch (error) {
      showError(reportErrorText(text, (error as Error).message));
    } finally {
      sending.current = false;
      setBusy(false);
    }
  };

  return createPortal(
    <div /* NOSONAR S6819 — voile de modale, sans équivalent natif */ className={styles.overlay} role="presentation" {...backdrop}>
      <div /* NOSONAR S6819 — modale portée dans body (useDialogBehavior) : `<dialog>` changerait couche, Échap et ::backdrop */
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={styles.modal}
      >
        <div className={styles.head}>
          <div>
            <span className="eyebrow">{t("dialog.eyebrow")}</span>
            <h2 id={titleId} className={styles.title}>
              {t("dialog.title")}
            </h2>
          </div>
          <button
            type="button"
            className={styles.close}
            onClick={() => !busy && onClose()}
            aria-disabled={busy || undefined}
            aria-label={t("dialog.close")}
          >
            ×
          </button>
        </div>

        {category === null || definition === null ? (
          <CategoryChoice onChoose={chooseCategory} />
        ) : (
          <form onSubmit={submit} className={styles.form} noValidate>
            <ScrollArea orientation="y" className={styles.body} ariaLabel={t("dialog.bodyLabel")}>
              <div className={styles.stepBar}>
                {contestOf === undefined && (
                  <button type="button" className={styles.back} onClick={() => !busy && setCategory(null)}
                    aria-disabled={busy || undefined}
                  >
                    {t("dialog.changeCategory")}
                  </button>
                )}
                <span className={styles.categoryPill}>
                  <span aria-hidden="true">{definition.icon}</span> {t(`categories.${category}.label`)}
                </span>
              </div>

              {category === "MODERATION" && (
                <p className={styles.anonNote}>
                  {/* Une seule phrase, lien compris (`<portal>`) : chaque langue place le lien où elle veut. */}
                  {richNodes(
                    text.rich("offSite.notice", {}, {
                      portal: (chunks) => (
                        <a href={MODERATION_SUPPORT_PORTAL_URL} target="_blank" rel="noopener noreferrer">
                          {richNodes(chunks)}
                          {/* NOSONAR S6772 — l'espace est dans le texte réservé aux lecteurs d'écran */}
                          <span className="sr-only">{` ${t("dialog.newTab")}`}</span>
                        </a>
                      ),
                    }),
                  )}
                </p>
              )}

              <TargetsField
                types={definition.targets}
                authenticated={authenticated}
                selection={selection}
                onSelectionChange={setSelection}
                full={selectedTargets.length >= REPORT_MAX_TARGETS}
                pathname={pathname}
                onClose={onClose}
              />

              {category === "CONTEST" && (
                <ContestField
                  fieldId={titleId}
                  pathname={pathname}
                  authenticated={authenticated}
                  contestOf={contestOf}
                  contestable={contestable}
                  parentReportId={parentReportId}
                  onParentReportIdChange={setParentReportId}
                  onClose={onClose}
                />
              )}

              <div className="field">
                <label htmlFor={`${titleId}-description`}>{t("dialog.description")}</label>
                <textarea
                  id={`${titleId}-description`}
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  rows={5}
                  maxLength={REPORT_DESCRIPTION_MAX_LENGTH}
                  placeholder={t(`categories.${category}.placeholder`)}
                  aria-invalid={descriptionTooShort}
                  aria-describedby={`${titleId}-description-hint`}
                  data-autofocus={contestOf !== undefined || initialCategory !== undefined ? "" : undefined}
                />
                <p
                  id={`${titleId}-description-hint`}
                  className={`${styles.hint} ${descriptionTooShort ? styles.hintError : ""}`}
                >
                  {descriptionTooShort
                    ? t("dialog.tooShort", { count: REPORT_DESCRIPTION_MIN_LENGTH - descriptionLength })
                    : t("dialog.counter", { length: descriptionLength, max: REPORT_DESCRIPTION_MAX_LENGTH })}
                </p>
              </div>

              <ContactFields
                fieldId={titleId}
                definition={definition}
                authenticated={authenticated}
                contactName={contactName}
                onContactNameChange={setContactName}
                contactEmail={contactEmail}
                onContactEmailChange={setContactEmail}
                rightsRelation={rightsRelation}
                onRightsRelationChange={setRightsRelation}
                goodFaith={goodFaith}
                onGoodFaithChange={setGoodFaith}
              />

              <ReportPrivacyNotice category={category} />

              {/* Pas de case là où l'association est tenue de traiter la
                  demande (droit, notification, contestation) : un accord
                  qu'on ne peut pas refuser n'en est pas un. */}
              {reportRequiresConsent(category) && (
                <label className={styles.check}>
                  <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
                  <span>{t("dialog.consent")}</span>
                </label>
              )}
            </ScrollArea>

            <div className={styles.foot}>
              <CyberButton type="button" variant="ghost" onClick={() => !busy && onClose()} aria-disabled={busy || undefined}>
                {t("dialog.cancel")}
              </CyberButton>
              {/* Jamais grisé pour une saisie incomplète : un bouton éteint ne
                  dit pas ce qui manque, l'envoi le dit (en notification). */}
              <CyberButton type="submit" variant="primary" aria-disabled={busy || undefined} aria-busy={busy || undefined}>
                {busy ? t("dialog.sending") : t("dialog.submit")}
              </CyberButton>
            </div>
          </form>
        )}
      </div>
    </div>,
    document.body,
  );
}

/** Étape 1 : le choix de la catégorie. */
function CategoryChoice({ onChoose }: Readonly<{ onChoose: (category: ReportCategory) => void }>) {
  const { t } = useReportsText();
  return (
    <ScrollArea orientation="y" className={styles.body} ariaLabel={t("dialog.chooseLabel")}>
      <p className={styles.lead}>{t("dialog.lead")}</p>
      <div className={styles.categories}>
        {REPORT_CATEGORIES.flatMap((key) => {
          const item = REPORT_CATEGORY_RULES[key];
          const card = (
            <button
              key={key}
              type="button"
              className={styles.categoryCard}
              onClick={() => onChoose(key)}
              data-category={key}
              data-autofocus={key === REPORT_CATEGORIES[0] ? "" : undefined}
            >
              <span className={styles.categoryIcon} aria-hidden="true">
                {item.icon}
              </span>
              <span className={styles.categoryLabel}>{t(`categories.${key}.label`)}</span>
              <span className={styles.categoryHint}>{t(`categories.${key}.hint`)}</span>
            </button>
          );
          if (key !== "MODERATION") return [card];
          // Juste après la modération du site : la modération qui ne
          // l'est pas, et qui se traite ailleurs.
          return [
            card,
            <a
              key="OFF_SITE_CONDUCT"
              href={MODERATION_SUPPORT_PORTAL_URL}
              target="_blank"
              rel="noopener noreferrer"
              className={`${styles.categoryCard} ${styles.categoryExternal}`}
            >
              <span className={styles.categoryIcon} aria-hidden="true">
                {OFF_SITE_CONDUCT_ICON}
              </span>
              <span className={styles.categoryLabel}>
                {t("offSite.label")}
                <span className="sr-only">{` ${t("dialog.portalSuffix")}`}</span>
              </span>
              <span className={styles.categoryHint}>{t("offSite.hint")}</span>
            </a>,
          ];
        })}
      </div>
    </ScrollArea>
  );
}

interface TargetsFieldProps {
  types: readonly ReportTargetType[];
  authenticated: boolean;
  selection: Selection;
  onSelectionChange: Dispatch<SetStateAction<Selection>>;
  full: boolean;
  pathname: string;
  onClose: () => void;
}

/** Cibles désignées : sélecteurs pour un compte, renvoi à la connexion sinon. */
function TargetsField({
  types,
  authenticated,
  selection,
  onSelectionChange,
  full,
  pathname,
  onClose,
}: Readonly<TargetsFieldProps>) {
  const text = useReportsText();
  if (types.length === 0) return null;
  if (authenticated) {
    return (
      <>
        {types.map((type) => (
          <TargetPicker
            key={type}
            type={type}
            selected={selection[type]}
            onChange={(next) => onSelectionChange((current) => ({ ...current, [type]: next }))}
            full={full}
          />
        ))}
      </>
    );
  }
  return (
    <p className={styles.anonNote}>
      {richNodes(
        text.rich("dialog.targetsAnon", {}, {
          login: (chunks) => (
            <LoginReturnLink pathname={pathname} onClose={onClose}>
              {chunks}
            </LoginReturnLink>
          ),
        }),
      )}
    </p>
  );
}

/**
 * Lien de connexion qui ramène à la page signalée **dans sa langue** :
 * `pathname` est la route sans préfixe (pour reconnaître la cible et tenir le
 * journal), le retour, lui, reprend `/en` sur une page anglaise.
 */
function LoginReturnLink({
  pathname,
  onClose,
  children,
}: Readonly<{ pathname: string; onClose: () => void; children: ReactNode }>) {
  const localized = useLocaleHref();
  return (
    <LocaleLink href={`/connexion?redirect=${encodeURIComponent(localized(pathname))}`} onClick={onClose}>
      {children}
    </LocaleLink>
  );
}

interface ContestFieldProps {
  fieldId: string;
  pathname: string;
  authenticated: boolean;
  contestOf: number | undefined;
  contestable: ContestableReportOption[] | null;
  parentReportId: number | null;
  onParentReportIdChange: (id: number | null) => void;
  onClose: () => void;
}

/**
 * Bloc « Signalement contesté » : connexion requise, contestation déjà
 * désignée, rien à contester, ou choix du signalement.
 */
function ContestField({
  fieldId,
  pathname,
  authenticated,
  contestOf,
  contestable,
  parentReportId,
  onParentReportIdChange,
  onClose,
}: Readonly<ContestFieldProps>) {
  const text = useReportsText();
  const { t } = text;
  if (!authenticated) {
    return (
      <p className={styles.anonNote}>
        {richNodes(
          text.rich("dialog.contestAnon", {}, {
            login: (chunks) => (
              <LoginReturnLink pathname={pathname} onClose={onClose}>
                {chunks}
              </LoginReturnLink>
            ),
          }),
        )}
      </p>
    );
  }
  if (contestOf !== undefined) {
    return <p className={styles.lead}>{t("dialog.contestOf", { id: String(contestOf) })}</p>;
  }
  if (contestable !== null && contestable.length === 0) {
    return <p className={styles.anonNote}>{t("dialog.nothingToContest")}</p>;
  }
  return (
    <div className="field">
      <label htmlFor={`${fieldId}-parent`}>{t("dialog.contested")}</label>
      <select
        id={`${fieldId}-parent`}
        value={parentReportId ?? ""}
        onChange={(event) => onParentReportIdChange(event.target.value ? Number(event.target.value) : null)}
        disabled={contestable === null}
      >
        <option value="">{contestable === null ? t("dialog.loading") : t("dialog.choose")}</option>
        {(contestable ?? []).map((option) => (
          <option key={option.id} value={option.id}>
            {t("dialog.contestOption", {
              id: String(option.id),
              category: t(`categories.${option.category}.label`),
              date: contestOptionDate(option.createdAt, text.locale),
              status: t(`status.${option.status}`),
            })}
          </option>
        ))}
      </select>
    </div>
  );
}

interface ContactFieldsProps {
  fieldId: string;
  definition: ReportCategoryRules;
  authenticated: boolean;
  contactName: string;
  onContactNameChange: (value: string) => void;
  contactEmail: string;
  onContactEmailChange: (value: string) => void;
  rightsRelation: RightsRelation | "";
  onRightsRelationChange: (value: RightsRelation | "") => void;
  goodFaith: boolean;
  onGoodFaithChange: (value: boolean) => void;
}

/** Coordonnées exigées (droit d'auteur, hébergeur…) ou adresse de réponse facultative. */
function ContactFields({
  fieldId,
  definition,
  authenticated,
  contactName,
  onContactNameChange,
  contactEmail,
  onContactEmailChange,
  rightsRelation,
  onRightsRelationChange,
  goodFaith,
  onGoodFaithChange,
}: Readonly<ContactFieldsProps>) {
  const text = useReportsText();
  const { t } = text;
  if (definition.requiresContact) {
    return (
      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>{t("dialog.contactLegend")}</legend>
        <div className={styles.twoCols}>
          <div className="field">
            <label htmlFor={`${fieldId}-name`}>{t("dialog.contactName")}</label>
            <input
              id={`${fieldId}-name`}
              value={contactName}
              onChange={(event) => onContactNameChange(event.target.value)}
              maxLength={REPORT_CONTACT_NAME_MAX_LENGTH}
              autoComplete="name"
              required
            />
          </div>
          <div className="field">
            <label htmlFor={`${fieldId}-email`}>{t("dialog.contactEmail")}</label>
            <input
              id={`${fieldId}-email`}
              type="email"
              value={contactEmail}
              onChange={(event) => onContactEmailChange(event.target.value)}
              maxLength={REPORT_CONTACT_EMAIL_MAX_LENGTH}
              autoComplete="email"
              required
            />
          </div>
        </div>
        <div className="field">
          <label htmlFor={`${fieldId}-relation`}>{t("dialog.relation")}</label>
          <select
            id={`${fieldId}-relation`}
            value={rightsRelation}
            onChange={(event) => onRightsRelationChange(event.target.value as RightsRelation | "")}
            required
          >
            <option value="">{t("dialog.choose")}</option>
            {RIGHTS_RELATIONS.map((relation) => (
              <option key={relation} value={relation}>
                {t(`relation.${relation}`)}
              </option>
            ))}
          </select>
        </div>
        <label className={styles.check}>
          <input type="checkbox" checked={goodFaith} onChange={(event) => onGoodFaithChange(event.target.checked)} />
          <span>{t("dialog.goodFaith")}</span>
        </label>
      </fieldset>
    );
  }
  return (
    <div className="field">
      <label htmlFor={`${fieldId}-email`}>
        {t("dialog.replyEmail")}{" "}
        <span className={styles.optional}>
          {replyChannelRequirement(text, definition.requiresReplyChannel, authenticated)}
        </span>
      </label>
      <input
        id={`${fieldId}-email`}
        type="email"
        value={contactEmail}
        onChange={(event) => onContactEmailChange(event.target.value)}
        maxLength={REPORT_CONTACT_EMAIL_MAX_LENGTH}
        autoComplete="email"
      />
      <p className={styles.hint}>
        {replyChannelHint(text, definition.requiresReplyChannel, authenticated)}
      </p>
    </div>
  );
}

/** Mentions d'information sur les données du signalement. */
function ReportPrivacyNotice({ category }: Readonly<{ category: ReportCategory }>) {
  const text = useReportsText();
  const { t } = text;
  return (
    <div className={styles.notice}>
      <strong>{t("dialog.privacyTitle")}</strong>
      <ul>
        <li>{t("privacy.controller")}</li>
        <li>{t("privacy.purpose")}</li>
        <li>{t("privacy.data")}</li>
        <li>{category === "CONTEST" ? t("privacy.contestRecipients") : t("privacy.recipients")}</li>
        <li>{retentionText(text)}</li>
        <li>{legalBasisText(text, category)}</li>
        {(category === "COPYRIGHT" || category === "MODERATION") && <li>{t("privacy.followUp")}</li>}
        <li>
          {rightsText(text, category)}{" "}
          <LocaleLink href="/rgpd" target="_blank" rel="noreferrer">
            {t("dialog.privacyPolicy")}
            {/* NOSONAR S6772 — l'espace est dans le texte réservé aux lecteurs d'écran */}
            <span className="sr-only">{` ${t("dialog.newTab")}`}</span>
          </LocaleLink>{" "}
          ·{" "}
          <LocaleLink href={`${TERMS_PATH}#signalement`} target="_blank" rel="noreferrer">
            {t("dialog.terms")}
            {/* NOSONAR S6772 — l'espace est dans le texte réservé aux lecteurs d'écran */}
            <span className="sr-only">{` ${t("dialog.newTab")}`}</span>
          </LocaleLink>
        </li>
      </ul>
    </div>
  );
}

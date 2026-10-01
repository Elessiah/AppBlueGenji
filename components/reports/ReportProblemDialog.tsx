"use client";

import { type Dispatch, FormEvent, type SetStateAction, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { createPortal } from "react-dom";
import { CyberButton, ScrollArea } from "@/components/cyber";
import { useToast } from "@/components/ui/toast";
import { useBackdropDismiss } from "@/lib/shared/hooks/useBackdropDismiss";
import { useDialogBehavior } from "@/lib/shared/hooks/useDialogBehavior";
import {
  MODERATION_SUPPORT_PORTAL_URL,
  OFF_SITE_CONDUCT_ENTRY,
  OFF_SITE_CONDUCT_NOTICE,
  REPORT_CATEGORIES,
  REPORT_CATEGORY_DEFINITIONS,
  REPORT_CONTACT_EMAIL_MAX_LENGTH,
  REPORT_CONTACT_NAME_MAX_LENGTH,
  REPORT_DESCRIPTION_MAX_LENGTH,
  REPORT_DESCRIPTION_MIN_LENGTH,
  REPORT_MAX_TARGETS,
  NOTIFIER_FOLLOW_UP,
  REPORT_PRIVACY_NOTICE,
  RIGHTS_RELATIONS,
  RIGHTS_RELATION_LABELS,
  reportErrorMessage,
  missingReplyChannel,
  reportLegalBasisNotice,
  reportRequiresConsent,
  reportRightsNotice,
  reportTargetFromPath,
  validateReportSubmission,
  REPORT_STATUS_LABELS,
  type ContestableReportOption,
  type ReportCategory,
  type ReportCategoryDefinition,
  type ReportTargetOption,
  type ReportTargetType,
  type RightsRelation,
} from "@/lib/shared/content-reports";
import { TERMS_PATH } from "@/lib/shared/terms-of-use";
import { TargetPicker } from "./TargetPicker";
import styles from "./ReportProblem.module.css";

interface ReportProblemDialogProps {
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
}

type Selection = Record<ReportTargetType, ReportTargetOption[]>;
const EMPTY_SELECTION: Selection = { USER: [], TEAM: [], TOURNAMENT: [] };

/** Mention à côté du champ d'adresse de réponse. */
function replyChannelRequirement(requiresReplyChannel: boolean, authenticated: boolean): string {
  if (!requiresReplyChannel) return "(facultatif)";
  return authenticated ? "(obligatoire sans tag Discord certifié)" : "(obligatoire sans compte)";
}

/** Ce que l'absence d'adresse de réponse implique. */
function replyChannelHint(requiresReplyChannel: boolean, authenticated: boolean): string {
  if (authenticated) {
    return "Sans adresse, l'association te répondra sur Discord, si ton tag Discord est certifié.";
  }
  return requiresReplyChannel
    ? "Sans compte, c'est la seule façon pour l'association de te répondre."
    : "Sans adresse, l'association ne pourra pas te tenir au courant.";
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
export function ReportProblemDialog({
  pathname,
  authenticated,
  onClose,
  contestOf,
  initialCategory,
  onSubmitted,
}: Readonly<ReportProblemDialogProps>) {
  const { showError, showSuccess } = useToast();
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

  const definition = category ? REPORT_CATEGORY_DEFINITIONS[category] : null;

  // Les signalements que le lecteur peut contester, chargés au choix de la
  // catégorie seulement : ils n'intéressent que lui, et que là.
  useEffect(() => {
    if (category !== "CONTEST" || !authenticated || contestable !== null) return;
    let cancelled = false;
    fetch("/api/reports/contestable", { cache: "no-store" })
      .then(async (response) =>
        response.ok ? ((await response.json()) as { reports: ContestableReportOption[] }).reports : [],
      )
      .catch(() => [])
      .then((reports) => {
        if (!cancelled) setContestable(reports);
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
    const allowed = REPORT_CATEGORY_DEFINITIONS[next].targets;
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
    if (busy) return;
    if (!validation.ok) {
      showError(reportErrorMessage(validation.error));
      return;
    }
    if (missingReplyChannel(validation.value, authenticated)) {
      showError(reportErrorMessage("REPORT_REPLY_CHANNEL_REQUIRED"));
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/reports", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await response.json().catch(() => ({}))) as { id?: number; error?: string };
      if (!response.ok) throw new Error(body.error);
      showSuccess(
        category === "CONTEST"
          ? "Ta contestation a bien été transmise à l'association, qui réexamine le signalement."
          : `Merci, ton signalement n° ${body.id} a bien été transmis à l'association.`,
      );
      onSubmitted?.();
      onClose();
    } catch (error) {
      showError(reportErrorMessage((error as Error).message));
    } finally {
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
            <span className="eyebrow">ASSOCIATION · SIGNALEMENT</span>
            <h2 id={titleId} className={styles.title}>
              Signaler un problème
            </h2>
          </div>
          <button type="button" className={styles.close} onClick={onClose} disabled={busy} aria-label="Fermer">
            ×
          </button>
        </div>

        {category === null || definition === null ? (
          <CategoryChoice onChoose={chooseCategory} />
        ) : (
          <form onSubmit={submit} className={styles.form} noValidate>
            <ScrollArea orientation="y" className={styles.body} ariaLabel="Détail du signalement">
              <div className={styles.stepBar}>
                {contestOf === undefined && (
                  <button type="button" className={styles.back} onClick={() => setCategory(null)} disabled={busy}>
                    ← CHANGER DE CATÉGORIE
                  </button>
                )}
                <span className={styles.categoryPill}>
                  <span aria-hidden="true">{definition.icon}</span> {definition.label}
                </span>
              </div>

              {category === "MODERATION" && (
                <p className={styles.anonNote}>
                  {OFF_SITE_CONDUCT_NOTICE}{" "}
                  <a href={MODERATION_SUPPORT_PORTAL_URL} target="_blank" rel="noopener noreferrer">
                    portail de support BlueGenji
                    {/* NOSONAR S6772 — l'espace est dans le texte réservé aux lecteurs d'écran */}
                    <span className="sr-only"> (nouvel onglet)</span>
                  </a>
                  {/* NOSONAR S6772 — le point suit le lien sans espace */}
                  .
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
                <label htmlFor={`${titleId}-description`}>Description</label>
                <textarea
                  id={`${titleId}-description`}
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  rows={5}
                  maxLength={REPORT_DESCRIPTION_MAX_LENGTH}
                  placeholder={definition.descriptionPlaceholder}
                  aria-invalid={descriptionTooShort}
                  aria-describedby={`${titleId}-description-hint`}
                  data-autofocus={contestOf !== undefined || initialCategory !== undefined ? "" : undefined}
                />
                <p
                  id={`${titleId}-description-hint`}
                  className={`${styles.hint} ${descriptionTooShort ? styles.hintError : ""}`}
                >
                  {descriptionTooShort
                    ? `Encore ${REPORT_DESCRIPTION_MIN_LENGTH - descriptionLength} caractères au moins.`
                    : `${descriptionLength}/${REPORT_DESCRIPTION_MAX_LENGTH}`}
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
                  <span>
                    J&apos;accepte que l&apos;association Bluegenji Esport traite ces données pour donner suite à mon
                    signalement, dans les conditions ci-dessus.
                  </span>
                </label>
              )}
            </ScrollArea>

            <div className={styles.foot}>
              <CyberButton type="button" variant="ghost" onClick={onClose} disabled={busy}>
                Annuler
              </CyberButton>
              {/* Jamais grisé pour une saisie incomplète : un bouton éteint ne
                  dit pas ce qui manque, l'envoi le dit (en notification). */}
              <CyberButton type="submit" variant="primary" disabled={busy}>
                {busy ? "Envoi…" : "Envoyer le signalement"}
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
  return (
    <ScrollArea orientation="y" className={styles.body} ariaLabel="Choix de la catégorie">
      <p className={styles.lead}>
        De quoi s&apos;agit-il ? Le signalement est lu par les administrateurs de
        l&apos;association, qui le traitent au plus vite.
      </p>
      <div className={styles.categories}>
        {REPORT_CATEGORIES.flatMap((key) => {
          const item = REPORT_CATEGORY_DEFINITIONS[key];
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
              <span className={styles.categoryLabel}>{item.label}</span>
              <span className={styles.categoryHint}>{item.hint}</span>
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
                {OFF_SITE_CONDUCT_ENTRY.icon}
              </span>
              <span className={styles.categoryLabel}>
                {OFF_SITE_CONDUCT_ENTRY.label}
                <span className="sr-only"> (portail de support, nouvel onglet)</span>
              </span>
              <span className={styles.categoryHint}>{OFF_SITE_CONDUCT_ENTRY.hint}</span>
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
      <Link href={`/connexion?redirect=${encodeURIComponent(pathname)}`} onClick={onClose}>
        Connecte-toi
      </Link>{" "}
      pour
      désigner directement les joueurs, équipes ou tournois concernés. Sans compte, indique leur nom
      ou l&apos;adresse de la page dans ta description.
    </p>
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
  if (!authenticated) {
    return (
      <p className={styles.anonNote}>
        <Link href={`/connexion?redirect=${encodeURIComponent(pathname)}`} onClick={onClose}>
          Connecte-toi
        </Link>{" "}
        pour contester un signalement : seuls les joueurs visés, les membres des équipes visées
        et l&apos;auteur d&apos;un signalement de droit d&apos;auteur ou de modération, une fois le
        dossier archivé, peuvent le faire.
      </p>
    );
  }
  if (contestOf !== undefined) {
    return <p className={styles.lead}>Tu contestes le signalement n° {contestOf}.</p>;
  }
  if (contestable !== null && contestable.length === 0) {
    return (
      <p className={styles.anonNote}>
        Aucun signalement ne te vise, ni toi ni ton équipe, et aucun de ceux que tu as envoyés
        n&apos;est archivé : il n&apos;y a rien à contester.
      </p>
    );
  }
  return (
    <div className="field">
      <label htmlFor={`${fieldId}-parent`}>Signalement contesté</label>
      <select
        id={`${fieldId}-parent`}
        value={parentReportId ?? ""}
        onChange={(event) => onParentReportIdChange(event.target.value ? Number(event.target.value) : null)}
        disabled={contestable === null}
      >
        <option value="">{contestable === null ? "Chargement…" : "Choisir…"}</option>
        {(contestable ?? []).map((option) => (
          <option key={option.id} value={option.id}>
            N° {option.id} · {REPORT_CATEGORY_DEFINITIONS[option.category].label} · du{" "}
            {new Date(option.createdAt).toLocaleDateString("fr-FR")} ·{" "}
            {REPORT_STATUS_LABELS[option.status]}
          </option>
        ))}
      </select>
    </div>
  );
}

interface ContactFieldsProps {
  fieldId: string;
  definition: ReportCategoryDefinition;
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
  if (definition.requiresContact) {
    return (
      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>TES COORDONNÉES</legend>
        <div className={styles.twoCols}>
          <div className="field">
            <label htmlFor={`${fieldId}-name`}>Nom ou raison sociale</label>
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
            <label htmlFor={`${fieldId}-email`}>Adresse électronique</label>
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
          <label htmlFor={`${fieldId}-relation`}>Ta qualité</label>
          <select
            id={`${fieldId}-relation`}
            value={rightsRelation}
            onChange={(event) => onRightsRelationChange(event.target.value as RightsRelation | "")}
            required
          >
            <option value="">Choisir…</option>
            {RIGHTS_RELATIONS.map((relation) => (
              <option key={relation} value={relation}>
                {RIGHTS_RELATION_LABELS[relation]}
              </option>
            ))}
          </select>
        </div>
        <label className={styles.check}>
          <input type="checkbox" checked={goodFaith} onChange={(event) => onGoodFaithChange(event.target.checked)} />
          <span>
            Je déclare de bonne foi que les informations de ce signalement sont exactes et complètes.
          </span>
        </label>
      </fieldset>
    );
  }
  return (
    <div className="field">
      <label htmlFor={`${fieldId}-email`}>
        Adresse pour te répondre{" "}
        <span className={styles.optional}>
          {replyChannelRequirement(definition.requiresReplyChannel, authenticated)}
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
        {replyChannelHint(definition.requiresReplyChannel, authenticated)}
      </p>
    </div>
  );
}

/** Mentions d'information sur les données du signalement. */
function ReportPrivacyNotice({ category }: Readonly<{ category: ReportCategory }>) {
  return (
    <div className={styles.notice}>
      <strong>Tes données</strong>
      <ul>
        <li>{REPORT_PRIVACY_NOTICE.controller}</li>
        <li>{REPORT_PRIVACY_NOTICE.purpose}</li>
        <li>{REPORT_PRIVACY_NOTICE.data}</li>
        <li>
          {category === "CONTEST"
            ? REPORT_PRIVACY_NOTICE.contestRecipients
            : REPORT_PRIVACY_NOTICE.recipients}
        </li>
        <li>{REPORT_PRIVACY_NOTICE.retention}</li>
        <li>{reportLegalBasisNotice(category)}</li>
        {(category === "COPYRIGHT" || category === "MODERATION") && <li>{NOTIFIER_FOLLOW_UP}</li>}
        <li>
          {reportRightsNotice(category)}{" "}
          <Link href="/rgpd" target="_blank" rel="noreferrer">
            Politique de confidentialité
          </Link>{" "}
          ·{" "}
          <Link href={`${TERMS_PATH}#signalement`} target="_blank" rel="noreferrer">
            Conditions d&apos;utilisation
          </Link>
        </li>
      </ul>
    </div>
  );
}

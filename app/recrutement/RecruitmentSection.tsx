"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CyberButton, CyberCard, Pill } from "@/components/cyber";
import { ContactTags } from "@/components/recruitment/ContactTags";
import { UrgentPill } from "@/components/recruitment/UrgentPill";
import { useAppLocale } from "@/components/i18n/locale-context";
import { useRecruitmentText } from "@/components/i18n/recruitment-text";
import { EnglishMissingMark, withEnglishMissing } from "@/components/ui/bilingual-field";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";
import { useToast } from "@/components/ui/toast";
import { useFieldErrors } from "@/lib/shared/hooks/useFieldErrors";
import {
  type RecruiterContactDefaults,
  type RecruitmentAd,
  type RecruitmentDomain,
  type RecruitmentField,
  type RecruitmentPriority,
  buildRecruitmentPreview,
  canMoveRecruitmentAd,
  localizeRecruitmentAds,
  parseRecruitmentAdAnchor,
  placeRecruitmentAd,
  recruitmentAdAnchor,
  recruitmentAdHasEnglish,
  recruitmentErrorMessage,
  sortRecruitmentAds,
  splitRecruitmentAds,
  validateRecruitmentAdInput,
  RECRUITMENT_DOMAINS,
  RECRUITMENT_DOMAIN_PILL,
  RECRUITMENT_FIELD_ERRORS,
  RECRUITMENT_PRIORITY_DESCRIPTIONS,
  RECRUITMENT_PRIORITY_EXPOSURE,
  RECRUITMENT_PRIORITY_LABELS,
} from "@/lib/shared/recruitment";
import { AdDetailModal } from "./AdDetailModal";
import { RecruitmentAdEditor } from "./RecruitmentAdEditor";
import {
  EMPTY_RECRUITMENT_FORM,
  recruitmentFormFromAd,
  recruitmentRequestBody,
  type RecruitmentFormState,
} from "./recruitment-form";
import styles from "./page.module.css";

interface RecruitmentSectionProps {
  initialAds: RecruitmentAd[];
  isAdmin: boolean;
  contactDefaults?: RecruiterContactDefaults;
}

type FormState = RecruitmentFormState;
const EMPTY_FORM = EMPTY_RECRUITMENT_FORM;

/** Filtre « tous les pôles » — valeur sentinelle hors de `RecruitmentDomain`. */
const ALL_DOMAINS = "ALL" as const;
type DomainFilter = RecruitmentDomain | typeof ALL_DOMAINS;

/**
 * En deçà de ce nombre d'annonces, le filtre par pôle n'apporte rien : il
 * encombrerait l'en-tête pour trier deux cartes déjà visibles d'un coup d'œil.
 */
const FILTER_MIN_ADS = 3;

/** Classe du badge de statut, côté gestion : une teinte par statut. */
const PRIORITY_BADGE_CLASS: Record<RecruitmentPriority, string> = {
  PRIORITY: styles.priorityBadgeUrgent,
  IMPORTANT: styles.priorityBadgeImportant,
  OPTIONAL: "",
};

/** `id` des champs bilingues du formulaire (`RecruitmentAdEditor`), cibles de `useFieldErrors`. */
const RECRUITMENT_FIELD_IDS: Readonly<Record<RecruitmentField, string>> = {
  title: "recruitment-title",
  titleEn: "recruitment-title-en",
  roles: "recruitment-roles",
  rolesEn: "recruitment-roles-en",
  body: "recruitment-body",
  bodyEn: "recruitment-body-en",
};

/** Refus du réordonnancement, traduit quand il a un sens pour le lecteur. */
function reorderErrorMessage(code: string | undefined): string {
  if (code === "RECRUITMENT_ORDER_MIXES_PRIORITIES") {
    return "Le statut d'une annonce a changé entre-temps : recharge la page pour réordonner.";
  }
  return code ? `Échec : ${code}` : "Échec du réordonnancement.";
}


/**
 * Phrases d'une liste vide. Sous `/en`, des annonces encore sans anglais sont
 * masquées : « aucun poste » serait faux quand il en reste à traduire, et
 * « aucune urgence » quand une annonce urgente l'est — on dit alors qu'elles
 * arrivent, sans compteur à zéro.
 */
function emptyMessageKeys(hidden: readonly RecruitmentAd[], domain: RecruitmentDomain | null) {
  const urgentHidden = splitRecruitmentAds(hidden.filter((ad) => domain === null || ad.domain === domain)).featured.length > 0;
  return {
    empty: hidden.length > 0 ? "section.pendingTranslation" : "section.empty",
    noUrgent: urgentHidden ? "section.pendingTranslation" : "section.noUrgent",
    showCount: (total: number) => total > 0 || hidden.length === 0,
  } as const;
}

/** Lien vers une annonce absente de la page : supprimée, ou (sous `/en`) pas encore traduite. */
function missingAdMessage(
  ads: readonly RecruitmentAd[],
  id: number,
  messages: Readonly<{ unavailable: string; untranslated: string }>,
): string {
  return ads.some((a) => a.id === id) ? messages.untranslated : messages.unavailable;
}
export function RecruitmentSection({ initialAds, isAdmin, contactDefaults }: Readonly<RecruitmentSectionProps>) {
  const locale = useAppLocale();
  const { t } = useRecruitmentText();
  // La gestion reste en français (D4) : sous `/en`, ses contrôles, sa fenêtre
  // et ses notifications le disent (`lang="fr"`).
  const staffLang = locale === "fr" ? undefined : "fr";
  const toast = useToast();
  const staffToast = staffLang ? { lang: staffLang } : undefined;
  const showError = (message: string) => toast.showError(message, staffToast);
  const showSuccess = (message: string) => toast.showSuccess(message, staffToast);
  const fieldErrors = useFieldErrors<RecruitmentField>(RECRUITMENT_FIELD_ERRORS, RECRUITMENT_FIELD_IDS);
  // Toujours rangée par statut : les flèches de réordonnancement ne se lisent
  // que sur cet ordre-là (voir `canMoveRecruitmentAd`).
  const [ads, setAds] = useState<RecruitmentAd[]>(() => sortRecruitmentAds(initialAds));
  const [editing, setEditing] = useState<RecruitmentAd | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // Annonce ouverte en lecture (modale « grand format »). Mémorisée par id pour
  // rester juste après une modification : la modale relit toujours la version
  // courante de la liste.
  const [detailId, setDetailId] = useState<number | null>(null);
  const [domainFilter, setDomainFilter] = useState<DomainFilter>(ALL_DOMAINS);
  // Couple (pseudo, id Discord) cohérent connu au moment de l'ouverture du
  // formulaire. On ne renvoie l'`id` (deep-link) que si le pseudo n'a pas été
  // remplacé, pour éviter d'associer l'id d'un recruteur à un pseudo tiers.
  const discordSnapshot = useRef<{ pseudo: string; id: string | null }>({ pseudo: "", id: null });

  // Lien profond `/recrutement#annonce-<id>` : ouvre directement l'annonce en
  // lecture (partage d'une annonce, bouton « Voir l'annonce » de la mise en
  // avant site). `hashchange` couvre les liens internes à la page. Le fragment
  // fait foi dans les deux sens : s'il ne désigne plus d'annonce, la lecture se
  // referme — sinon un lien interne vers une autre ancre laisserait le lecteur
  // enfermé sur une annonce que l'URL ne nomme plus.
  useEffect(() => {
    const syncFromHash = () => setDetailId(parseRecruitmentAdAnchor(window.location.hash));
    syncFromHash();
    window.addEventListener("hashchange", syncFromHash);
    return () => window.removeEventListener("hashchange", syncFromHash);
  }, []);

  // Ce que la page montre : les annonces dans la langue de la page. Sous `/en`,
  // une annonce sans anglais n'est pas rendue (`localizeRecruitmentAds`) — la
  // gestion la retrouve sur la page française, marquée **EN**.
  const shownAds = useMemo(() => (locale === "fr" ? ads : localizeRecruitmentAds(ads, locale)), [ads, locale]);

  // Annonce visée par le lien profond : `null` si elle n'existe pas (ou plus).
  const detailAd = detailId === null ? null : (shownAds.find((a) => a.id === detailId) ?? null);

  // Lien partagé vers une annonce supprimée ou dépubliée : on le dit, plutôt que
  // d'ouvrir une page muette avec un fragment qui ne mène nulle part.
  const showUnavailable = toast.showError;
  const unavailable = t("section.unavailable");
  const untranslated = t("section.untranslated");
  useEffect(() => {
    if (detailId === null || shownAds.some((a) => a.id === detailId)) return;
    showUnavailable(missingAdMessage(ads, detailId, { unavailable, untranslated }));
    setDetailId(null);
  }, [detailId, ads, shownAds, showUnavailable, unavailable, untranslated]);

  function openDetail(ad: RecruitmentAd) {
    setDetailId(ad.id);
    try {
      // URL partageable, sans entrée d'historique supplémentaire.
      window.history.replaceState(null, "", `#${recruitmentAdAnchor(ad.id)}`);
    } catch {
      // Historique indisponible : la modale s'ouvre quand même.
    }
  }

  function closeDetail() {
    setDetailId(null);
    try {
      if (parseRecruitmentAdAnchor(window.location.hash) !== null) {
        window.history.replaceState(null, "", window.location.pathname + window.location.search);
      }
    } catch {
      // Ignore : la fermeture reste effective.
    }
  }

  function openCreate() {
    fieldErrors.clear();
    setEditing(null);
    const discord = contactDefaults?.discord ?? "";
    // Pré-remplissage du Discord depuis le profil du recruteur — modifiable / effaçable.
    setForm({ ...EMPTY_FORM, contactDiscord: discord });
    discordSnapshot.current = { pseudo: discord, id: contactDefaults?.discordId ?? null };
    setOpen(true);
  }

  function openEdit(shown: RecruitmentAd) {
    // La carte montre l'annonce traduite : la gestion reprend l'enregistrement d'origine.
    const ad = ads.find((a) => a.id === shown.id) ?? shown;
    fieldErrors.clear();
    setEditing(ad);
    setForm(recruitmentFormFromAd(ad));
    // L'id enregistré reste valide tant que le pseudo n'est pas modifié.
    discordSnapshot.current = { pseudo: ad.contactDiscord ?? "", id: ad.contactDiscordId };
    setOpen(true);
  }

  function close() {
    if (busy) return;
    setOpen(false);
    setEditing(null);
    setForm(EMPTY_FORM);
  }

  function set<K extends keyof FormState>(field: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  // Un refus désigne son champ quand il le peut (titre, anglais…) : rattaché
  // à lui, focus ramené, et la même phrase en notification.
  function refuse(code: string | undefined, fallback: string) {
    const message = recruitmentErrorMessage(code, fallback);
    fieldErrors.report(code, message);
    showError(message);
  }

  async function submit() {
    // L'id de lien profond ne repart que si le pseudo est resté celui pour
    // lequel il a été dérivé (profil du recruteur ou valeur enregistrée).
    const payload = recruitmentRequestBody(form, discordSnapshot.current);
    // Même validation que le serveur, avant l'envoi : l'anglais manquant est
    // désigné sans aller-retour (D9).
    const check = validateRecruitmentAdInput(payload);
    if (!check.ok) {
      refuse(check.error, "Formulaire invalide.");
      return;
    }

    setBusy(true);

    try {
      const url = editing ? `/api/recruitment/${editing.id}` : "/api/recruitment";
      const res = await fetch(url, {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as { ad?: RecruitmentAd; error?: string };
      if (!res.ok || !data.ad) {
        refuse(data.error, "Échec de l'enregistrement.");
        return;
      }

      // Rangée comme le serveur la range : à sa place si son statut n'a pas
      // changé, en fin de son groupe sinon.
      const saved = data.ad;
      setAds((prev) => placeRecruitmentAd(prev, saved));
      showSuccess(editing ? "Annonce mise à jour." : "Annonce publiée.");
      close();
    } catch {
      showError("Erreur réseau, réessaye.");
    } finally {
      setBusy(false);
    }
  }

  const [pendingRemoval, setPendingRemoval] = useState<RecruitmentAd | null>(null);

  async function remove(ad: RecruitmentAd): Promise<boolean> {
    setBusy(true);
    try {
      const res = await fetch(`/api/recruitment/${ad.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        showError(data.error ? `Échec : ${data.error}` : "Échec de la suppression.");
        return false;
      }
      setAds((prev) => prev.filter((a) => a.id !== ad.id));
      // Une annonce supprimée ne doit pas rester ouverte en lecture derrière.
      if (detailId === ad.id) closeDetail();
      showSuccess("Annonce supprimée.");
      return true;
    } catch {
      showError("Erreur réseau, réessaye.");
    } finally {
      setBusy(false);
    }
    return false;
  }

  // Déplace une annonce d'un cran (admin), **dans son statut** seulement.
  // Mise à jour optimiste avec rollback.
  async function move(index: number, direction: -1 | 1) {
    if (!canMoveRecruitmentAd(ads, index, direction)) return;
    const target = index + direction;

    const previous = ads;
    const reordered = [...ads];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    setAds(reordered);

    setBusy(true);
    try {
      const res = await fetch("/api/recruitment/reorder", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: reordered.map((a) => a.id) }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        showError(reorderErrorMessage(data.error));
        setAds(previous);
        return;
      }
      showSuccess("Ordre mis à jour.");
    } catch {
      showError("Erreur réseau, réessaye.");
      setAds(previous);
    } finally {
      setBusy(false);
    }
  }

  // Un seul parcours de la liste pour les pôles représentés et leurs effectifs,
  // dans l'ordre canonique du registre.
  const { presentDomains, domainCounts } = useMemo(() => {
    const counts = new Map<RecruitmentDomain, number>();
    for (const ad of shownAds) counts.set(ad.domain, (counts.get(ad.domain) ?? 0) + 1);
    return {
      presentDomains: RECRUITMENT_DOMAINS.filter((d) => counts.has(d)),
      domainCounts: counts,
    };
  }, [shownAds]);
  const showFilter = shownAds.length >= FILTER_MIN_ADS && presentDomains.length > 1;

  // Un filtre sur un pôle vidé par une suppression laisserait une liste vide
  // sans raison visible : on retombe sur « Tous ».
  useEffect(() => {
    if (domainFilter !== ALL_DOMAINS && !presentDomains.includes(domainFilter)) {
      setDomainFilter(ALL_DOMAINS);
    }
  }, [domainFilter, presentDomains]);

  const filterActive = showFilter && domainFilter !== ALL_DOMAINS;
  const visibleAds = filterActive ? shownAds.filter((ad) => ad.domain === domainFilter) : shownAds;

  // Deux listes, jamais mêlées : prioritaires et importantes en tête, les
  // facultatives à part sous « Autres recrutements ».
  const { featured, others } = splitRecruitmentAds(visibleAds);

  function renderCard(ad: RecruitmentAd) {
    // Index dans la liste complète : le réordonnancement porte toujours
    // sur l'ordre réel, jamais sur la vue filtrée (ni traduite).
    const index = ads.findIndex((a) => a.id === ad.id);
    const enMissing = isAdmin && !recruitmentAdHasEnglish(ads[index] ?? ad);
    const preview = buildRecruitmentPreview(ad.body);
    const canUp = canMoveRecruitmentAd(ads, index, -1);
    const canDown = canMoveRecruitmentAd(ads, index, 1);
    // Pourquoi une flèche est grisée : le filtre, ou la limite de son statut.
    const moveTitle = (can: boolean, label: string) => {
      if (filterActive) return "Retire le filtre pour réordonner";
      return can ? label : `L'ordre se règle parmi les annonces « ${RECRUITMENT_PRIORITY_LABELS[ad.priority]} »`;
    };
    return (
      <CyberCard
        key={ad.id}
        as="article"
        lift
        className={styles.card}
        id={recruitmentAdAnchor(ad.id)}
      >
        <div className={styles.cardHead}>
          <div className={styles.cardTags}>
            <Pill variant={RECRUITMENT_DOMAIN_PILL[ad.domain]}>{t(`domains.${ad.domain}`)}</Pill>
            {RECRUITMENT_PRIORITY_EXPOSURE[ad.priority].urgent && <UrgentPill />}
            {!ad.active && <Pill variant="neutral">{t("card.inactive")}</Pill>}
            {/* Le statut ne se lit publiquement que par ses effets (pastille,
                section) : la gestion, elle, a besoin de le voir nommé. */}
            {isAdmin && (
              <span
                lang={staffLang}
                className={`${styles.priorityBadge} ${PRIORITY_BADGE_CLASS[ad.priority]} ${ad.active ? "" : styles.priorityBadgeDraft}`}
                title={
                  ad.active
                    ? RECRUITMENT_PRIORITY_DESCRIPTIONS[ad.priority]
                    : "Annonce inactive : elle n'apparaît nulle part tant qu'elle n'est pas publiée."
                }
              >
                {RECRUITMENT_PRIORITY_LABELS[ad.priority]}
              </span>
            )}
          </div>
          {/* Ordre réglé en français seulement : sous /en, une annonce sans anglais est masquée. */}
          {isAdmin && locale === "fr" && (
            <div className={styles.moveActions} data-tap-zone lang={staffLang}>
              <button
                type="button"
                className={styles.move}
                onClick={() => move(index, -1)}
                disabled={busy || filterActive || !canUp}
                aria-label={`Monter l'annonce ${ad.title}`}
                title={moveTitle(canUp, "Monter")}
              >
                ↑
              </button>
              <button
                type="button"
                className={styles.move}
                onClick={() => move(index, 1)}
                disabled={busy || filterActive || !canDown}
                aria-label={`Descendre l'annonce ${ad.title}`}
                title={moveTitle(canDown, "Descendre")}
              >
                ↓
              </button>
            </div>
          )}
        </div>

        <h3 className={styles.cardTitle}>
          <button
            type="button"
            className={styles.cardTitleButton}
            onClick={() => openDetail(ad)}
            aria-haspopup="dialog"
          >
            {ad.title}
          </button>
        </h3>
        {ad.teamName && <p className={styles.cardTeam}>{ad.teamName}</p>}
        {ad.roles && <p className={styles.cardRoles}>{t("card.roles", { roles: ad.roles })}</p>}
        {preview.text && <p className={styles.cardBody}>{preview.text}</p>}
        {preview.truncated && (
          <button
            type="button"
            className={`${styles.readMore} tap-target`}
            onClick={() => openDetail(ad)}
            aria-haspopup="dialog"
          >
            {t("card.readMore")}
          </button>
        )}

        <ContactTags ad={ad} />

        <div className={styles.cardFooter}>
          {ad.contactUrl && (
            <CyberButton variant={ad.contactPreferred === "LINK" ? "primary" : "ghost"} asChild>
              <a href={ad.contactUrl} target="_blank" rel="noopener noreferrer">
                {t("card.apply")}
              </a>
            </CyberButton>
          )}
          {isAdmin && (
            <div className={styles.cardActions} lang={staffLang}>
              <button
                type="button"
                className={styles.action}
                onClick={() => openEdit(ad)}
                disabled={busy}
                aria-label={withEnglishMissing(`Modifier ${ad.title}`, enMissing)}
              >
                Modifier
                {enMissing && <EnglishMissingMark />}
              </button>
              <button
                type="button"
                className={`${styles.action} ${styles.actionDanger}`}
                onClick={() => setPendingRemoval(ad)}
                disabled={busy}
                aria-label={`Supprimer ${ad.title}`}
              >
                Supprimer
              </button>
            </div>
          )}
        </div>
      </CyberCard>
    );
  }

  const total = shownAds.length;
  const shown = visibleAds.length;
  // Sous `/en`, des annonces encore sans anglais sont masquées (`emptyMessageKeys`).
  const hiddenAds = shownAds.length < ads.length ? ads.filter((ad) => !shownAds.some((a) => a.id === ad.id)) : [];
  const translationPending = hiddenAds.length > 0;
  const emptyKeys = emptyMessageKeys(hiddenAds, filterActive ? domainFilter : null);

  return (
    <>
      <section className={styles.section}>
        <header className={styles.head}>
          <div>
            <span className="eyebrow">{t("section.eyebrow")}</span>
            <h2 className={styles.sectionTitle}>{t("section.title")}</h2>
          </div>
          <div className={styles.headActions}>
            {emptyKeys.showCount(total) && (
              <span className={styles.meta}>
                {filterActive
                  ? t("section.countFiltered", { shown, count: total })
                  : t("section.count", { count: total })}
              </span>
            )}
            {isAdmin && (
              <CyberButton variant="primary" onClick={openCreate} lang={staffLang}>
                + Nouvelle annonce
              </CyberButton>
            )}
          </div>
        </header>

        {showFilter && (
          <fieldset className={`native-group ${styles.filters}`} aria-label={t("section.filterLabel")}>
            <button
              type="button"
              className={`${styles.filter} ${domainFilter === ALL_DOMAINS ? styles.filterOn : ""}`}
              onClick={() => setDomainFilter(ALL_DOMAINS)}
              aria-pressed={domainFilter === ALL_DOMAINS}
            >
              {t("section.allDomains")}
            </button>
            {presentDomains.map((d) => (
              <button
                key={d}
                type="button"
                className={`${styles.filter} ${domainFilter === d ? styles.filterOn : ""}`}
                onClick={() => setDomainFilter(d)}
                aria-pressed={domainFilter === d}
              >
                {t(`domains.${d}`)}
                <span className={styles.filterCount}>{domainCounts.get(d) ?? 0}</span>
              </button>
            ))}
          </fieldset>
        )}

        {total === 0 ? (
          <div className={styles.empty}>
            <p>{t(emptyKeys.empty)}</p>
            {isAdmin && !translationPending && (
              <CyberButton variant="primary" onClick={openCreate} lang={staffLang}>
                Publier la première annonce
              </CyberButton>
            )}
          </div>
        ) : (
          <>
            {featured.length > 0 ? (
              <div className={styles.list}>{featured.map(renderCard)}</div>
            ) : (
              <p className={styles.groupEmpty}>{t(emptyKeys.noUrgent)}</p>
            )}

            {others.length > 0 && (
              <section className={styles.others} aria-labelledby="autres-recrutements">
                <header className={styles.othersHead}>
                  <h2 id="autres-recrutements" className={styles.othersTitle}>
                    {t("section.others")}
                  </h2>
                  <span className={styles.meta}>{t("section.count", { count: others.length })}</span>
                </header>
                <div className={styles.list}>{others.map(renderCard)}</div>
              </section>
            )}
          </>
        )}
      </section>

      {detailAd && <AdDetailModal key={detailAd.id} ad={detailAd} onClose={closeDetail} />}

      {open && (
        <RecruitmentAdEditor
          editing={editing}
          form={form}
          onChange={set}
          busy={busy}
          prefilledDiscord={Boolean(contactDefaults?.discord)}
          onClose={close}
          onSubmit={submit}
          errors={fieldErrors}
          enMissing={editing !== null && !recruitmentAdHasEnglish(editing)}
          staffLang={staffLang}
        />
      )}
      {pendingRemoval ? (
        <ConfirmActionDialog
          title={`Supprimer l'annonce « ${pendingRemoval.title} » ?`}
          confirmLabel="Supprimer l'annonce"
          pendingLabel="Suppression…"
          contentLang={staffLang}
          onClose={() => setPendingRemoval(null)}
          onConfirm={() => remove(pendingRemoval)}
        >
          <p>
            L&apos;annonce disparaît de la page Recrutement, avec sa description et ses moyens de
            contact. Elle ne se restaure pas : il faudrait la rédiger à nouveau.
          </p>
        </ConfirmActionDialog>
      ) : null}
    </>
  );
}
